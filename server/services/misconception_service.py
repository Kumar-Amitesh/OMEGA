"""
services/misconception_service.py

Changes from original:
- Replaced module-level _cache: dict = {} with Redis-backed caching via
  cache_service.py (which already manages the Redis connection).

  Why this matters:
  The old dict was per-worker-process. Under Gunicorn with N workers:
    - Worker A builds and stores misconception data for chat_X
    - User submits answers → invalidate_misconception_cache(chat_X) runs on Worker B
    - Worker B clears its own empty cache. Worker A still has stale data.
    - Next request hits Worker A → returns stale misconceptions.
  With Redis the cache is shared across all workers, so invalidation works
  correctly regardless of which worker handles each request.

  If Redis is unavailable (cache_service returns None), the function simply
  recomputes every time — same behaviour as having no cache at all, which
  is always correct (just slower). The application never breaks.

- Everything else (confidence scores, persistence detection, LLM labeling,
  topic misconception score) is unchanged.
"""

import json
import math
from collections import defaultdict
from models.misconception import MisconceptionRecord
from llm import call_gemini
from logger import get_logger
from services.cache_service import cache_get, cache_set, cache_delete

logger = get_logger("misconception_service")

MIN_WRONG_ANSWERS     = 1
PERSISTENCE_THRESHOLD = 1    # sessions before a misconception is "persistent"
_CACHE_TTL            = 300  # seconds — same as original


def _cache_key(chat_id: str) -> str:
    return f"misconceptions:{chat_id}"


# ── Wrong answer recording ────────────────────────────────────────────────────

def record_wrong_answer(
    chat_id:     str,
    session_id:  str,
    topic:       str,
    bloom_level: str,
    difficulty:  str,
    question:    dict,
    user_answer: str,
) -> None:
    from extensions import db
    import re

    qtype          = str(question.get("type") or "mcq").strip().lower()
    correct_letter = str(question.get("answer") or "").strip().upper()
    chosen_raw     = str(user_answer or "").strip()

    if not chosen_raw:
        return

    if qtype == "mcq":
        options       = question.get("options") or []
        chosen_letter = chosen_raw.upper()
        if not options or not correct_letter or not chosen_letter:
            return
        if correct_letter == chosen_letter:
            return

        def option_text(letter: str) -> str:
            idx = ord(letter) - ord("A")
            if 0 <= idx < len(options):
                raw = str(options[idx] or "")
                return re.sub(r"^[A-D]\s*[\)\.\:\-]\s*", "", raw).strip()
            return ""

        correct_text = option_text(correct_letter)
        chosen_text  = option_text(chosen_letter)
        if not correct_text or not chosen_text:
            return
        correct_option = correct_letter
        chosen_option  = chosen_letter

    elif qtype == "true_false":
        correct_text  = str(correct_letter).capitalize()
        chosen_text   = chosen_raw.capitalize()
        if correct_text.lower() == chosen_text.lower():
            return
        correct_option = correct_text
        chosen_option  = chosen_text

    elif qtype == "fill_blank":
        correct_answer = question.get("answer") or ""
        correct_text   = str(correct_answer).strip()
        chosen_text    = chosen_raw
        if not correct_text or not chosen_text:
            return
        if len(chosen_text) > 200:
            return
        correct_option = correct_text[:50]
        chosen_option  = chosen_text[:50]

    else:
        return

    try:
        record = MisconceptionRecord(
            chat_id        = chat_id,
            session_id     = session_id,
            topic          = topic,
            bloom_level    = bloom_level,
            difficulty     = difficulty,
            question_text  = str(question.get("question") or "")[:500],
            correct_option = correct_option[:10],
            chosen_option  = chosen_option[:10],
            correct_text   = correct_text[:300],
            chosen_text    = chosen_text[:300],
        )
        db.session.add(record)
        db.session.flush()
    except Exception as e:
        logger.warning("[misconception] failed to record wrong answer: %s", e)


# ── Confidence score ──────────────────────────────────────────────────────────

def _compute_confidence_score(cluster_frequency: int, total_wrong: int) -> float:
    """
    Formula: (cluster_frequency / total_wrong) * log(1 + cluster_frequency)
    Normalized to [0, 1].
    """
    if total_wrong <= 0 or cluster_frequency <= 0:
        return 0.0
    raw     = (cluster_frequency / total_wrong) * math.log(1 + cluster_frequency)
    max_raw = 1.0 * math.log(1 + total_wrong)
    if max_raw <= 0:
        return 0.0
    return round(min(1.0, raw / max_raw), 3)


# ── Persistence detection ─────────────────────────────────────────────────────

def _detect_persistent_misconceptions(chat_id: str, topic: str) -> dict:
    records = (
        MisconceptionRecord.query
        .filter_by(chat_id=chat_id, topic=topic)
        .all()
    )
    distinct_sessions = len(set(r.session_id for r in records if r.session_id))
    return {
        "isPersistent":  distinct_sessions >= PERSISTENCE_THRESHOLD,
        "sessionCount":  distinct_sessions,
        "threshold":     PERSISTENCE_THRESHOLD,
    }


# ── Topic misconception score ─────────────────────────────────────────────────

def _compute_topic_misconception_score(
    wrong_count: int, total_sessions: int, top_confidence: float,
) -> float:
    if total_sessions <= 0:
        return 0.0
    wrong_density      = min(1.0, wrong_count / max(1, total_sessions * 3))
    persistence_factor = min(1.0, total_sessions / PERSISTENCE_THRESHOLD)
    raw = (wrong_density * 50) + (top_confidence * 30) + (persistence_factor * 20)
    return round(min(100.0, raw), 1)


# ── LLM misconception labeling ────────────────────────────────────────────────

def _label_misconceptions_with_llm(
    topic: str, wrong_pairs: list, qtype_hint: str = "mixed",
) -> list:
    if qtype_hint == "true_false":
        context_note = (
            "These are True/False questions. The student believed the opposite "
            "of the correct answer. Focus on what misconception would cause "
            "them to invert their belief about this concept."
        )
    elif qtype_hint == "fill_blank":
        context_note = (
            "These are fill-in-the-blank questions. The 'chosen' field shows "
            "what the student typed instead of the correct answer. Focus on "
            "conceptual confusion between terms, not spelling errors."
        )
    else:
        context_note = (
            "These are multiple choice questions. The 'chosen' field shows "
            "which specific wrong option the student picked."
        )

    prompt = f"""
You are an educational assessment expert analyzing student mistakes.

Topic: {topic}
Question type context: {context_note}

Wrong answer patterns (correct vs what student chose, with frequency):
{json.dumps(wrong_pairs[:20], indent=2)}

Group these into 2-4 distinct MISCONCEPTION CLUSTERS.
Each cluster = a specific conceptual confusion, not just "they got it wrong".

Return ONLY valid JSON:
{{
  "misconceptions": [
    {{
      "label": "Short name e.g. 'Confusing 2NF with 3NF'",
      "description": "What conceptual confusion this reveals (1-2 sentences)",
      "frequency": <total wrong answers in this cluster>,
      "correctConcept": "What the student should understand instead",
      "wrongAnswerExamples": ["example 1", "example 2"]
    }}
  ]
}}

Rules:
- Be specific — "confused X with Y" is better than "doesn't understand X"
- If wrong answers don't form clear clusters, still return 1-2 general patterns
- frequency should add up to approximately the total number of wrong answers
"""
    try:
        result = call_gemini(prompt, expect_json=True)
        if isinstance(result, dict):
            misconceptions = result.get("misconceptions") or []
            if isinstance(misconceptions, list):
                return misconceptions
    except Exception as e:
        logger.warning("[misconception] LLM call failed for topic %s: %s", topic, e)
    return []


# ── Main entry point ──────────────────────────────────────────────────────────

def get_misconceptions_for_chat(chat_id: str) -> dict:
    """
    Returns misconception analysis for a chat.

    Caching: uses Redis (via cache_service) so the result is shared across
    all Gunicorn worker processes. If Redis is unavailable, recomputes every
    time — always correct, just slower.

    Cache is invalidated by invalidate_misconception_cache() which is called
    from session_routes after every answer submission.
    """
    # ── Try Redis cache first ─────────────────────────────────────────────
    key    = _cache_key(chat_id)
    cached = cache_get(key)
    if cached is not None:
        logger.debug("[misconception] cache hit for chat=%s", chat_id)
        return cached

    logger.debug("[misconception] cache miss for chat=%s — recomputing", chat_id)

    # ── Query all wrong answers for this chat ─────────────────────────────
    records = (
        MisconceptionRecord.query
        .filter_by(chat_id=chat_id)
        .order_by(MisconceptionRecord.created_at.asc())
        .all()
    )

    total_wrong = len(records)

    if total_wrong == 0:
        result = {
            "hasMisconceptions":    False,
            "totalWrongAnswers":    0,
            "topics":               [],
            "persistentTopicCount": 0,
        }
        cache_set(key, result, _CACHE_TTL)
        return result

    # Group by topic
    by_topic: dict = defaultdict(list)
    for r in records:
        by_topic[r.topic].append(r)

    total_sessions = len(set(r.session_id for r in records if r.session_id))
    topic_results  = []

    for topic, topic_records in sorted(by_topic.items(), key=lambda x: -len(x[1])):
        wrong_count    = len(topic_records)
        topic_sessions = len(set(r.session_id for r in topic_records if r.session_id))

        # Separate by question type
        by_type: dict = defaultdict(list)
        for r in topic_records:
            co = str(r.correct_option or "")
            if co.upper() in ("A", "B", "C", "D"):
                by_type["mcq"].append(r)
            elif co.lower() in ("true", "false"):
                by_type["true_false"].append(r)
            else:
                by_type["fill_blank"].append(r)

        all_patterns       = []
        all_misconceptions = []
        top_confidence     = 0.0

        for qtype, type_records in by_type.items():
            pair_counts: dict = defaultdict(lambda: {"count": 0, "questions": []})
            for r in type_records:
                key_pair = (r.correct_text or "", r.chosen_text or "")
                pair_counts[key_pair]["count"] += 1
                if len(pair_counts[key_pair]["questions"]) < 3:
                    pair_counts[key_pair]["questions"].append(r.question_text or "")

            patterns = [
                {
                    "correct":  pair[0],
                    "chosen":   pair[1],
                    "count":    info["count"],
                    "question": info["questions"][0] if info["questions"] else "",
                    "type":     qtype,
                }
                for pair, info in sorted(
                    pair_counts.items(), key=lambda x: -x[1]["count"]
                )
            ]
            all_patterns.extend(patterns)

            raw_instances = [
                {
                    "question":      r.question_text or "",
                    "correctOption": r.correct_option or "",
                    "correctText":   r.correct_text or "",
                    "chosenOption":  r.chosen_option or "",
                    "chosenText":    r.chosen_text or "",
                    "bloomLevel":    r.bloom_level or "",
                    "difficulty":    r.difficulty or "",
                    "questionType":  qtype,
                }
                for r in type_records
            ]

            if len(type_records) >= MIN_WRONG_ANSWERS:
                misconceptions   = _label_misconceptions_with_llm(topic, patterns, qtype_hint=qtype)
                persistence_info = _detect_persistent_misconceptions(chat_id, topic)

                for mc in misconceptions:
                    cluster_freq = int(mc.get("frequency") or 1)
                    confidence   = _compute_confidence_score(cluster_freq, wrong_count)

                    mc["confidenceScore"] = confidence
                    mc["confidenceLabel"] = (
                        "high"   if confidence >= 0.65
                        else "medium" if confidence >= 0.35
                        else "low"
                    )
                    mc["isPersistent"]  = persistence_info["isPersistent"]
                    mc["sessionCount"]  = persistence_info["sessionCount"]
                    mc["rawInstances"]  = raw_instances

                    if confidence > top_confidence:
                        top_confidence = confidence

                all_misconceptions.extend(misconceptions)

        misconception_score = _compute_topic_misconception_score(
            wrong_count, topic_sessions, top_confidence,
        )

        topic_results.append({
            "topic":              topic,
            "wrongAnswerCount":   wrong_count,
            "sessionCount":       topic_sessions,
            "hasEnoughData":      wrong_count >= MIN_WRONG_ANSWERS,
            "minNeeded":          MIN_WRONG_ANSWERS,
            "misconceptions":     all_misconceptions,
            "misconceptionScore": misconception_score,
            "rawPatterns":        all_patterns[:10],
            "byType": {
                qtype: len(recs) for qtype, recs in by_type.items()
            },
        })

    topic_results.sort(key=lambda t: -t["misconceptionScore"])

    persistent_count = sum(
        1 for t in topic_results
        if any(m.get("isPersistent") for m in t["misconceptions"])
    )

    result = {
        "hasMisconceptions":    any(
            t["hasEnoughData"] and t["misconceptions"] for t in topic_results
        ),
        "totalWrongAnswers":    total_wrong,
        "totalSessions":        total_sessions,
        "persistentTopicCount": persistent_count,
        "topics":               topic_results,
    }

    # ── Write to Redis cache ──────────────────────────────────────────────
    cache_set(key, result, _CACHE_TTL)
    return result


def invalidate_misconception_cache(chat_id: str) -> None:
    """
    Delete the cached misconception result for this chat from Redis.
    Called after every answer submission so next request gets fresh data.
    Safe no-op if Redis is unavailable.
    """
    cache_delete(_cache_key(chat_id))
    logger.debug("[misconception] cache invalidated for chat=%s", chat_id)

