"""
services/topic_service.py

Changes from original:
- Replaced unbounded module-level _topic_emb_cache dict with a bounded LRU
  cache (max 128 entries).  The old dict grew forever because keys are
  tuple(allowed_topics) and were never evicted, causing a memory leak in
  long-running worker processes.
- Everything else is unchanged.
"""

import json
from collections import OrderedDict
from typing import Optional

import numpy as np
from models import SubjectTopic
from extensions import db
from llm import call_gemini
from services.embedding_service import get_embedding_model


# ── Bounded LRU cache for topic embeddings ────────────────────────────────────
# Keyed by tuple(sorted(allowed_topics)) so the same topic list always hits
# the same cache entry regardless of order.
# Max 128 entries keeps memory bounded (each entry ≈ n_topics * 384 floats).

_CACHE_MAX = 128


class _LRUCache:
    """Simple thread-unsafe LRU cache sufficient for single-process use."""

    def __init__(self, maxsize: int = 128):
        self._maxsize = maxsize
        self._data: OrderedDict = OrderedDict()

    def get(self, key):
        if key not in self._data:
            return None
        # Move to end (most recently used)
        self._data.move_to_end(key)
        return self._data[key]

    def set(self, key, value):
        if key in self._data:
            self._data.move_to_end(key)
        self._data[key] = value
        if len(self._data) > self._maxsize:
            # Evict least recently used
            self._data.popitem(last=False)


_topic_emb_cache: _LRUCache = _LRUCache(maxsize=_CACHE_MAX)


# ── Public helpers ────────────────────────────────────────────────────────────

def tag_chunk_with_topics(chunk: str, topic_tree: list) -> list:
    if not topic_tree:
        return ["General"]

    model = get_embedding_model()
    topics = [t["topic"] for t in topic_tree if t.get("topic")]
    if not topics:
        return ["General"]

    chunk_emb = model.encode([chunk])[0]
    topic_embs = model.encode(topics)

    sims = np.dot(topic_embs, chunk_emb) / (
        np.linalg.norm(topic_embs, axis=1) * np.linalg.norm(chunk_emb) + 1e-9
    )
    best_idx = int(np.argmax(sims))
    return [topics[best_idx]]


def extract_topic_tree_from_text(text: str) -> list:
    prompt = f"""
Extract syllabus units and topics.

Return ONLY JSON array:
[{{"unit":"Unit","topic":"Topic"}}]

{text[:10000]}
"""
    raw = call_gemini(prompt)
    try:
        return json.loads(raw)
    except Exception:
        return [{"unit": "Unit", "topic": "General"}]


def ensure_topics_exist(chat_id: str, text: str) -> None:
    existing = SubjectTopic.query.filter_by(chat_id=chat_id).first()
    if existing:
        return

    prompt = f"""
Infer syllabus-style topics and units from this content.

Return ONLY JSON:
[{{"unit":"Unit","topic":"Topic"}}]

{text[:8000]}
"""
    raw = call_gemini(prompt)
    try:
        topics = json.loads(raw)
    except Exception:
        topics = [{"unit": "Unit", "topic": "General"}]

    for t in topics:
        db.session.add(SubjectTopic(
            chat_id=chat_id,
            unit_name=t.get("unit", "Unit"),
            topic_name=t.get("topic", "General"),
        ))
    db.session.commit()


def map_to_closest_topic(
    given_topic: str,
    allowed_topics: list,
    threshold: float = 0.35,
) -> str:
    if not allowed_topics:
        return "General"

    given = (given_topic or "").strip()
    if not given:
        return allowed_topics[0] if allowed_topics else "General"

    # Exact match first (case-insensitive)
    for t in allowed_topics:
        if given.lower() == (t or "").strip().lower():
            return t

    model = get_embedding_model()

    # Cache key: sorted tuple so order doesn't matter
    cache_key = tuple(sorted(allowed_topics))
    cached = _topic_emb_cache.get(cache_key)

    if cached is None:
        embs = model.encode(list(allowed_topics))
        cached = {
            "embs":   np.asarray(embs, dtype=np.float32),
            "topics": list(allowed_topics),
        }
        _topic_emb_cache.set(cache_key, cached)

    topic_embs    = cached["embs"]
    topic_list    = cached["topics"]
    q_emb         = np.asarray(model.encode([given])[0], dtype=np.float32)

    denom = (
        np.linalg.norm(topic_embs, axis=1) * (np.linalg.norm(q_emb) + 1e-9)
    ) + 1e-9
    sims      = (topic_embs @ q_emb) / denom
    best_idx  = int(np.argmax(sims))
    best_score = float(sims[best_idx])

    if best_score >= float(threshold):
        return topic_list[best_idx]

    if "General" in allowed_topics:
        return "General"
    return allowed_topics[0]


def top_n_weights(weights: dict, n: int = 10) -> dict:
    if not weights:
        return {}
    items = sorted(weights.items(), key=lambda x: x[1], reverse=True)[:n]
    return {k: float(v) for k, v in items}


def get_allowed_topics_for_chat(chat_id: str) -> list:
    db_topics = SubjectTopic.query.filter_by(chat_id=chat_id).all()
    allowed = [
        t.topic_name.strip()
        for t in db_topics
        if t.topic_name and t.topic_name.strip()
    ]
    return allowed or ["General"]


def summarize_topic_analytics(weak_map: dict, top_k: int = 5) -> list:
    result = []

    for topic, rec in (weak_map or {}).items():
        if not isinstance(rec, dict):
            continue

        by_bloom = sorted(
            [
                (k, v.get("score", 0.0), v.get("seen", 0))
                for k, v in (rec.get("byBloom") or {}).items()
            ],
            key=lambda x: (x[1], x[2]),
            reverse=True,
        )
        by_type = sorted(
            [
                (k, v.get("score", 0.0), v.get("seen", 0))
                for k, v in (rec.get("byType") or {}).items()
            ],
            key=lambda x: (x[1], x[2]),
            reverse=True,
        )
        by_difficulty = sorted(
            [
                (k, v.get("score", 0.0), v.get("seen", 0))
                for k, v in (rec.get("byDifficulty") or {}).items()
            ],
            key=lambda x: (x[1], x[2]),
            reverse=True,
        )

        result.append({
            "topic":               topic,
            "score":               rec.get("score", 0.0),
            "seen":                rec.get("seen", 0),
            "topWeakBlooms":       [x[0] for x in by_bloom[:top_k]],
            "topWeakTypes":        [x[0] for x in by_type[:top_k]],
            "topWeakDifficulties": [x[0] for x in by_difficulty[:top_k]],
        })

    result.sort(key=lambda x: (x["score"], x["seen"]), reverse=True)
    return result


