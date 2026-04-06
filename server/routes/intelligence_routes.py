"""
routes/intelligence_routes.py

Four endpoints:

  GET  /api/chats/<chat_id>/intelligence/delivery-trends
  GET  /api/chats/<chat_id>/intelligence/bloom-trajectory
  GET  /api/chats/<chat_id>/intelligence/misconceptions
  GET  /api/chats/<chat_id>/intelligence/diagnostic        ← NEW unified endpoint
"""

from flask import Blueprint, jsonify, request
from models import Chat
from services.auth_service import get_user_from_token
from services.delivery_trend_service   import get_delivery_trends
from services.bloom_trajectory_service import get_bloom_trajectory
from services.misconception_service    import get_misconceptions_for_chat
from services.learner_diagnostic_service import get_learner_diagnostic
from logger import get_logger

logger = get_logger("intelligence_routes")
bp = Blueprint("intelligence_routes", __name__)


def _get_chat_or_error(chat_id: str, user):
    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return None
    return chat


def _is_jd_chat(chat) -> bool:
    try:
        import json
        cfg = json.loads(chat.exam_config or "{}")
        return cfg.get("chatType") == "jd"
    except Exception:
        return False


@bp.route("/api/chats/<chat_id>/intelligence/delivery-trends", methods=["GET"])
def delivery_trends(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    chat = _get_chat_or_error(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403
    try:
        return jsonify(get_delivery_trends(chat_id))
    except Exception as exc:
        logger.exception("[intelligence] delivery-trends error: %s", exc)
        return jsonify({"error": "Failed to compute delivery trends"}), 500


@bp.route("/api/chats/<chat_id>/intelligence/bloom-trajectory", methods=["GET"])
def bloom_trajectory(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    chat = _get_chat_or_error(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403
    try:
        return jsonify(get_bloom_trajectory(chat_id))
    except Exception as exc:
        logger.exception("[intelligence] bloom-trajectory error: %s", exc)
        return jsonify({"error": "Failed to compute Bloom trajectory"}), 500


@bp.route("/api/chats/<chat_id>/intelligence/misconceptions", methods=["GET"])
def misconceptions(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    chat = _get_chat_or_error(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403
    try:
        return jsonify(get_misconceptions_for_chat(chat_id))
    except Exception as exc:
        logger.exception("[intelligence] misconceptions error: %s", exc)
        return jsonify({"error": "Failed to compute misconceptions"}), 500


@bp.route("/api/chats/<chat_id>/intelligence/diagnostic", methods=["GET"])
def learner_diagnostic(chat_id):
    """
    Unified Learner Diagnostic Profile.
    Combines bloom trajectory + misconception profile + delivery state
    into a single learner state object with one prioritized recommendation.
    """
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401
    chat = _get_chat_or_error(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403
    try:
        data = get_learner_diagnostic(chat_id, is_jd_chat=_is_jd_chat(chat))
        return jsonify(data)
    except Exception as exc:
        logger.exception("[intelligence] diagnostic error: %s", exc)
        return jsonify({"error": "Failed to compute learner diagnostic"}), 500

