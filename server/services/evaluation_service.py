"""
services/evaluation_service.py

Changes from original:
- llm_check_fill_blank_equivalence removed from here.  The LLM equivalence
  check is now batched inside session_routes.submit_answers together with the
  explanation call, cutting one LLM round-trip per fill-blank question.
- compare_objective_answer no longer calls LLM for fill_blank; it only runs
  the fast token-match.  The caller (session_routes) handles the LLM path.
- is_fill_blank_match is now explicitly exported so session_routes can import it.
- Everything else (update_topic_weakness, top_weak_topics, etc.) is unchanged.
"""

import json
import re
import string
from datetime import datetime
from models import GeneratedQuestion
from extensions import db
from utils.ids import generate_id
import hashlib


# ── Topic weakness ────────────────────────────────────────────────────────────

def update_topic_weakness(existing: dict, topic_events: list, alpha: float = 0.25) -> dict:
    if not existing:
        existing = {}

    difficulty_weights = {"easy": 1.15, "medium": 1.0, "hard": 0.85}
    question_type_weights = {
        "mcq": 1.0, "fill_blank": 1.0, "true_false": 0.85, "descriptive": 1.25,
    }
    valid_difficulties = {"easy", "medium", "hard"}
    valid_types        = {"mcq", "fill_blank", "true_false", "descriptive"}

    def normalize_bloom(v):
        s     = str(v or "").strip().title()
        valid = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"}
        return s if s in valid else "Understand"

    def ensure_record(rec):
        if not isinstance(rec, dict):
            rec = {}
        rec.setdefault("score", 0.5)
        rec.setdefault("seen", 0)
        rec.setdefault("last", None)
        rec.setdefault("byDifficulty", {})
        rec.setdefault("byType", {})
        rec.setdefault("byBloom", {})
        for k in ("byDifficulty", "byType", "byBloom"):
            if not isinstance(rec[k], dict):
                rec[k] = {}
        return rec

    def ensure_bucket(bucket_map, key):
        bucket = bucket_map.get(key)
        if not isinstance(bucket, dict):
            bucket = {"score": 0.5, "seen": 0}
        bucket.setdefault("score", 0.5)
        bucket.setdefault("seen", 0)
        return bucket

    # Migrate legacy int-valued records
    for t, v in list(existing.items()):
        if isinstance(v, int):
            existing[t] = {
                "score": min(1.0, 0.5 + 0.1 * v),
                "seen": v, "last": None,
                "byDifficulty": {}, "byType": {}, "byBloom": {},
            }
        elif isinstance(v, dict):
            existing[t] = ensure_record(v)

    now       = datetime.utcnow().isoformat()
    per_topic: dict = {}

    for ev in topic_events:
        topic      = (ev.get("topic") or "General").strip()
        difficulty = str(ev.get("difficulty", "medium")).strip().lower()
        if difficulty not in valid_difficulties:
            difficulty = "medium"

        qtype = str(ev.get("question_type", "mcq")).strip().lower()
        if qtype not in valid_types:
            qtype = "mcq"

        bloom_level = normalize_bloom(ev.get("bloom_level"))

        score_ratio = ev.get("score_ratio")
        if score_ratio is None:
            base_weakness = 0.0 if bool(ev.get("correct")) else 1.0
        else:
            try:
                score_ratio = float(score_ratio)
            except Exception:
                score_ratio = 0.0
            score_ratio   = max(0.0, min(1.0, score_ratio))
            base_weakness = 1.0 - score_ratio

        adjusted = max(0.0, min(1.0,
            base_weakness
            * difficulty_weights.get(difficulty, 1.0)
            * question_type_weights.get(qtype, 1.0)
        ))

        pt = per_topic.setdefault(topic, {
            "weighted_weakness_sum": 0.0, "count": 0,
            "byDifficulty": {}, "byType": {}, "byBloom": {},
        })
        pt["weighted_weakness_sum"] += adjusted
        pt["count"]                 += 1

        for bucket_key, bucket_map in (
            (difficulty, pt["byDifficulty"]),
            (qtype,      pt["byType"]),
            (bloom_level,pt["byBloom"]),
        ):
            b = bucket_map.setdefault(bucket_key, {"weighted_weakness_sum": 0.0, "count": 0})
            b["weighted_weakness_sum"] += adjusted
            b["count"]                 += 1

    for topic, stats in per_topic.items():
        rec            = ensure_record(existing.get(topic, {}))
        target         = stats["weighted_weakness_sum"] / max(stats["count"], 1)
        old_score      = float(rec.get("score", 0.5))
        rec["score"]   = round((1 - alpha) * old_score + alpha * target, 4)
        rec["seen"]    = int(rec.get("seen", 0)) + stats["count"]
        rec["last"]    = now

        for diff, d_stats in stats["byDifficulty"].items():
            b = ensure_bucket(rec["byDifficulty"], diff)
            t = d_stats["weighted_weakness_sum"] / max(d_stats["count"], 1)
            b["score"] = round((1 - alpha) * float(b.get("score", 0.5)) + alpha * t, 4)
            b["seen"]  = int(b.get("seen", 0)) + d_stats["count"]
            rec["byDifficulty"][diff] = b

        for qt, t_stats in stats["byType"].items():
            b = ensure_bucket(rec["byType"], qt)
            t = t_stats["weighted_weakness_sum"] / max(t_stats["count"], 1)
            b["score"] = round((1 - alpha) * float(b.get("score", 0.5)) + alpha * t, 4)
            b["seen"]  = int(b.get("seen", 0)) + t_stats["count"]
            rec["byType"][qt] = b

        for bl, b_stats in stats["byBloom"].items():
            b = ensure_bucket(rec["byBloom"], bl)
            t = b_stats["weighted_weakness_sum"] / max(b_stats["count"], 1)
            b["score"] = round((1 - alpha) * float(b.get("score", 0.5)) + alpha * t, 4)
            b["seen"]  = int(b.get("seen", 0)) + b_stats["count"]
            rec["byBloom"][bl] = b

        existing[topic] = rec

    return existing


def top_weak_topics(existing: dict, k: int = 5, min_seen: int = 1) -> list:
    if not existing:
        return []
    items = []
    for t, v in existing.items():
        if isinstance(v, dict):
            seen = int(v.get("seen", 0))
            if seen >= min_seen:
                items.append((t, float(v.get("score", 0.0)), seen))
        elif isinstance(v, int):
            items.append((t, min(1.0, 0.5 + 0.1 * v), v))
    items.sort(key=lambda x: (x[1], x[2]), reverse=True)
    return [t for (t, _, __) in items[:k]]


# ── Duplicate detection ───────────────────────────────────────────────────────

def is_duplicate(chat_id: str, question: str, topic: str, weak_topics: list) -> bool:
    h = hashlib.sha256(question.encode()).hexdigest()
    existing = GeneratedQuestion.query.filter_by(chat_id=chat_id, question_hash=h).first()
    if existing and topic not in weak_topics:
        return True
    if existing:
        existing.times_asked += 1
    else:
        db.session.add(GeneratedQuestion(
            id=generate_id(), chat_id=chat_id, question_hash=h, topic=topic,
        ))
    return False


# ── Answer normalisation ──────────────────────────────────────────────────────

def normalize_text_answer(v: str) -> str:
    return re.sub(r"\s+", " ", str(v or "").strip()).lower()


def normalize_fill_blank_text(v: str) -> str:
    s = str(v or "").strip().lower()
    s = re.sub(r"[-_/]+", " ", s)
    s = s.translate(str.maketrans("", "", string.punctuation))
    s = re.sub(r"\s+", " ", s).strip()
    return s


def token_set(s: str) -> set:
    return set(normalize_fill_blank_text(s).split())


def is_fill_blank_match(user_ans: str, correct_ans) -> bool:
    """
    Fast token-based match for fill-in-the-blank answers.
    Returns True if the answer is clearly correct without needing an LLM call.
    If this returns False the caller should queue an LLM equivalence check.
    """
    ua = normalize_fill_blank_text(user_ans)
    if not ua:
        return False

    accepted = correct_ans if isinstance(correct_ans, list) else [correct_ans]

    normalized_accepted = [normalize_fill_blank_text(a) for a in accepted if a]
    normalized_accepted = [a for a in normalized_accepted if a]

    if not normalized_accepted:
        return False

    if ua in normalized_accepted:
        return True

    ua_tokens = token_set(ua)
    for ca in normalized_accepted:
        ca_tokens = token_set(ca)
        if ua_tokens == ca_tokens and ua_tokens:
            return True
        if ua_tokens and ca_tokens:
            if ua_tokens.issubset(ca_tokens) or ca_tokens.issubset(ua_tokens):
                if min(len(ua_tokens), len(ca_tokens)) >= 1 and max(len(ua_tokens), len(ca_tokens)) <= 3:
                    return True

    return False


# ── Objective answer comparison ───────────────────────────────────────────────

def compare_objective_answer(user_ans, correct_ans, qtype: str = "mcq") -> bool:
    """
    Compare a student answer to the correct answer.

    For fill_blank this now ONLY runs the fast token match.
    If it returns False the caller (session_routes) handles the LLM path
    in a batch call alongside the explanation prompt.
    """
    if qtype == "mcq":
        return str(user_ans or "").strip().upper() == str(correct_ans or "").strip().upper()

    if qtype == "true_false":
        ua = normalize_text_answer(user_ans)
        ca = normalize_text_answer(correct_ans)
        truthy = {"true", "t", "yes"}
        falsy  = {"false", "f", "no"}
        ua = "true" if ua in truthy else ("false" if ua in falsy else ua)
        ca = "true" if ca in truthy else ("false" if ca in falsy else ca)
        return ua == ca

    if qtype == "fill_blank":
        return is_fill_blank_match(user_ans, correct_ans)

    return normalize_text_answer(user_ans) == normalize_text_answer(correct_ans)


