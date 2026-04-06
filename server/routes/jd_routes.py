"""
routes/jd_routes.py

Job Description (JD) upload and management endpoints.
Fully isolated from the existing exam-prep feature.

Register in routes/__init__.py:
    from .jd_routes import bp as jd_bp

Register in app.py:
    app.register_blueprint(jd_bp)

Endpoints:
    POST   /api/chats/<chat_id>/jd/upload-text   — paste raw JD text
    POST   /api/chats/<chat_id>/jd/upload-file   — upload PDF/TXT file
    GET    /api/chats/<chat_id>/jd               — get parsed JD for chat
    DELETE /api/chats/<chat_id>/jd               — delete JD for chat
"""

import os
import json
import tempfile

from flask import Blueprint, request, jsonify
from werkzeug.utils import secure_filename

from models import Chat
from models.job_description import JobDescription
from extensions import db
from utils import generate_id
from services.auth_service import get_user_from_token
from services.jd_service import (
    parse_jd_with_llm,
    classify_text_as_jd,
)
from logger import get_logger

logger = get_logger("jd_routes")
bp = Blueprint("jd_routes", __name__)

ALLOWED_EXTENSIONS = {".pdf", ".txt"}
MAX_FILE_BYTES     = 5 * 1024 * 1024   # 5 MB
MAX_TEXT_CHARS     = 50_000


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


def _extract_text_from_file(path: str, ext: str) -> str:
    if ext == ".pdf":
        from utils.pdf import extract_text_from_pdf
        return extract_text_from_pdf(path)
    if ext == ".txt":
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    return ""


# ── Shared processing core ────────────────────────────────────────────────────

def _process_and_store(chat_id: str, raw_text: str):
    """
    1. Verify text is a JD.
    2. Parse with LLM.
    3. Replace any existing JD for this chat.
    4. Return Flask response tuple.
    """
    # Validate it's actually a JD
    if not classify_text_as_jd(raw_text):
        return jsonify({
            "error": "This does not appear to be a valid Job Description. "
                     "Please paste or upload an actual JD."
        }), 400

    try:
        parsed = parse_jd_with_llm(raw_text)
    except Exception as exc:
        logger.exception("[jd_routes] LLM parse error: %s", exc)
        return jsonify({"error": "Failed to analyse the job description. Please try again."}), 500

    # One JD per chat — replace silently
    JobDescription.query.filter_by(chat_id=chat_id).delete()
    db.session.flush()

    jd = JobDescription(
        id           = generate_id(),
        chat_id      = chat_id,
        raw_text     = raw_text,
        parsed_json  = json.dumps(parsed),
        doc_type     = "jd",
        is_processed = True,
        error        = None,
    )
    db.session.add(jd)
    db.session.commit()

    logger.info("[jd_routes] Stored JD %s for chat %s (title=%s)",
                jd.id, chat_id, parsed.get("title"))

    return jsonify({
        "jdId":   jd.id,
        "parsed": parsed,
        "status": "processed",
    }), 201


# ── POST /api/chats/<chat_id>/jd/upload-text ─────────────────────────────────

@bp.route("/api/chats/<chat_id>/jd/upload-text", methods=["POST"])
def upload_jd_text(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = _get_chat_or_403(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403

    data     = request.get_json(silent=True) or {}
    raw_text = str(data.get("text") or "").strip()

    if not raw_text:
        return jsonify({"error": "No text provided."}), 400
    if len(raw_text) < 50:
        return jsonify({"error": "Text is too short to be a valid job description."}), 400

    raw_text = raw_text[:MAX_TEXT_CHARS]

    return _process_and_store(chat_id, raw_text)


# ── POST /api/chats/<chat_id>/jd/upload-file ─────────────────────────────────

@bp.route("/api/chats/<chat_id>/jd/upload-file", methods=["POST"])
def upload_jd_file(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = _get_chat_or_403(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403

    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file uploaded."}), 400

    original_name = secure_filename(file.filename or "jd.pdf")
    ext           = os.path.splitext(original_name)[1].lower()

    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({
            "error": f"Unsupported file type '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        }), 400

    # Size check
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)
    if size > MAX_FILE_BYTES:
        return jsonify({"error": "File too large. Maximum size is 5 MB."}), 413

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
            file.save(f)
            tmp_path = f.name

        raw_text = _extract_text_from_file(tmp_path, ext).strip()

        if not raw_text or len(raw_text) < 50:
            return jsonify({
                "error": "Could not extract enough text from the file. "
                         "Try a text-layer PDF or paste the JD directly."
            }), 400

        return _process_and_store(chat_id, raw_text[:MAX_TEXT_CHARS])

    except Exception as exc:
        logger.exception("[jd_routes] file processing error: %s", exc)
        return jsonify({"error": f"Failed to process file: {str(exc)}"}), 500

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


# ── GET /api/chats/<chat_id>/jd ──────────────────────────────────────────────

@bp.route("/api/chats/<chat_id>/jd", methods=["GET"])
def get_jd(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = _get_chat_or_403(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403

    jd = _get_latest_jd(chat_id)
    if not jd:
        return jsonify({"jd": None}), 200

    return jsonify({
        "jd": {
            "jdId":       jd.id,
            "parsed":     json.loads(jd.parsed_json) if jd.parsed_json else {},
            "uploadedAt": jd.uploaded_at.isoformat(),
        }
    })


# ── DELETE /api/chats/<chat_id>/jd ───────────────────────────────────────────

@bp.route("/api/chats/<chat_id>/jd", methods=["DELETE"])
def delete_jd(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = _get_chat_or_403(chat_id, user)
    if not chat:
        return jsonify({"error": "invalid chat"}), 403

    deleted = JobDescription.query.filter_by(chat_id=chat_id).delete()
    db.session.commit()

    logger.info("[jd_routes] Deleted %d JD row(s) for chat %s", deleted, chat_id)
    return jsonify({"deleted": deleted > 0})

