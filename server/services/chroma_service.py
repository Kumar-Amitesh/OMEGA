"""
services/chroma_service.py

Changes from original:
- fetch_topic_chunks now accepts an optional `offset` parameter so callers
  can rotate which chunks are returned across sessions, preventing the same
  two chunks feeding every question-generation run.
- merge_context_by_topics_budgeted accepts an optional `session_seed` (int)
  that deterministically rotates the per-topic chunk window.
- store_embeddings_in_chroma stores page_num + filename in metadata (unchanged).
- fetch_chunks_with_sources and fetch_context_with_sources_for_question
  are unchanged in signature.
"""

import json
import hashlib
import random
import time
from chromadb import PersistentClient
from logger import get_logger
from services.embedding_service import get_embedding_model

logger = get_logger("chroma_service")

_chroma_client = None


def chroma_collection_name(user_id: str, chat_id: str) -> str:
    raw   = f"{user_id}_{chat_id}"
    short = hashlib.md5(raw.encode()).hexdigest()[:24]
    return f"uc_{short}"


def get_chroma_client():
    global _chroma_client
    if _chroma_client is None:
        logger.info("Initializing Chroma client at ./chroma_db")
        _chroma_client = PersistentClient(path="./chroma_db")
    return _chroma_client


def get_chroma_collection(client, name: str, retries: int = 5, sleep: float = 0.2):
    for i in range(retries):
        try:
            return client.get_collection(name=name)
        except Exception:
            try:
                return client.create_collection(name=name)
            except Exception as e:
                if "already exists" in str(e).lower():
                    time.sleep(sleep * (i + 1))
                    continue
                raise
    return client.get_collection(name=name)


def store_embeddings_in_chroma(
    user_id: str,
    chat_id: str,
    pdf_id: str,
    tagged_chunks: list,
    embeddings: list,
    pdf_type: str,
    filename: str = "",
) -> None:
    """
    Store embeddings with enriched metadata.

    tagged_chunks: [{"text": str, "topics": [...], "page": int}, ...]
    """
    logger.info("Storing embeddings → user=%s chat=%s pdf=%s", user_id, chat_id, pdf_id)

    client     = get_chroma_client()
    name       = chroma_collection_name(user_id, chat_id)
    collection = get_chroma_collection(client, name)

    docs, ids, meta = [], [], []

    for i, chunk in enumerate(tagged_chunks):
        docs.append(chunk["text"])
        ids.append(f"{pdf_id}_{i}")
        meta.append({
            "topics":   json.dumps(chunk["topics"]),
            "pdf_type": pdf_type,
            "pdf_id":   pdf_id,
            "page":     int(chunk.get("page", 0)),
            "filename": filename or "",
            "preview":  chunk["text"][:120].replace("\n", " ").strip(),
        })

    collection.add(documents=docs, embeddings=embeddings, ids=ids, metadatas=meta)
    logger.info("Stored %d embeddings in Chroma", len(docs))


# ── Query helpers ─────────────────────────────────────────────────────────────

def fetch_topic_chunks(
    collection,
    topic: str,
    n_results: int = 3,
    offset: int = 0,
) -> str:
    """
    Return up to n_results chunks for a topic.

    offset: skip this many top results before returning.
    By varying offset across sessions the student sees different parts of the
    material rather than always the same top-2 chunks.

    Example:
        session 1 → offset=0 → chunks ranked 1,2,3
        session 2 → offset=2 → chunks ranked 3,4,5
    """
    logger.debug("Querying Chroma: topic=%s n=%d offset=%d", topic, n_results, offset)

    model = get_embedding_model()
    q_emb = model.encode([topic]).tolist()

    # Fetch more results than needed so we can apply the offset
    fetch_n = n_results + offset
    res = collection.query(query_embeddings=q_emb, n_results=min(fetch_n, 20))

    if not res or not res.get("documents") or not res["documents"][0]:
        return ""

    docs = res["documents"][0]
    # Apply offset — if offset exceeds available docs, fall back to start
    sliced = docs[offset:offset + n_results]
    if not sliced:
        sliced = docs[:n_results]

    return "\n".join(sliced)


def fetch_chunks_with_sources(
    collection,
    query: str,
    n_results: int = 4,
) -> dict:
    """
    Query Chroma and return both text context AND source attribution.

    Returns:
    {
        "context": "full text for LLM prompt",
        "sources": [
            {"pdf_id": "...", "filename": "...", "page": 3, "preview": "..."},
            ...
        ]
    }
    """
    model = get_embedding_model()
    q_emb = model.encode([query]).tolist()

    res = collection.query(
        query_embeddings=q_emb,
        n_results=n_results,
        include=["documents", "metadatas"],
    )

    if not res or not res.get("documents") or not res["documents"][0]:
        return {"context": "", "sources": []}

    docs  = res["documents"][0]
    metas = res["metadatas"][0] if res.get("metadatas") else []

    context = "\n\n".join(docs)

    # Deduplicate sources by pdf_id+page
    seen    = set()
    sources = []
    for m in metas:
        if not m:
            continue
        key = f"{m.get('pdf_id', '')}_{m.get('page', 0)}"
        if key in seen:
            continue
        seen.add(key)
        sources.append({
            "pdf_id":   m.get("pdf_id", ""),
            "filename": m.get("filename", ""),
            "page":     m.get("page", 0),
            "preview":  m.get("preview", ""),
        })

    return {"context": context, "sources": sources}


def fetch_context_with_sources_for_question(
    collection,
    question: str,
    topic: str,
    n_results: int = 4,
) -> dict:
    """
    Fetch context relevant to a specific question + topic combo.
    Used in descriptive answer evaluation.
    """
    combined_query = f"{topic}: {question}"
    return fetch_chunks_with_sources(collection, combined_query, n_results=n_results)


# ── Weight / analytics helpers ────────────────────────────────────────────────

def compute_topic_weights(collection) -> dict:
    data  = collection.get(include=["metadatas"])
    metas = data.get("metadatas", [])

    counts: dict = {}
    total  = 0

    for m in metas:
        raw    = m.get("topics", "[]")
        topics = []
        if isinstance(raw, list):
            topics = raw
        elif isinstance(raw, str):
            s = raw.strip()
            if s.startswith("["):
                try:
                    topics = json.loads(s)
                except Exception:
                    topics = []
            else:
                topics = [x.strip() for x in s.split(",") if x.strip()]

        for t in topics:
            t = (t or "").strip()
            if not t:
                continue
            counts[t] = counts.get(t, 0) + 1
            total     += 1

    return {t: c / total for t, c in counts.items()} if total else {}


def merge_context_by_topics(collection, topics: list, limit_per_topic: int = 4) -> str:
    merged = []
    for t in topics:
        ctx = fetch_topic_chunks(collection, t)
        if ctx:
            merged.append(f"\n### {t}\n{ctx}")
    return "\n".join(merged)


def merge_context_by_topics_budgeted(
    collection,
    topics: list,
    per_topic_results: int = 2,
    max_chars: int = 12000,
    max_chars_per_topic: int = 900,
    session_seed: int = 0,
) -> str:
    """
    Build a context string from multiple topics within a character budget.

    session_seed: pass a value that changes per session (e.g. session count or
    a hash of the session_id) to rotate which chunks are retrieved.  The offset
    per topic is derived from (session_seed + topic_index) % max_offset so
    different topics also get different offsets, spreading coverage further.

    Pass session_seed=0 (default) to keep the original deterministic behaviour.
    """
    merged = []
    used   = 0

    for topic_idx, t in enumerate(topics):
        t = (t or "").strip()
        if not t:
            continue

        # Compute a per-topic offset based on session_seed
        # max_offset = 4 means we cycle through up to 4 different starting
        # positions before wrapping around, giving good coverage without
        # needing to fetch huge result sets.
        max_offset = 4
        offset = (session_seed + topic_idx) % max_offset if session_seed else 0

        ctx = fetch_topic_chunks(
            collection,
            t,
            n_results=per_topic_results,
            offset=offset,
        )
        if not ctx:
            continue

        ctx_small = ctx[:max_chars_per_topic].strip()
        block     = f"\n### {t}\n{ctx_small}\n"

        if used + len(block) > max_chars:
            break

        merged.append(block)
        used += len(block)

    return "".join(merged).strip()



