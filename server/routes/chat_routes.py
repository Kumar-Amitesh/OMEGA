"""
routes/chat_routes.py

Changes from original:
- _serialize_chat includes topSources in analytics
  (which PDFs/slides cover which topics — pulled from Chroma metadata)
- topSources fetched lazily only on GET /api/chats (list), cached
- Everything else unchanged
"""

import json
from flask import Blueprint, request, jsonify
from models import Chat
from extensions import db
from utils import generate_id
from services.auth_service import get_user_from_token
from services.exam_service import parse_bloom_levels
from services.evaluation_service import top_weak_topics
from services.topic_service import summarize_topic_analytics
from services.validation_service import validate_exam_config
from services.cache_service import (
    cache_get, cache_set, cache_delete,
    chat_list_key, chat_detail_key, invalidate_chat_list, invalidate_chat,
    TTL_CHAT_LIST, TTL_CHAT_DETAIL,
)

bp = Blueprint("chat_routes", __name__)


def _get_top_sources_for_chat(chat_id: str, user_id: str, top_topics: list[str], max_per_topic: int = 2) -> dict:
    """
    Query Chroma to find which PDFs/slides cover the top weak topics.
    Returns { topic_name: [{"filename": ..., "page": ..., "preview": ...}] }

    This is best-effort — returns {} on any error so it never blocks the response.
    """
    if not top_topics:
        return {}

    try:
        from services.chroma_service import (
            get_chroma_client,
            chroma_collection_name,
            get_chroma_collection,
            fetch_chunks_with_sources,
        )

        client     = get_chroma_client()
        name       = chroma_collection_name(user_id, chat_id)
        collection = get_chroma_collection(client, name)

        result = {}
        for topic in top_topics:
            ctx_result = fetch_chunks_with_sources(collection, topic, n_results=max_per_topic)
            sources    = ctx_result.get("sources", [])
            if sources:
                # Only expose what the frontend needs
                result[topic] = [
                    {
                        "filename": s.get("filename", ""),
                        "page":     s.get("page", 0),
                        "preview":  s.get("preview", "")
                    }
                    for s in sources
                ]

        return result

    except Exception as e:
        # Non-fatal — analytics still works without sources
        import logging
        logging.getLogger("chat_routes").warning(f"Could not fetch top sources: {e}")
        return {}


def _serialize_chat(chat, include_sources: bool = False, user_id: str = None):
    weak_map    = json.loads(chat.weak_topics_json) if chat.weak_topics_json else {}
    # weak_topics = json.loads(chat.weak_topics_json) if chat.weak_topics_json else {}
    # Fix old DB rows
    if isinstance(weak_map, list):
        weak_map = {
            t: {
                "score": 0.5,
                "seen": 1,
                "byDifficulty": {},
                "byType": {},
                "byBloom": {}
            }
            for t in weak_map
        }
    exam_cfg    = json.loads(chat.exam_config or "{}")
    weak_list   = top_weak_topics(weak_map, k=5)
    analytics   = summarize_topic_analytics(weak_map, top_k=3)

    # ── Optionally enrich analytics with source references ────────────────
    top_sources = {}
    if include_sources and user_id and weak_list:
        top_sources = _get_top_sources_for_chat(chat.id, user_id, weak_list, max_per_topic=2)

    # Attach sources to each analytics entry
    if top_sources:
        for entry in analytics:
            entry["topSources"] = top_sources.get(entry["topic"], [])

    return {
        "chatId":      chat.id,
        "examType":    chat.exam_type,
        "createdAt":   chat.created_at.isoformat(),
        "weakTopics":  weak_list,
        "pdfCount":    len(chat.pdfs),
        "subject":     exam_cfg.get("subject"),
        "bloomLevels": parse_bloom_levels(chat.bloom_level),
        "examConfig":  exam_cfg,
        "analytics":   analytics
    }


@bp.route("/api/chats", methods=["GET", "POST"])
def create_chat():
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    if request.method == "GET":
        key    = chat_list_key(user.id)
        cached = cache_get(key)
        if cached is not None:
            return jsonify(cached)

        chats = (
            Chat.query
            .filter_by(user_id=user.id)
            .order_by(Chat.created_at.desc())
            .all()
        )

        # include_sources=True so the list view shows which PDFs cover weak topics
        result = [_serialize_chat(c, include_sources=True, user_id=user.id) for c in chats]
        cache_set(key, result, TTL_CHAT_LIST)
        return jsonify(result)

    # ── POST ──────────────────────────────────────────────────────────────
    data = request.json or {}

    sanitized_config, error, sanitized_blooms = validate_exam_config(data)
    if error:
        return jsonify({"error": error}), 400

    chat = Chat(
        id=generate_id(),
        user_id=user.id,
        exam_type=data.get("examType", "custom"),
        bloom_level=json.dumps(sanitized_blooms),
        exam_config=json.dumps(sanitized_config)
    )

    db.session.add(chat)
    db.session.commit()
    invalidate_chat_list(user.id)

    return jsonify({"chatId": chat.id})


@bp.route("/api/chats/<chat_id>/history", methods=["GET"])
def chat_history(chat_id):
    from models import PracticeSession

    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "unauthorized"}), 403

    sessions = (
        PracticeSession.query
        .filter_by(chat_id=chat_id)
        .order_by(PracticeSession.created_at.asc())
        .all()
    )

    result = []
    for s in sessions:
        result.append({
            "sessionId": s.id,
            "type":      s.session_type,
            "score":     s.score,
            "questions": json.loads(s.questions)  if s.questions     else [],
            "answers":   json.loads(s.answers)    if s.answers       else {},
            "feedback":  json.loads(s.feedback_json) if s.feedback_json else {},
            "createdAt": s.created_at.isoformat()
        })

    return jsonify(result)



@bp.route("/api/chats/<chat_id>", methods=["DELETE"])
def delete_chat(chat_id):
    """
    Delete a chat and ALL associated data.
    We explicitly delete every child table in the correct order to satisfy
    foreign key constraints (Postgres enforces them; SQLAlchemy cascade alone
    is not enough when FK constraints exist without ON DELETE CASCADE in DB).

    Deletion order:
      1. MisconceptionRecord  (refs practice_session + chat)
      2. PracticeSession       (refs chat)
      3. PDFDocument           (refs chat)
      4. SubjectTopic          (refs chat)
      5. JobDescription        (refs chat)
      6. Chat                  (root)
    """
    from models.misconception import MisconceptionRecord
    from models.job_description import JobDescription
    from models.practice import PracticeSession, SubjectTopic
    from models.pdf import PDFDocument

    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "not found"}), 404

    try:
        # 1. Delete ChromaDB collection (best-effort)
        try:
            from services.chroma_service import get_chroma_client, chroma_collection_name
            client   = get_chroma_client()
            col_name = chroma_collection_name(user.id, chat_id)
            client.delete_collection(col_name)
        except Exception:
            pass

        # 2. Delete all child rows in FK-safe order
        MisconceptionRecord.query.filter_by(chat_id=chat_id).delete(synchronize_session=False)
        PracticeSession.query.filter_by(chat_id=chat_id).delete(synchronize_session=False)
        PDFDocument.query.filter_by(chat_id=chat_id).delete(synchronize_session=False)
        SubjectTopic.query.filter_by(chat_id=chat_id).delete(synchronize_session=False)
        JobDescription.query.filter_by(chat_id=chat_id).delete(synchronize_session=False)

        # 3. Delete the chat itself
        db.session.delete(chat)
        db.session.commit()

        invalidate_chat_list(user.id)
        invalidate_chat(chat_id, user.id)

        return jsonify({"deleted": True, "chatId": chat_id})

    except Exception as exc:
        db.session.rollback()
        import logging
        logging.getLogger("chat_routes").exception("delete_chat failed: %s", exc)
        return jsonify({"error": f"Failed to delete session: {str(exc)}"}), 500