"""
services/bloom_trajectory_service.py

Predicts readiness to advance to the next Bloom's taxonomy level per topic.

Bloom hierarchy (strict order):
    Remember → Understand → Apply → Analyze → Evaluate → Create

A student is considered "ready" for level N+1 when:
  1. Mastery at level N >= MASTERY_THRESHOLD (default 70%)
  2. They have seen at least MIN_SEEN questions at level N
  3. Mastery trend at level N is non-negative (not actively declining)

Mastery = 1.0 - weakness_score  (your existing score field is a weakness score)

No schema changes. All data from Chat.weak_topics_json (byBloom sub-dict).
"""

import json
from models import Chat, PracticeSession
from logger import get_logger

logger = get_logger("bloom_trajectory_service")

BLOOM_ORDER = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]
BLOOM_INDEX = {b: i for i, b in enumerate(BLOOM_ORDER)}

# Thresholds
MASTERY_THRESHOLD = 0.70   # 70% mastery = ready for next level
MIN_SEEN          = 3      # minimum questions seen at a level before we assess it
SESSIONS_FOR_RATE = 3      # minimum sessions to compute improvement rate


def _mastery(weakness_score: float) -> float:
    """Convert weakness score (0=strong, 1=weak) to mastery (0=weak, 1=strong)."""
    return round(1.0 - max(0.0, min(1.0, weakness_score)), 4)


def _sessions_to_ready(current_mastery: float, improvement_rate: float) -> int | None:
    """
    Estimate sessions needed to reach MASTERY_THRESHOLD.
    improvement_rate = mastery gain per session (can be 0 or negative).
    Returns None if rate is too slow to make a useful prediction.
    """
    if current_mastery >= MASTERY_THRESHOLD:
        return 0
    if improvement_rate <= 0.005:
        return None   # not improving fast enough to predict
    gap = MASTERY_THRESHOLD - current_mastery
    return max(1, round(gap / improvement_rate))


def _get_improvement_rate(chat_id: str, topic: str, bloom_level: str) -> float:
    """
    Estimate per-session mastery improvement rate for a topic+bloom combination.
    Uses the last SESSIONS_FOR_RATE sessions that contained this topic+bloom.
    Returns 0.0 if insufficient data.
    """
    sessions = (
        PracticeSession.query
        .filter_by(chat_id=chat_id)
        .filter(PracticeSession.session_type.in_(["full", "weak", "video_full"]))
        .order_by(PracticeSession.created_at.asc())
        .all()
    )

    # Extract per-session mastery snapshots for this topic+bloom
    mastery_over_time = []
    for s in sessions:
        try:
            feedback = json.loads(s.feedback_json or "{}")
        except Exception:
            continue

        scores = []
        for qid, r in feedback.items():
            if not isinstance(r, dict):
                continue
            if (r.get("topic") or "").strip().lower() != topic.strip().lower():
                continue
            if (r.get("bloomLevel") or "").strip() != bloom_level:
                continue
            raw = r.get("understandingScore")
            if raw is not None:
                try:
                    scores.append(float(raw) / 10.0)
                except Exception:
                    pass

        if scores:
            mastery_over_time.append(sum(scores) / len(scores))

    if len(mastery_over_time) < 2:
        return 0.0

    # Simple average improvement per session
    improvements = [
        mastery_over_time[i] - mastery_over_time[i - 1]
        for i in range(1, len(mastery_over_time))
    ]
    avg = sum(improvements) / len(improvements)
    return max(0.0, round(avg, 4))


def get_bloom_trajectory(chat_id: str) -> dict:
    """
    Main entry point.

    Returns:
    {
        "topics": [
            {
                "topic": "Database Normalization",
                "currentLevel": "Understand",        # highest level with >= MIN_SEEN
                "nextLevel": "Apply",                 # next in hierarchy
                "levels": {
                    "Remember":   { "mastery": 0.85, "seen": 8,  "status": "mastered" },
                    "Understand": { "mastery": 0.62, "seen": 5,  "status": "in_progress",
                                    "sessionsToReady": 3, "improvementRate": 0.04 },
                    "Apply":      { "mastery": 0.0,  "seen": 0,  "status": "not_started" },
                    ...
                },
                "readyToAdvance": false,
                "blockedAt": "Understand",
                "prediction": {
                    "sessionsToNextLevel": 3,
                    "message": "At your current rate, you'll be ready for Apply-level questions in ~3 sessions."
                }
            },
            ...
        ],
        "summary": {
            "topicsReady":       2,
            "topicsInProgress":  4,
            "topicsNotStarted":  1,
        }
    }
    """
    chat = Chat.query.get(chat_id)
    if not chat:
        return {"topics": [], "summary": {}}

    weak_map = {}
    try:
        weak_map = json.loads(chat.weak_topics_json or "{}")
    except Exception:
        pass

    if not weak_map:
        return {"topics": [], "summary": {}}

    topic_results = []

    for topic, rec in weak_map.items():
        if not isinstance(rec, dict):
            continue

        by_bloom = rec.get("byBloom") or {}
        if not by_bloom:
            continue

        levels = {}
        highest_active_idx = -1   # highest level with MIN_SEEN questions seen

        for bloom in BLOOM_ORDER:
            bloom_rec = by_bloom.get(bloom)
            if not isinstance(bloom_rec, dict):
                levels[bloom] = {
                    "mastery": 0.0,
                    "seen":    0,
                    "status":  "not_started",
                    "weaknessScore": 1.0,
                }
                continue

            weakness = float(bloom_rec.get("score", 1.0))
            seen     = int(bloom_rec.get("seen", 0))
            mastery  = _mastery(weakness)

            if seen >= MIN_SEEN:
                if mastery >= MASTERY_THRESHOLD:
                    status = "mastered"
                else:
                    status = "in_progress"
                highest_active_idx = max(highest_active_idx, BLOOM_INDEX[bloom])
            else:
                status = "not_started" if seen == 0 else "insufficient_data"

            levels[bloom] = {
                "mastery":      round(mastery * 100, 1),   # percentage for UI
                "seen":         seen,
                "status":       status,
                "weaknessScore": weakness,
            }

        # Current active level = highest level with sufficient data
        current_level = BLOOM_ORDER[highest_active_idx] if highest_active_idx >= 0 else None
        next_level_idx = highest_active_idx + 1

        # Determine what's blocking advancement
        blocked_at    = None
        ready_to_advance = False
        prediction    = None

        if current_level:
            current_mastery_val = levels[current_level]["mastery"] / 100.0

            if current_mastery_val >= MASTERY_THRESHOLD and next_level_idx < len(BLOOM_ORDER):
                ready_to_advance = True
                next_level = BLOOM_ORDER[next_level_idx]
                prediction = {
                    "sessionsToNextLevel": 0,
                    "message": f"You're ready for {next_level}-level questions on {topic}! "
                               f"Your {current_level} mastery is at "
                               f"{levels[current_level]['mastery']}%."
                }
            elif next_level_idx < len(BLOOM_ORDER):
                blocked_at  = current_level
                next_level  = BLOOM_ORDER[next_level_idx]

                # Compute improvement rate from session history
                rate = _get_improvement_rate(chat_id, topic, current_level)
                levels[current_level]["improvementRate"] = round(rate * 100, 2)  # as %/session

                sessions_needed = _sessions_to_ready(current_mastery_val, rate)
                levels[current_level]["sessionsToReady"] = sessions_needed

                if sessions_needed is not None:
                    prediction = {
                        "sessionsToNextLevel": sessions_needed,
                        "message": (
                            f"At your current pace, you'll be ready for {next_level}-level "
                            f"questions on '{topic}' in ~{sessions_needed} more "
                            f"{'session' if sessions_needed == 1 else 'sessions'}. "
                            f"Current {current_level} mastery: "
                            f"{levels[current_level]['mastery']}% "
                            f"(need {int(MASTERY_THRESHOLD*100)}%)."
                        )
                    }
                else:
                    prediction = {
                        "sessionsToNextLevel": None,
                        "message": (
                            f"Your {current_level} mastery on '{topic}' is at "
                            f"{levels[current_level]['mastery']}% and not improving "
                            f"quickly enough to predict. Focus more practice here."
                        )
                    }
        else:
            # No data at all for any level
            prediction = {
                "sessionsToNextLevel": None,
                "message": f"No Bloom-level data yet for '{topic}'. "
                           f"Complete more practice sessions to see trajectory."
            }

        next_level = BLOOM_ORDER[next_level_idx] if next_level_idx < len(BLOOM_ORDER) else None

        topic_results.append({
            "topic":          topic,
            "currentLevel":   current_level,
            "nextLevel":      next_level,
            "levels":         levels,
            "readyToAdvance": ready_to_advance,
            "blockedAt":      blocked_at,
            "overallMastery": round(rec.get("score", 0.5) * 100, 1),  # weakness → mastery %
            "totalSeen":      int(rec.get("seen", 0)),
            "prediction":     prediction,
        })

    # Sort: ready-to-advance first, then in-progress, then not-started
    def sort_key(t):
        if t["readyToAdvance"]:
            return 0
        if t["currentLevel"]:
            return 1
        return 2

    topic_results.sort(key=sort_key)

    summary = {
        "topicsReady":       sum(1 for t in topic_results if t["readyToAdvance"]),
        "topicsInProgress":  sum(1 for t in topic_results if t["currentLevel"] and not t["readyToAdvance"]),
        "topicsNotStarted":  sum(1 for t in topic_results if not t["currentLevel"]),
        "totalTopics":       len(topic_results),
    }

    return {
        "topics":  topic_results,
        "summary": summary,
    }


def get_adaptive_bloom_levels(chat_id: str, configured_bloom_raw: str) -> list[str]:
    """
    Returns bloom levels appropriate for the student's CURRENT mastery state.
    Called by question_routes.py instead of reading chat.bloom_level directly.

    Logic:
        1. Start from the user's originally configured bloom levels (never exceed these)
        2. For each topic, find the lowest bloom level where mastery < MASTERY_THRESHOLD
        3. That is the "current working level" for that topic
        4. Take the majority vote across all topics
        5. Return that level + one level above (so student practices current AND advances)

    Falls back to configured levels if no trajectory data exists yet.

    Example:
        User configured: Remember, Understand, Apply
        Student mastery at Remember: 74% (mastered), Understand: 40% (not yet)
        Result: ["Understand", "Apply"]
        → No more Remember questions; focus on Understand with some Apply introduced
    """
    from services.exam_service import parse_bloom_levels
    from collections import Counter

    configured = parse_bloom_levels(configured_bloom_raw)
    if not configured:
        return ["Understand"]

    # Get trajectory data — safe fallback if it fails
    try:
        trajectory_data = get_bloom_trajectory(chat_id)
    except Exception:
        return configured

    topics = trajectory_data.get("topics") or []
    if not topics:
        # No data yet (first session) — use configured levels as-is
        return configured

    working_levels = []

    for topic in topics:
        levels      = topic.get("levels") or {}
        current_level = topic.get("currentLevel")

        if not current_level:
            # No data for this topic yet — use first configured level
            if configured:
                working_levels.append(configured[0])
            continue

        current_mastery = (levels.get(current_level) or {}).get("mastery", 0) / 100.0

        if current_mastery >= MASTERY_THRESHOLD:
            # Current level mastered — find next level within configured range
            curr_idx = BLOOM_ORDER.index(current_level) if current_level in BLOOM_ORDER else 0
            next_idx = curr_idx + 1
            if next_idx < len(BLOOM_ORDER):
                next_level = BLOOM_ORDER[next_idx]
                if next_level in configured:
                    working_levels.append(next_level)
                else:
                    # Already at configured ceiling — keep working at current
                    working_levels.append(current_level)
            else:
                # At the top of the Bloom hierarchy — keep at current
                working_levels.append(current_level)
        else:
            # Not mastered yet — keep working at current level
            working_levels.append(current_level)

    if not working_levels:
        return configured

    # Majority vote: most common working level across all topics
    level_counts   = Counter(working_levels)
    dominant_level = level_counts.most_common(1)[0][0]

    # Build result: dominant level + one level above (within configured range)
    result = []
    if dominant_level in BLOOM_ORDER:
        dom_idx = BLOOM_ORDER.index(dominant_level)

        if dominant_level in configured:
            result.append(dominant_level)

        # Include one level up for gradual advancement pressure
        if dom_idx + 1 < len(BLOOM_ORDER):
            next_up = BLOOM_ORDER[dom_idx + 1]
            if next_up in configured and next_up not in result:
                result.append(next_up)

    return result if result else configured
