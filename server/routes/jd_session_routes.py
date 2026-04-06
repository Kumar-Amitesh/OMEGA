"""
routes/jd_session_routes.py

JD interview session: generate questions → submit answers → get feedback.
Session types: jd_normal | jd_voice | jd_video

Register in routes/__init__.py:
    from .jd_session_routes import bp as jd_session_bp

Register in app.py:
    app.register_blueprint(jd_session_bp)

Endpoints:
    POST /api/chats/<chat_id>/jd/session/generate
        Body: { count, type, session_mode }
        Returns: { sessionId, questions, sessionMode, jdTitle, jdCompany }

    POST /api/jd-sessions/<session_id>/submit
        Body: { answers: { <qid>: "<text>" } }
        Returns: { score, results, answeredCount, totalQuestions }
"""

import json
from flask import Blueprint, request, jsonify

from models import Chat, PracticeSession
from models.job_description import JobDescription
from extensions import db
from utils import generate_id
from services.auth_service import get_user_from_token
from services.cache_service import invalidate_chat
from services.jd_service import (
    generate_jd_questions,
    evaluate_jd_answers,
    ALLOWED_JD_QUESTION_TYPES,
    MAX_JD_QUESTIONS,
    MIN_JD_QUESTIONS,
)
from logger import get_logger

logger = get_logger("jd_session_routes")
bp = Blueprint("jd_session_routes", __name__)

# Map frontend session_mode → DB session_type
SESSION_MODE_TO_TYPE = {
    "normal": "jd_normal",
    "voice":  "jd_voice",
    "video":  "jd_video",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_chat_or_403(chat_id, user):
    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return None
    return chat


def _get_latest_jd(chat_id):
    return (
        JobDescription.query
        .filter_by(chat_id=chat_id, is_processed=True)
        .order_by(JobDescription.uploaded_at.desc())
        .first()
    )


# ── POST /api/chats/<chat_id>/jd/session/generate ────────────────────────────

@bp.route("/api/chats/<chat_id>/jd/session/generate", methods=["POST"])
def generate_jd_session(chat_id):
    """
    1. Load the chat's JD.
    2. Generate interview questions with the LLM.
    3. Create a PracticeSession row (empty answers/feedback for now).
    4. Return questions to the frontend.
    """
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = _get_chat_or_403(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403

    jd = _get_latest_jd(chat_id)
    if not jd:
        return jsonify({"error": "No job description found. Upload a JD first."}), 400

    parsed_jd = {}
    try:
        parsed_jd = json.loads(jd.parsed_json) if jd.parsed_json else {}
    except Exception:
        pass

    if not parsed_jd:
        return jsonify({"error": "Job description could not be parsed. Try re-uploading."}), 400

    # ── Validate request ──────────────────────────────────────────────────────
    data = request.get_json(silent=True) or {}

    try:
        count = max(MIN_JD_QUESTIONS, min(MAX_JD_QUESTIONS, int(data.get("count") or 8)))
    except (TypeError, ValueError):
        count = 8

    question_type = str(data.get("type") or "mixed").strip().lower()
    if question_type not in ALLOWED_JD_QUESTION_TYPES and question_type != "mixed":
        question_type = "mixed"

    session_mode = str(data.get("session_mode") or "normal").strip().lower()
    if session_mode not in SESSION_MODE_TO_TYPE:
        session_mode = "normal"

    session_type = SESSION_MODE_TO_TYPE[session_mode]

    # ── Generate questions ────────────────────────────────────────────────────
    try:
        questions = generate_jd_questions(parsed_jd, count, question_type)
    except Exception as exc:
        logger.exception("[jd_session] question generation failed: %s", exc)
        return jsonify({"error": "Failed to generate questions. Please try again."}), 500

    if not questions:
        return jsonify({"error": "No questions were generated. Please try again."}), 500

    # ── Create a placeholder PracticeSession ─────────────────────────────────
    # This lets video_session_routes.save_video_session detect jd_video sessions
    # by looking up the existing row's session_type.
    session_id = generate_id()
    session = PracticeSession(
        id           = session_id,
        chat_id      = chat_id,
        session_type = session_type,
        questions    = json.dumps(questions),
        answers      = json.dumps({}),
        feedback_json= json.dumps({}),
        score        = None,
    )
    db.session.add(session)
    db.session.commit()

    logger.info(
        "[jd_session] Created session %s type=%s questions=%d chat=%s",
        session_id, session_type, len(questions), chat_id
    )

    return jsonify({
        "sessionId":   session_id,
        "questions":   questions,
        "sessionMode": session_mode,
        "jdTitle":     parsed_jd.get("title", "Unknown Role"),
        "jdCompany":   parsed_jd.get("company", "Unknown Company"),
    })


# ── POST /api/jd-sessions/<session_id>/submit ────────────────────────────────

@bp.route("/api/jd-sessions/<session_id>/submit", methods=["POST"])
def submit_jd_session(session_id):
    """
    1. Load session + verify ownership.
    2. Evaluate answers with LLM.
    3. Persist results to DB.
    4. Return score + per-question feedback.
    """
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    session = PracticeSession.query.get(session_id)
    if not session:
        return jsonify({"error": "Session not found."}), 404

    # Ownership check via chat
    chat = _get_chat_or_403(session.chat_id, user)
    if not chat:
        return jsonify({"error": "unauthorized"}), 403

    # Only handle JD session types
    if not (session.session_type or "").startswith("jd_"):
        return jsonify({"error": "Invalid session type for this endpoint."}), 400

    data = request.get_json(silent=True) or {}
    answers = data.get("answers") or {}

    if not isinstance(answers, dict):
        return jsonify({"error": "answers must be an object."}), 400

    # Load stored questions
    try:
        questions = json.loads(session.questions or "[]")
    except Exception:
        questions = []

    if not questions:
        return jsonify({"error": "Session has no questions."}), 400

    # ── Evaluate ──────────────────────────────────────────────────────────────
    try:
        results = evaluate_jd_answers(questions, answers)
    except Exception as exc:
        logger.exception("[jd_session] evaluation failed: %s", exc)
        return jsonify({"error": "Failed to evaluate answers. Please try again."}), 500

    # ── Compute average score (server-side) ───────────────────────────────────
    scores = [
        v.get("overallScore", 0)
        for v in results.values()
        if isinstance(v, dict) and not v.get("skipped")
    ]
    score = round(sum(scores) / len(scores), 2) if scores else 0.0

    answered_count = sum(
        1 for a in answers.values() if str(a or "").strip()
    )

    # ── Persist ───────────────────────────────────────────────────────────────
    try:
        session.answers      = json.dumps(answers)
        session.feedback_json= json.dumps(results)
        session.score        = score
        db.session.commit()

        invalidate_chat(session.chat_id, user.id)

        logger.info(
            "[jd_session] Saved session %s score=%.2f answered=%d/%d",
            session_id, score, answered_count, len(questions)
        )
    except Exception as exc:
        db.session.rollback()
        logger.exception("[jd_session] DB save failed: %s", exc)
        return jsonify({"error": f"Failed to save results: {str(exc)}"}), 500

    return jsonify({
        "sessionId":      session_id,
        "score":          score,
        "results":        results,
        "answeredCount":  answered_count,
        "totalQuestions": len(questions),
    })