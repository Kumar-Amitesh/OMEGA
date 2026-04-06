"""
services/delivery_trend_service.py

Analyzes delivery and naturalness metric trends across JD video interview sessions.

Key insight: if content scores are stable or improving while naturalness/delivery
scores are declining, the candidate is likely over-rehearsing — answers start
sounding scripted even as factual content improves.

No schema changes required. All data comes from existing PracticeSession.feedback_json.
"""

import json
from models import PracticeSession
from logger import get_logger

logger = get_logger("delivery_trend_service")

# Minimum sessions needed before we surface any trend analysis
MIN_SESSIONS_FOR_TREND = 1

# Minimum drop in score (0-10 scale) to flag as a warning
DEGRADATION_THRESHOLD = 1.5

# Metric paths inside videoFeedback — (display_label, nested_key, sub_key)
DELIVERY_METRICS = [
    ("Clarity",       "delivery",   "clarity"),
    ("Confidence",    "delivery",   "confidencePresentation"),
    ("Pacing",        "delivery",   "pacing"),
    ("Filler Words",  "delivery",   "fillerWords"),
    ("Naturalness",   "naturalness","score"),
    ("Overall",       None,         "overallScore"),
]

CONTENT_METRICS = [
    ("Relevance",     "content",    "answerRelevance"),
    ("Completeness",  "content",    "completeness"),
    ("Structure",     "content",    "structure"),
    ("Examples",      "content",    "examplesSpecificity"),
]


def _extract_metric(feedback: dict, section: str | None, key: str):
    """Safely extract a single metric value from a feedback dict."""
    try:
        if section is None:
            val = feedback.get(key)
        else:
            val = (feedback.get(section) or {}).get(key)
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _average_metrics_for_session(feedback_map: dict, metrics: list) -> dict:
    """
    Given a session's full feedback_map (keyed by question id),
    average each metric across all questions in that session.
    Returns {metric_label: avg_value} — None if no data for that metric.
    """
    accum = {label: [] for label, _, _ in metrics}

    for qid, fb in feedback_map.items():
        if not isinstance(fb, dict):
            continue
        # videoFeedback is nested inside each question result for jd_video sessions
        vfb = fb.get("videoFeedback") or fb
        if not vfb:
            continue
        for label, section, key in metrics:
            val = _extract_metric(vfb, section, key)
            if val is not None:
                accum[label].append(val)

    return {
        label: round(sum(vals) / len(vals), 2) if vals else None
        for label, vals in accum.items()
    }


def _linear_trend(values: list[float]) -> float:
    """
    Simple linear regression slope for a list of values.
    Positive = improving, negative = declining.
    Returns slope per session unit.
    """
    n = len(values)
    if n < 2:
        return 0.0
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n
    numerator   = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    denominator = sum((i - x_mean) ** 2 for i in range(n))
    if denominator == 0:
        return 0.0
    return round(numerator / denominator, 4)


def _compare_halves(values: list[float]) -> float:
    """
    Compare average of first half vs second half.
    Returns (second_half_avg - first_half_avg) — negative means decline.
    """
    if len(values) < 2:
        return 0.0
    mid = len(values) // 2
    early = values[:mid]
    recent = values[mid:]
    early_avg  = sum(early)  / len(early)
    recent_avg = sum(recent) / len(recent)
    return round(recent_avg - early_avg, 2)


def get_delivery_trends(chat_id: str) -> dict:
    """
    Main entry point. Analyzes all jd_video sessions for a chat.

    Returns:
    {
        "hasSufficientData": bool,
        "sessionCount": int,
        "sessions": [
            {
                "sessionId": str,
                "sessionNumber": int,
                "createdAt": str,
                "delivery": { "Clarity": 7.2, "Confidence": 6.8, ... },
                "content":  { "Relevance": 8.1, ... },
            },
            ...
        ],
        "trends": {
            "delivery": { "Clarity": {"slope": -0.3, "halfDiff": -1.2, "first": 7.5, "last": 6.1} },
            "content":  { "Relevance": {"slope": 0.1, ...} },
        },
        "warnings": [
            {
                "type": "over_rehearsal",
                "metric": "Naturalness",
                "drop": 2.1,
                "contentTrend": "stable",
                "message": "..."
            },
            ...
        ],
        "overallVerdict": "improving" | "degrading" | "stable" | "mixed"
    }
    """
    sessions = (
        PracticeSession.query
        .filter_by(chat_id=chat_id, session_type="jd_video")
        .order_by(PracticeSession.created_at.asc())
        .all()
    )

    if not sessions:
        return {"hasSufficientData": False, "sessionCount": 0, "sessions": [], "trends": {}, "warnings": [], "overallVerdict": "stable"}

    session_data = []
    for i, s in enumerate(sessions):
        try:
            feedback_map = json.loads(s.feedback_json or "{}")
        except Exception:
            feedback_map = {}

        delivery_avgs = _average_metrics_for_session(feedback_map, DELIVERY_METRICS)
        content_avgs  = _average_metrics_for_session(feedback_map, CONTENT_METRICS)

        session_data.append({
            "sessionId":     s.id,
            "sessionNumber": i + 1,
            "createdAt":     s.created_at.isoformat() if s.created_at else None,
            "score":         s.score,
            "delivery":      delivery_avgs,
            "content":       content_avgs,
        })

    if len(session_data) < MIN_SESSIONS_FOR_TREND:
        return {
            "hasSufficientData": False,
            "sessionCount": len(session_data),
            "sessions": session_data,
            "trends": {},
            "warnings": [],
            "overallVerdict": "stable",
            "minSessionsNeeded": MIN_SESSIONS_FOR_TREND,
        }

    # ── Compute per-metric trends ─────────────────────────────────────────
    def compute_trends(metrics: list, key: str) -> dict:
        result = {}
        for label, _, _ in metrics:
            values = [
                sd[key][label]
                for sd in session_data
                if sd[key].get(label) is not None
            ]
            if len(values) < 2:
                continue
            result[label] = {
                "slope":    _linear_trend(values),
                "halfDiff": _compare_halves(values),
                "first":    round(values[0], 2),
                "last":     round(values[-1], 2),
                "values":   values,
            }
        return result

    delivery_trends = compute_trends(DELIVERY_METRICS, "delivery")
    content_trends  = compute_trends(CONTENT_METRICS,  "content")

    # ── Generate warnings ─────────────────────────────────────────────────
    warnings = []

    # Average content trend slope — used to assess whether content is stable
    content_slopes = [v["slope"] for v in content_trends.values()]
    avg_content_slope = sum(content_slopes) / len(content_slopes) if content_slopes else 0.0
    content_status = (
        "improving" if avg_content_slope > 0.1
        else "declining" if avg_content_slope < -0.1
        else "stable"
    )

    # Check each delivery/naturalness metric for concerning drops
    key_metrics_to_watch = ["Naturalness", "Confidence", "Clarity", "Filler Words"]

    for metric in key_metrics_to_watch:
        trend = delivery_trends.get(metric)
        if not trend:
            continue

        drop = trend["first"] - trend["last"]  # positive = declined

        # Over-rehearsal signal: delivery declining while content stable/improving
        if drop >= DEGRADATION_THRESHOLD and content_status in ("stable", "improving"):
            if metric == "Naturalness":
                message = (
                    f"Your naturalness score dropped {drop:.1f} points over "
                    f"{len(session_data)} sessions while content quality remained "
                    f"{content_status}. Your answers may be sounding over-rehearsed "
                    f"or scripted. Try rephrasing your answers in your own words "
                    f"rather than memorizing them."
                )
            elif metric == "Filler Words":
                message = (
                    f"Your filler word score dropped {drop:.1f} points (more fillers detected) "
                    f"across recent sessions. This can indicate nervousness or losing "
                    f"natural flow despite knowing the content well."
                )
            else:
                message = (
                    f"Your {metric.lower()} score has dropped {drop:.1f} points across "
                    f"your last {len(session_data)} sessions while content quality "
                    f"remained {content_status}. This divergence may indicate "
                    f"delivery fatigue or over-preparation."
                )

            warnings.append({
                "type":         "over_rehearsal" if metric == "Naturalness" else "delivery_fatigue",
                "metric":       metric,
                "drop":         round(drop, 1),
                "firstScore":   trend["first"],
                "lastScore":    trend["last"],
                "contentTrend": content_status,
                "message":      message,
                "severity":     "high" if drop >= 3.0 else "medium",
            })

        # General decline (both content and delivery dropping)
        elif drop >= DEGRADATION_THRESHOLD and content_status == "declining":
            warnings.append({
                "type":         "general_decline",
                "metric":       metric,
                "drop":         round(drop, 1),
                "firstScore":   trend["first"],
                "lastScore":    trend["last"],
                "contentTrend": content_status,
                "message": (
                    f"Both your {metric.lower()} and content quality are declining. "
                    f"Consider taking a break before your next practice session."
                ),
                "severity": "high" if drop >= 3.0 else "medium",
            })

    # ── Overall verdict ───────────────────────────────────────────────────
    overall_trend_score = sum(
        v["slope"] for v in {**delivery_trends, **content_trends}.values()
    )
    n_metrics = len(delivery_trends) + len(content_trends)
    avg_overall = overall_trend_score / n_metrics if n_metrics else 0

    if warnings and avg_overall < 0:
        verdict = "degrading"
    elif avg_overall > 0.15:
        verdict = "improving"
    elif abs(avg_overall) <= 0.05:
        verdict = "stable"
    else:
        verdict = "mixed"

    return {
        "hasSufficientData": True,
        "sessionCount":      len(session_data),
        "sessions":          session_data,
        "trends": {
            "delivery": delivery_trends,
            "content":  content_trends,
        },
        "warnings":          warnings,
        "overallVerdict":    verdict,
        "contentStatus":     content_status,
    }