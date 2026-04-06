"""
routes/video_session_routes.py

SIMPLIFIED — per-question feedback is now saved atomically inside
video_routes.py before the response is returned. This endpoint is
called only once at the end to:

  1. Compute the final score from whatever feedback is already in DB
     (no score submitted from frontend — always recalculated server-side)
  2. Set session_type correctly from chat's examConfig
  3. Mark the session as complete (score != null = done)

The frontend calls this when the user clicks "View Results" on the
last question. If they never click it (tab close, crash), the session
stays in-progress (score=null) but all question feedback is safe.

PATCH (jd_video):
  If the session type is already a JD type, it is preserved.
"""

import json
from flask import Blueprint, request, jsonify
from models import Chat, PracticeSession
from extensions import db
from services.auth_service import get_user_from_token
from services.cache_service import invalidate_chat
from utils import generate_id
from logger import get_logger

logger = get_logger("video_session_routes")
bp = Blueprint("video_session_routes", __name__)

_JD_SESSION_TYPES = {"jd_normal", "jd_voice", "jd_video"}


def _recalculate_score_from_db(session: PracticeSession) -> float:
    """
    Read whatever feedback is already stored in the session row and
    compute the average overallScore. This is the server-side truth —
    the frontend score field is completely ignored.
    """
    try:
        feedback_map = json.loads(session.feedback_json or "{}")
    except (json.JSONDecodeError, TypeError):
        feedback_map = {}

    scores = []
    for qid, fb in feedback_map.items():
        if not isinstance(fb, dict):
            continue
        raw = fb.get("overallScore") or fb.get("videoFeedback", {}).get("overallScore")
        if raw is not None:
            try:
                scores.append(round(max(0.0, min(10.0, float(raw))), 1))
            except (TypeError, ValueError):
                pass

    if not scores:
        return 0.0
    return round(sum(scores) / len(scores), 2)


@bp.route("/api/chats/<chat_id>/video-session/finalize", methods=["POST"])
def finalize_video_session(chat_id):
    """
    Mark a video session as complete by setting the final score.
    All feedback is already in the DB from video_routes.py saves.
    This just closes the session and triggers cache invalidation.
    """
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "invalid chat"}), 403

    data       = request.get_json(silent=True) or {}
    session_id = data.get("session_id")

    if not session_id:
        return jsonify({"error": "session_id is required"}), 400

    session = PracticeSession.query.get(session_id)
    if not session:
        return jsonify({"error": "Session not found. No questions were saved."}), 404

    # Ownership check
    owner_chat = Chat.query.get(session.chat_id)
    if not owner_chat or owner_chat.user_id != user.id:
        return jsonify({"error": "unauthorized"}), 403

    # Recalculate score entirely from DB — ignore any frontend value
    final_score = _recalculate_score_from_db(session)

    # Determine session_type from DB config (preserve JD types)
    if session.session_type in _JD_SESSION_TYPES:
        session_type = session.session_type
        logger.info("[video_session] preserving JD session_type=%s", session_type)
    else:
        exam_cfg     = json.loads(chat.exam_config or "{}")
        session_mode = exam_cfg.get("sessionMode", "video")
        session_type = "video_full" if session_mode != "voice" else "voice_full"

    try:
        session.score        = final_score
        session.session_type = session_type
        db.session.commit()

        invalidate_chat(chat_id, user.id)

        logger.info(
            "[video_session] finalized session=%s score=%s type=%s",
            session_id, final_score, session_type,
        )

        # Return the full feedback map so the frontend can show the results page
        try:
            feedback_map = json.loads(session.feedback_json or "{}")
        except (json.JSONDecodeError, TypeError):
            feedback_map = {}

        try:
            questions = json.loads(session.questions or "[]")
        except (json.JSONDecodeError, TypeError):
            questions = []

        return jsonify({
            "sessionId":  session_id,
            "score":      final_score,
            "feedback":   feedback_map,
            "questions":  questions,
            "finalized":  True,
        })

    except Exception as exc:
        db.session.rollback()
        logger.exception("[video_session] finalize error: %s", exc)
        return jsonify({"error": f"Failed to finalize session: {str(exc)}"}), 500


@bp.route("/api/chats/<chat_id>/video-session/save", methods=["POST"])
def save_video_session(chat_id):
    """
    KEPT for backward compatibility with JD session routes that still
    use this endpoint to save their complete session in one shot.

    For regular video exam sessions, prefer /finalize instead.
    Per-question feedback is now saved inside video_routes.py.
    """
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "invalid chat"}), 403

    data = request.get_json(silent=True) or {}

    session_id   = data.get("session_id") or generate_id()
    questions    = data.get("questions")  or []
    answers      = data.get("answers")    or {}
    raw_feedback = data.get("feedback")   or {}

    existing = PracticeSession.query.get(session_id)
    if existing:
        owner_chat = Chat.query.get(existing.chat_id)
        if not owner_chat or owner_chat.user_id != user.id:
            return jsonify({"error": "unauthorized"}), 403

    # Sanitise and recalculate score server-side
    def clamp(v):
        try:
            return round(max(0.0, min(10.0, float(v))), 1)
        except Exception:
            return None

    sanitized = {}
    for qid, fb in (raw_feedback or {}).items():
        if not isinstance(fb, dict):
            continue
        clean_fb = dict(fb)
        if clean_fb.get("overallScore") is not None:
            clean_fb["overallScore"] = clamp(clean_fb["overallScore"])
        for section in ("content", "delivery"):
            seg = clean_fb.get(section)
            if isinstance(seg, dict):
                clean_fb[section] = {k: clamp(v) for k, v in seg.items()}
        if isinstance(clean_fb.get("naturalness"), dict):
            nat = clean_fb["naturalness"]
            if nat.get("score") is not None:
                nat["score"] = clamp(nat["score"])
        sanitized[qid] = clean_fb

    scores = [
        clamp(fb.get("overallScore"))
        for fb in sanitized.values()
        if isinstance(fb, dict) and fb.get("overallScore") is not None
    ]
    score = round(sum(s for s in scores if s is not None) / len(scores), 2) if scores else 0.0

    if existing and existing.session_type in _JD_SESSION_TYPES:
        session_type = existing.session_type
    else:
        exam_cfg     = json.loads(chat.exam_config or "{}")
        session_mode = exam_cfg.get("sessionMode", "video")
        session_type = "video_full" if session_mode != "voice" else "voice_full"

    logger.info(
        "[video_session] save (compat) chat=%s session=%s type=%s score=%s",
        chat_id, session_id, session_type, score,
    )

    try:
        if existing:
            existing.questions     = json.dumps(questions)
            existing.answers       = json.dumps(answers)
            existing.feedback_json = json.dumps(sanitized)
            existing.score         = score
            existing.session_type  = session_type
            db.session.commit()
        else:
            session = PracticeSession(
                id            = session_id,
                chat_id       = chat_id,
                session_type  = session_type,
                questions     = json.dumps(questions),
                answers       = json.dumps(answers),
                feedback_json = json.dumps(sanitized),
                score         = score,
            )
            db.session.add(session)
            db.session.commit()

        invalidate_chat(chat_id, user.id)

        return jsonify({
            "sessionId": session_id,
            "score":     score,
            "saved":     True,
        })

    except Exception as exc:
        db.session.rollback()
        logger.exception("[video_session] DB error: %s", exc)
        return jsonify({"error": f"Failed to save session: {str(exc)}"}), 500


