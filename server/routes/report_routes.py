"""
routes/patent_report_routes.py

Temporary endpoints for patent filing report data.
Returns raw numerical data suitable for generating publication-quality charts.

Register in routes/__init__.py:
    from .patent_report_routes import bp as patent_report_bp

Register in app.py:
    app.register_blueprint(patent_report_bp)
"""

import json
import math
from flask import Blueprint, jsonify, request
from models import Chat, PracticeSession
from models.misconception import MisconceptionRecord
from services.auth_service import get_user_from_token
from services.bloom_trajectory_service import get_bloom_trajectory
from services.misconception_service import get_misconceptions_for_chat
from services.delivery_trend_service import get_delivery_trends
from services.evaluation_service import update_topic_weakness
from logger import get_logger

logger = get_logger("patent_report")
bp = Blueprint("patent_report_routes", __name__)


def _get_chat_or_403(chat_id, user):
    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return None
    return chat


# ─────────────────────────────────────────────────────────────────────────────
# 1. EMA WEAKNESS SCORE CONVERGENCE
#    Shows how the EMA score stabilizes over simulated sessions for each topic.
#    For patent: demonstrates the mathematical convergence property of the model.
# ─────────────────────────────────────────────────────────────────────────────

@bp.route("/api/patent/ema-convergence/<chat_id>", methods=["GET"])
def ema_convergence(chat_id):
    """
    Simulates EMA convergence by replaying the actual session history
    for each topic, computing the running EMA score after each session.

    Returns per-topic EMA trajectories across all sessions so you can
    plot how scores stabilize (converge) rather than fluctuate wildly.

    Chart type: Line chart — X = session number, Y = EMA weakness score (0-1),
    one line per topic (top 5 weakest topics).
    """
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = _get_chat_or_403(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403

    sessions = (
        PracticeSession.query
        .filter_by(chat_id=chat_id)
        .filter(PracticeSession.session_type.in_(["full", "weak", "full_fallback"]))
        .order_by(PracticeSession.created_at.asc())
        .all()
    )

    if not sessions:
        return jsonify({"error": "No sessions found"}), 404

    # Replay EMA computation session by session
    alpha = 0.25
    running_state = {}  # topic -> current EMA score
    trajectories = {}   # topic -> [score_after_s1, score_after_s2, ...]
    session_labels = []

    for i, s in enumerate(sessions):
        label = f"S{i+1}"
        session_labels.append({
            "label": label,
            "date": s.created_at.isoformat(),
            "type": s.session_type,
        })

        try:
            feedback = json.loads(s.feedback_json or "{}")
        except Exception:
            feedback = {}

        # Build topic events from this session's feedback
        topic_events = []
        for qid, r in feedback.items():
            if not isinstance(r, dict):
                continue
            topic = r.get("topic", "General")
            score = r.get("understandingScore", 5)
            difficulty = r.get("difficulty", "medium")
            bloom = r.get("bloomLevel", "Understand")
            qtype = r.get("type", "mcq")

            score_ratio = max(0.0, min(1.0, float(score or 0) / 10.0))
            topic_events.append({
                "topic": topic,
                "correct": score_ratio >= 0.6,
                "difficulty": difficulty,
                "score_ratio": score_ratio,
                "question_type": qtype if qtype in ("mcq","fill_blank","true_false","descriptive") else "mcq",
                "bloom_level": bloom,
            })

        if topic_events:
            running_state = update_topic_weakness(running_state, topic_events, alpha=alpha)

        # Record current score for every topic after this session
        for topic, rec in running_state.items():
            if topic not in trajectories:
                trajectories[topic] = []
            score = rec.get("score", 0.5) if isinstance(rec, dict) else 0.5
            trajectories[topic].append({
                "session": label,
                "score": round(score, 4),
                "mastery": round(1.0 - score, 4),
                "seen": rec.get("seen", 0) if isinstance(rec, dict) else 0,
            })

    # Pick top 5 weakest topics (highest final EMA score)
    final_scores = {
        t: data[-1]["score"] if data else 0
        for t, data in trajectories.items()
    }
    top_topics = sorted(final_scores, key=final_scores.get, reverse=True)[:6]

    # EMA formula parameters for patent documentation
    ema_params = {
        "alpha": alpha,
        "half_life_sessions": round(math.log(0.5) / math.log(1 - alpha), 2),
        "equivalent_sma_window": round(2 / alpha - 1, 1),
        "difficulty_weights": {"easy": 1.15, "medium": 1.0, "hard": 0.85},
        "type_weights": {"descriptive": 1.25, "mcq": 1.0, "fill_blank": 1.0, "true_false": 0.85},
    }

    return jsonify({
        "chartTitle": "EMA Weakness Score Convergence Over Sessions",
        "xAxis": "Session Number",
        "yAxis": "EMA Weakness Score (0=mastered, 1=weak)",
        "sessions": session_labels,
        "topics": {
            t: trajectories[t]
            for t in top_topics
            if t in trajectories
        },
        "allTopics": list(trajectories.keys()),
        "emaParameters": ema_params,
        "interpretation": (
            "Lower scores indicate mastery. Convergence is visible when the "
            "line stabilizes — the EMA's exponential decay prevents outlier "
            "sessions from dominating the long-term score."
        ),
    })


# ─────────────────────────────────────────────────────────────────────────────
# 2. OLS DELIVERY TREND LINES (OVER-REHEARSAL DETECTION)
#    Returns the raw per-session metric values + OLS regression parameters
#    so you can plot the diverging trend lines for content vs delivery.
# ─────────────────────────────────────────────────────────────────────────────

@bp.route("/api/patent/ols-delivery-trends/<chat_id>", methods=["GET"])
def ols_delivery_trends(chat_id):
    """
    Returns raw delivery + content metric values per session AND their OLS
    regression line parameters (slope, intercept, R²).

    Over-rehearsal pattern: content slope > 0 while delivery/naturalness slope < 0.
    Divergence score = avg_content_slope - avg_delivery_slope.

    Chart type: Line chart with OLS regression lines overlaid.
    X = session, Y = score (0-10), separate lines per metric.
    """
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = _get_chat_or_403(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403

    # Get raw trend data from existing service
    trend_data = get_delivery_trends(chat_id)

    if not trend_data.get("hasSufficientData"):
        return jsonify({
            "error": "Insufficient video sessions",
            "sessionCount": trend_data.get("sessionCount", 0),
            "minRequired": trend_data.get("minSessionsNeeded", 3),
        }), 400

    sessions = trend_data.get("sessions", [])
    trends = trend_data.get("trends", {})

    # Compute OLS regression line points for each metric
    def ols_line_points(values):
        """Return y-values along OLS regression line for plotting."""
        n = len(values)
        if n < 2:
            return values
        xs = list(range(n))
        x_mean = sum(xs) / n
        y_mean = sum(values) / n
        num = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, values))
        den = sum((x - x_mean) ** 2 for x in xs)
        slope = num / den if den != 0 else 0
        intercept = y_mean - slope * x_mean
        r_squared = 0
        if den != 0:
            ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, values))
            ss_tot = sum((y - y_mean) ** 2 for y in values)
            r_squared = 1 - (ss_res / ss_tot) if ss_tot != 0 else 0
        return {
            "slope": round(slope, 4),
            "intercept": round(intercept, 4),
            "r_squared": round(r_squared, 4),
            "regression_points": [
                round(slope * x + intercept, 2) for x in xs
            ],
        }

    # Build per-metric data
    metrics_data = {}

    delivery_metrics = ["Naturalness", "Clarity", "Confidence", "Filler Words", "Overall"]
    content_metrics  = ["Relevance", "Completeness", "Structure", "Examples"]

    for metric in delivery_metrics + content_metrics:
        category = "delivery" if metric in delivery_metrics else "content"
        values = [
            s.get(category, {}).get(metric)
            for s in sessions
            if s.get(category, {}).get(metric) is not None
        ]
        if len(values) >= 2:
            ols = ols_line_points(values)
            metrics_data[metric] = {
                "category": category,
                "rawValues": values,
                "sessionLabels": [f"S{s['sessionNumber']}" for s in sessions
                                  if s.get(category, {}).get(metric) is not None],
                "ols": ols,
                "trend": "improving" if ols["slope"] > 0.05
                         else "degrading" if ols["slope"] < -0.05
                         else "stable",
            }

    # Compute divergence score for patent documentation
    content_slopes  = [metrics_data[m]["ols"]["slope"] for m in content_metrics if m in metrics_data]
    delivery_slopes = [metrics_data[m]["ols"]["slope"] for m in delivery_metrics if m in metrics_data]
    avg_content  = sum(content_slopes)  / len(content_slopes)  if content_slopes  else 0
    avg_delivery = sum(delivery_slopes) / len(delivery_slopes) if delivery_slopes else 0
    divergence   = round(avg_content - avg_delivery, 4)

    return jsonify({
        "chartTitle": "OLS Delivery Trend Lines — Content vs Delivery Divergence",
        "xAxis": "Session Number",
        "yAxis": "Score (0–10)",
        "sessionCount": len(sessions),
        "sessions": [{"label": f"S{s['sessionNumber']}", "date": s.get("createdAt")} for s in sessions],
        "metrics": metrics_data,
        "divergenceAnalysis": {
            "avgContentSlope":  round(avg_content, 4),
            "avgDeliverySlope": round(avg_delivery, 4),
            "divergenceScore":  divergence,
            "overRehearsalDetected": divergence > 0.3 and avg_delivery < -0.05,
            "threshold": 1.5,
            "interpretation": (
                "Positive divergence (content improving while delivery degrades) "
                "indicates over-rehearsal. The OLS regression isolates the long-term "
                "trend from session-to-session noise."
            ),
            "formula": "divergence = avg(content_slopes) - avg(delivery_slopes)",
        },
        "warnings": trend_data.get("warnings", []),
    })


# ─────────────────────────────────────────────────────────────────────────────
# 3. MISCONCEPTION DETECTION RESULTS
#    Returns structured misconception data with confidence scores, cluster
#    labels, persistence flags — ready for a patent exhibit table/chart.
# ─────────────────────────────────────────────────────────────────────────────

@bp.route("/api/patent/misconception-analysis/<chat_id>", methods=["GET"])
def misconception_analysis(chat_id):
    """
    Returns fully structured misconception clusters with:
    - Cluster label and description
    - Confidence score (formula: f/W * ln(1+f) / ln(1+W))
    - Persistence flag (seen across N sessions)
    - Topic misconception severity score (0-100)
    - Raw wrong-answer pattern counts

    Chart type: Bar chart of severity scores per topic, or table of clusters.
    """
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = _get_chat_or_403(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403

    data = get_misconceptions_for_chat(chat_id)

    # Build patent-ready structured output
    topics_structured = []
    for t in data.get("topics", []):
        clusters = []
        for mc in (t.get("misconceptions") or []):
            clusters.append({
                "label":            mc.get("label"),
                "description":      mc.get("description"),
                "frequency":        mc.get("frequency", 0),
                "confidenceScore":  mc.get("confidenceScore", 0),
                "confidenceLabel":  mc.get("confidenceLabel", "low"),
                "isPersistent":     mc.get("isPersistent", False),
                "sessionCount":     mc.get("sessionCount", 0),
                "correctConcept":   mc.get("correctConcept"),
            })

        topics_structured.append({
            "topic":              t["topic"],
            "totalWrongAnswers":  t["wrongAnswerCount"],
            "sessionsWithErrors": t["sessionCount"],
            "hasEnoughData":      t["hasEnoughData"],
            "severityScore":      t.get("misconceptionScore", 0),
            "severityLabel": (
                "High"   if t.get("misconceptionScore", 0) >= 65
                else "Medium" if t.get("misconceptionScore", 0) >= 35
                else "Low"
            ),
            "clusters": sorted(clusters, key=lambda c: c["confidenceScore"], reverse=True),
            "topPattern": t.get("rawPatterns", [{}])[0] if t.get("rawPatterns") else None,
        })

    # Confidence score formula for patent documentation
    confidence_formula = {
        "formula": "confidence = min(1.0, (f/W) * ln(1+f) / ln(1+W))",
        "variables": {
            "f": "cluster frequency (number of times this wrong pattern appeared)",
            "W": "total wrong answers for this topic",
        },
        "thresholds": {
            "high":   ">= 0.65",
            "medium": ">= 0.35",
            "low":    "< 0.35",
        },
        "rationale": (
            "Combines frequency ratio with logarithmic evidence weighting "
            "(TF-IDF inspired). Pure frequency ratio alone would make rare "
            "topics with one wrong answer score 1.0 — the log factor penalizes "
            "low-evidence clusters."
        ),
    }

    # Severity formula
    severity_formula = {
        "formula": "severity = min(100, D_w*50 + C_top*30 + P_f*20)",
        "variables": {
            "D_w":   "wrong density = wrong_count / (sessions * 3)",
            "C_top": "top cluster confidence score",
            "P_f":   "persistence factor = sessions_with_errors / persistence_threshold",
        },
    }

    return jsonify({
        "chartTitle": "Misconception Detection Results by Topic",
        "totalWrongAnswers":    data.get("totalWrongAnswers", 0),
        "totalSessions":        data.get("totalSessions", 0),
        "persistentTopicCount": data.get("persistentTopicCount", 0),
        "hasMisconceptions":    data.get("hasMisconceptions", False),
        "topics": topics_structured,
        "formulaDocumentation": {
            "confidenceScore": confidence_formula,
            "severityScore":   severity_formula,
        },
        "summaryForChart": [
            {
                "topic":         t["topic"],
                "severityScore": t["severityScore"],
                "severityLabel": t["severityLabel"],
                "clusterCount":  len(t["clusters"]),
                "topCluster":    t["clusters"][0]["label"] if t["clusters"] else None,
                "topConfidence": t["clusters"][0]["confidenceScore"] if t["clusters"] else 0,
                "isPersistent":  any(c["isPersistent"] for c in t["clusters"]),
            }
            for t in topics_structured
            if t["hasEnoughData"]
        ],
    })


# ─────────────────────────────────────────────────────────────────────────────
# 4. BLOOM TRAJECTORY DATA
#    Returns per-topic Bloom mastery progression for patent exhibit.
# ─────────────────────────────────────────────────────────────────────────────

@bp.route("/api/patent/bloom-trajectory/<chat_id>", methods=["GET"])
def bloom_trajectory_patent(chat_id):
    """
    Returns Bloom level mastery data per topic — suitable for a radar chart
    or stacked bar chart showing cognitive depth progression.

    Patent value: demonstrates the system's ability to model learning at
    six distinct cognitive levels (Bloom's taxonomy) simultaneously.
    """
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = _get_chat_or_403(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403

    data = get_bloom_trajectory(chat_id)

    bloom_order = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]

    topics_for_chart = []
    for t in data.get("topics", []):
        levels = t.get("levels", {})
        topics_for_chart.append({
            "topic":          t["topic"],
            "currentLevel":   t.get("currentLevel"),
            "nextLevel":      t.get("nextLevel"),
            "readyToAdvance": t.get("readyToAdvance", False),
            "bloomScores": {
                level: {
                    "mastery":  levels.get(level, {}).get("mastery", 0),
                    "seen":     levels.get(level, {}).get("seen", 0),
                    "status":   levels.get(level, {}).get("status", "not_started"),
                }
                for level in bloom_order
            },
            "prediction": t.get("prediction"),
        })

    # Aggregate: average mastery per bloom level across all topics
    bloom_aggregates = {}
    for level in bloom_order:
        values = [
            t["bloomScores"][level]["mastery"]
            for t in topics_for_chart
            if t["bloomScores"][level]["seen"] > 0
        ]
        bloom_aggregates[level] = {
            "avgMastery":   round(sum(values) / len(values), 1) if values else 0,
            "topicsActive": len(values),
        }

    return jsonify({
        "chartTitle": "Bloom's Taxonomy Mastery Progression per Topic",
        "bloomOrder": bloom_order,
        "masteryThreshold": 70,
        "topics": topics_for_chart,
        "bloomAggregates": bloom_aggregates,
        "summary": data.get("summary", {}),
        "radarChartData": [
            {
                "bloom":      level,
                "avgMastery": bloom_aggregates[level]["avgMastery"],
                "topicsActive": bloom_aggregates[level]["topicsActive"],
            }
            for level in bloom_order
        ],
        "formulaDocumentation": {
            "masteryFormula":    "mastery = 1 - weakness_score",
            "sessionsNeeded":    "ceil((threshold - mastery) / improvement_rate)",
            "threshold":         0.70,
            "improvementRate":   "average per-session mastery delta (clamped >= 0)",
            "predictionCutoff":  "rate must exceed 0.005 for a valid prediction",
        },
    })


# ─────────────────────────────────────────────────────────────────────────────
# 5. UNIFIED HEALTH SCORE BREAKDOWN
#    Shows the composite health score formula with component contributions.
# ─────────────────────────────────────────────────────────────────────────────

@bp.route("/api/patent/health-score/<chat_id>", methods=["GET"])
def health_score_breakdown(chat_id):
    """
    Returns the unified learner health score with full component breakdown.
    Shows the weighted composite formula in action with real data.

    Formula: H = 0.45*Bloom + 0.35*(100-Misconception) + 0.20*Delivery
    """
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = _get_chat_or_403(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403

    from services.learner_diagnostic_service import get_learner_diagnostic
    data = get_learner_diagnostic(chat_id)

    bloom    = data.get("bloomReadiness", {})
    misc     = data.get("misconceptionProfile", {})
    delivery = data.get("deliveryState", {})
    health   = data.get("overallHealthScore", 0)

    bloom_contribution    = round(bloom.get("score", 0) * 0.45, 2)
    misc_contribution     = round((100 - misc.get("severityScore", 50)) * 0.35, 2)
    delivery_contribution = round(health - bloom_contribution - misc_contribution, 2)

    return jsonify({
        "chartTitle": "Unified Learner Health Score — Component Breakdown",
        "overallHealthScore": health,
        "healthLabel": (
            "Excellent"   if health >= 80
            else "Good"        if health >= 65
            else "Developing"  if health >= 45
            else "Needs Work"
        ),
        "components": {
            "bloomReadiness": {
                "weight": 0.45,
                "rawScore": bloom.get("score", 0),
                "contribution": bloom_contribution,
                "label": bloom.get("label"),
                "readyTopics": bloom.get("readyCount", 0),
                "totalTopics": bloom.get("totalTopics", 0),
            },
            "misconceptionHealth": {
                "weight": 0.35,
                "severityScore":  misc.get("severityScore", 0),
                "inverseScore":   round(100 - misc.get("severityScore", 0), 1),
                "contribution":   misc_contribution,
                "persistentCount": misc.get("persistentCount", 0),
            },
            "deliveryState": {
                "weight": 0.20,
                "state":  delivery.get("state", "no_data"),
                "contribution": delivery_contribution,
                "divergenceScore": delivery.get("divergenceScore", 0),
                "warningCount":    delivery.get("warningCount", 0),
            },
        },
        "formula": "H = 0.45 × Bloom_Readiness + 0.35 × (100 - Misconception_Severity) + 0.20 × Delivery_State",
        "neutralBaseline": 45,
        "baselineExplanation": "When no data exists, score defaults to ~45 (neutral 'Developing' state)",
        "recommendation": data.get("recommendation", {}),
    })