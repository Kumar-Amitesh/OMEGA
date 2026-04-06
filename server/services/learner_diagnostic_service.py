"""
services/learner_diagnostic_service.py

Unified Learner Diagnostic — combines all three intelligence features into
a single learner state representation with a recommended action.

This is the "multi-dimensional learner model" that makes the system
a unified platform rather than three separate analytics tools.

Dimensions modeled:
  1. Cognitive Advancement Readiness (from bloom_trajectory_service)
     → Are you ready to move to deeper thinking levels?

  2. Misconception Profile (from misconception_service)
     → What specific conceptual confusions are you carrying?

  3. Behavioral Delivery State (from delivery_trend_service)
     → Is your interview delivery improving or degrading?

Output:
  A single JSON object — the "Learner Diagnostic Profile" — that can be
  shown as a summary card and used to generate one prioritized recommendation.

Bloom Readiness Score formula:
    score = (ready_topics / total_topics) * 100
          - (blocked_topics * 10)           # penalty for stuck topics
          + (improving_topics * 5)          # bonus for upward trajectory

    Clamped to [0, 100]. Higher = more cognitively ready across all topics.
"""

import json
from services.bloom_trajectory_service import get_bloom_trajectory
from services.misconception_service    import get_misconceptions_for_chat
from services.delivery_trend_service   import get_delivery_trends
from models import Chat
from logger import get_logger

logger = get_logger("learner_diagnostic_service")


# ── Bloom Readiness Score ─────────────────────────────────────────────────────

def _compute_bloom_readiness_score(bloom_data: dict) -> dict:
    """
    Converts the per-topic Bloom trajectory into a single 0–100 readiness score.

    Formula:
        base  = (ready_count / total) * 100
        bonus = improving_count * 5        (topics with positive improvement rate)
        penalty = blocked_count * 10       (topics stuck at same level)
        score = clamp(base + bonus - penalty, 0, 100)

    Returns:
        {
            "score": float,          # 0–100
            "label": str,            # "Advanced" | "Progressing" | "Developing" | "Foundational"
            "readyCount":   int,
            "blockedCount": int,
            "totalTopics":  int,
        }
    """
    topics = bloom_data.get("topics") or []
    if not topics:
        return {"score": 0.0, "label": "No Data", "readyCount": 0,
                "blockedCount": 0, "totalTopics": 0}

    total    = len(topics)
    ready    = sum(1 for t in topics if t.get("readyToAdvance"))
    blocked  = sum(
        1 for t in topics
        if t.get("blockedAt") and not t.get("readyToAdvance")
        and t.get("prediction", {}).get("sessionsToNextLevel") is None
    )
    improving = sum(
        1 for t in topics
        if t.get("blockedAt")
        and t.get("prediction", {}).get("sessionsToNextLevel") is not None
    )

    base    = (ready / total) * 100 if total > 0 else 0
    bonus   = improving * 5
    penalty = blocked   * 10

    score = round(max(0.0, min(100.0, base + bonus - penalty)), 1)

    label = (
        "Advanced"    if score >= 75
        else "Progressing" if score >= 50
        else "Developing"  if score >= 25
        else "Foundational"
    )

    return {
        "score":        score,
        "label":        label,
        "readyCount":   ready,
        "blockedCount": blocked,
        "totalTopics":  total,
    }


# ── Misconception Severity Summary ────────────────────────────────────────────

def _summarize_misconceptions(misconception_data: dict) -> dict:
    """
    Extracts key signals from the misconception profile for the diagnostic card.

    Returns:
        {
            "severityScore": float,   # 0–100 (avg of topic misconception scores)
            "persistentCount": int,   # topics with persistent misconceptions
            "topMisconception": str,  # label of highest-confidence misconception
            "topTopic": str,          # topic with highest misconception score
        }
    """
    topics = misconception_data.get("topics") or []
    if not topics:
        return {"severityScore": 0.0, "persistentCount": 0,
                "topMisconception": None, "topTopic": None}

    scores = [t.get("misconceptionScore", 0) for t in topics if t.get("hasEnoughData")]
    avg_severity = round(sum(scores) / len(scores), 1) if scores else 0.0

    persistent_count = misconception_data.get("persistentTopicCount", 0)

    # Top misconception = highest confidence cluster across all topics
    top_mc    = None
    top_conf  = 0.0
    top_topic = None

    for t in topics:
        for mc in (t.get("misconceptions") or []):
            conf = mc.get("confidenceScore", 0.0)
            if conf > top_conf:
                top_conf  = conf
                top_mc    = mc.get("label")
                top_topic = t.get("topic")

    return {
        "severityScore":    avg_severity,
        "persistentCount":  persistent_count,
        "topMisconception": top_mc,
        "topTopic":         top_topic,
        "topConfidence":    round(top_conf, 3),
    }


# ── Delivery State Summary ────────────────────────────────────────────────────

def _summarize_delivery(delivery_data: dict) -> dict:
    """
    Extracts key signals from delivery trend data for the diagnostic card.

    Returns:
        {
            "state": str,       # "improving" | "stable" | "at_risk" | "no_data"
            "divergenceScore": float,   # content_slope - delivery_slope
            "warningCount": int,
            "topWarning": str | None,
        }
    """
    if not delivery_data.get("hasSufficientData"):
        return {"state": "no_data", "divergenceScore": 0.0,
                "warningCount": 0, "topWarning": None}

    trends   = delivery_data.get("trends") or {}
    warnings = delivery_data.get("warnings") or []

    # Compute divergence score
    # divergence = avg(content slopes) - avg(delivery slopes)
    # Positive = content improving faster than delivery = over-rehearsal risk
    content_trends  = trends.get("content",  {})
    delivery_trends = trends.get("delivery", {})

    content_slopes  = [v.get("slope", 0) for v in content_trends.values()]
    delivery_slopes = [v.get("slope", 0) for v in delivery_trends.values()]

    avg_content  = sum(content_slopes)  / len(content_slopes)  if content_slopes  else 0
    avg_delivery = sum(delivery_slopes) / len(delivery_slopes) if delivery_slopes else 0

    divergence_score = round(avg_content - avg_delivery, 3)

    # State classification
    verdict = delivery_data.get("overallVerdict", "stable")
    if warnings:
        state = "at_risk"
    elif verdict == "improving":
        state = "improving"
    elif divergence_score > 0.3:
        state = "at_risk"
    else:
        state = "stable"

    top_warning = None
    if warnings:
        high_warnings = [w for w in warnings if w.get("severity") == "high"]
        top_warning = (high_warnings or warnings)[0].get("message")

    return {
        "state":           state,
        "divergenceScore": divergence_score,
        "warningCount":    len(warnings),
        "topWarning":      top_warning,
    }


# ── Recommendation engine ─────────────────────────────────────────────────────

def _generate_recommendation(
    bloom_summary:         dict,
    misconception_summary: dict,
    delivery_summary:      dict,
    is_jd_chat:            bool,
) -> dict:
    """
    Generates one prioritized recommendation based on the most urgent signal.

    Priority order:
        1. Delivery at risk (over-rehearsal) — most time-sensitive
        2. Persistent misconception — conceptual blocker
        3. Bloom blocked with no improvement — cognitive stall
        4. Ready to advance — positive reinforcement
        5. Default — general encouragement

    Returns:
        {
            "priority": "high" | "medium" | "low",
            "category": "delivery" | "misconception" | "bloom" | "general",
            "action": str,    # one sentence
            "detail": str,    # one sentence elaboration
        }
    """

    # 1. Delivery at risk
    if delivery_summary["state"] == "at_risk" and is_jd_chat:
        return {
            "priority": "high",
            "category": "delivery",
            "action":   "Rephrase your interview answers in completely different words this session.",
            "detail":   delivery_summary.get("topWarning") or
                        "Your delivery naturalness is declining while content stays strong — a sign of over-rehearsal.",
        }

    # 2. Persistent misconception
    if misconception_summary["persistentCount"] > 0 and misconception_summary["topMisconception"]:
        return {
            "priority": "high",
            "category": "misconception",
            "action":   f"Review the concept behind: '{misconception_summary['topMisconception']}'.",
            "detail":   f"This misconception has appeared across multiple sessions on "
                        f"'{misconception_summary['topTopic']}'. It is blocking accurate recall.",
        }

    # 3. Bloom blocked with no improvement
    if bloom_summary["blockedCount"] > 0:
        return {
            "priority": "medium",
            "category": "bloom",
            "action":   "Focus your next session on the topics shown as blocked in Bloom Path.",
            "detail":   f"{bloom_summary['blockedCount']} topic(s) are stuck at their current "
                        f"cognitive level with no measurable improvement trend.",
        }

    # 4. Ready to advance
    if bloom_summary["readyCount"] > 0:
        return {
            "priority": "low",
            "category": "bloom",
            "action":   "Try harder questions — you are ready to advance on some topics.",
            "detail":   f"{bloom_summary['readyCount']} topic(s) have crossed the mastery "
                        f"threshold and are ready for the next Bloom level.",
        }

    # 5. Default
    return {
        "priority": "low",
        "category": "general",
        "action":   "Keep practicing to build up your diagnostic data.",
        "detail":   "Complete more sessions to unlock detailed misconception and trajectory insights.",
    }


# ── Main entry point ──────────────────────────────────────────────────────────

def get_learner_diagnostic(chat_id: str, is_jd_chat: bool = False) -> dict:
    """
    Unified Learner Diagnostic Profile.

    Calls all three intelligence services and combines their outputs into
    a single structured learner state with one prioritized recommendation.

    Returns:
    {
        "bloomReadiness": {
            "score": 62.5,              # 0–100 overall cognitive readiness
            "label": "Progressing",
            "readyCount": 2,
            "blockedCount": 1,
            "totalTopics": 5,
        },
        "misconceptionProfile": {
            "severityScore": 45.2,      # 0–100 overall misconception severity
            "persistentCount": 1,       # topics with 3+ session misconceptions
            "topMisconception": "Confusing 2NF with 3NF",
            "topTopic": "Normalization",
            "topConfidence": 0.72,
        },
        "deliveryState": {
            "state": "at_risk",         # improving | stable | at_risk | no_data
            "divergenceScore": 0.84,    # content_slope - delivery_slope
            "warningCount": 1,
            "topWarning": "...",
        },
        "recommendation": {
            "priority": "high",
            "category": "delivery",
            "action": "Rephrase your answers...",
            "detail": "...",
        },
        "overallHealthScore": 58.3,     # composite 0–100 (higher = better)
        "dataAvailability": {
            "hasBloomData": true,
            "hasMisconceptionData": true,
            "hasDeliveryData": false,
        }
    }
    """
    # Fetch all three data sources — each handles its own errors internally
    bloom_data         = {}
    misconception_data = {}
    delivery_data      = {}

    try:
        bloom_data = get_bloom_trajectory(chat_id)
    except Exception as e:
        logger.warning("[diagnostic] bloom fetch failed: %s", e)

    try:
        misconception_data = get_misconceptions_for_chat(chat_id)
    except Exception as e:
        logger.warning("[diagnostic] misconception fetch failed: %s", e)

    try:
        delivery_data = get_delivery_trends(chat_id)
    except Exception as e:
        logger.warning("[diagnostic] delivery fetch failed: %s", e)

    # Summarize each dimension
    bloom_summary         = _compute_bloom_readiness_score(bloom_data)
    misconception_summary = _summarize_misconceptions(misconception_data)
    delivery_summary      = _summarize_delivery(delivery_data)

    # Data availability flags
    has_bloom         = bool(bloom_data.get("topics"))
    has_misconception = bool(misconception_data.get("totalWrongAnswers", 0) > 0)
    has_delivery      = bool(delivery_data.get("hasSufficientData"))

    # Overall health score (composite, higher = better learner state)
    # Bloom component:         readiness score contributes positively
    # Misconception component: severity score contributes negatively
    # Delivery component:      divergence contributes negatively when positive
    bloom_contribution         = bloom_summary["score"] * 0.45
    misconception_contribution = (100 - misconception_summary["severityScore"]) * 0.35
    delivery_contribution      = (
        (50 - min(50, max(-50, delivery_summary["divergenceScore"] * 20))) * 0.20
        if has_delivery
        else 50 * 0.20   # neutral when no data
    )

    overall_health = round(
        bloom_contribution + misconception_contribution + delivery_contribution,
        1
    )

    # Generate recommendation
    recommendation = _generate_recommendation(
        bloom_summary, misconception_summary, delivery_summary, is_jd_chat
    )

    return {
        "bloomReadiness":       bloom_summary,
        "misconceptionProfile": misconception_summary,
        "deliveryState":        delivery_summary,
        "recommendation":       recommendation,
        "overallHealthScore":   overall_health,
        "dataAvailability": {
            "hasBloomData":         has_bloom,
            "hasMisconceptionData": has_misconception,
            "hasDeliveryData":      has_delivery,
        },
    }