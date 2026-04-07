"""
routes/pdf_routes.py

Changes from original:
- upload_pdf now accepts .pdf AND .pptx files
- Returns 415 for unsupported file types
- Renamed "pdf" concept to "document" in error messages but kept API paths unchanged
"""

import os
from flask import Blueprint, request, jsonify, current_app
from werkzeug.utils import secure_filename
from models import Chat, PDFDocument
from extensions import db
from utils import generate_id, sha256_file
from utils.document_extractor import get_supported_extensions
from services.auth_service import get_user_from_token
from services.cache_service import invalidate_chat
from tasks.pdf_tasks import process_pdf_task

bp = Blueprint("pdf_routes", __name__)

SUPPORTED_EXTENSIONS = set(get_supported_extensions())   # {".pdf", ".pptx"}


def _is_supported_file(filename: str) -> bool:
    ext = os.path.splitext(filename or "")[1].lower()
    return ext in SUPPORTED_EXTENSIONS


@bp.route("/api/chats/<chat_id>/pdfs", methods=["POST"])
def upload_pdf(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "invalid chat"}), 403

    file = request.files.get("pdf")
    if not file or not file.filename:
        return jsonify({"error": "No file provided"}), 400

    # ── File type validation ──────────────────────────────────────────────
    if not _is_supported_file(file.filename):
        ext = os.path.splitext(file.filename)[1].lower() or "(none)"
        return jsonify({
            "error": f"Unsupported file type '{ext}'. Accepted: PDF (.pdf), PowerPoint (.pptx)"
        }), 415

    original_name = secure_filename(file.filename)
    unique_name   = f"{generate_id()}_{original_name}"
    path          = os.path.join(current_app.config["UPLOAD_FOLDER"], unique_name)

    file.save(path)
    file_hash = sha256_file(path)

    # ── Duplicate checks (unchanged logic) ───────────────────────────────
    existing = (
        PDFDocument.query
        .filter_by(chat_id=chat_id, file_hash=file_hash)
        .order_by(PDFDocument.uploaded_at.desc())
        .first()
    )

    if existing and not existing.error and existing.is_processed:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
        return jsonify({
            "error":   "This document was already uploaded in this chat.",
            "pdfId":   existing.id,
            "status":  "duplicate"
        }), 409

    if existing and not existing.error and not existing.is_processed:
        try:
            if os.path.exists(path):
                os.remove(path)
        except Exception:
            pass
        return jsonify({
            "error":  "This document is already uploaded and still processing.",
            "pdfId":  existing.id,
            "status": "duplicate_processing"
        }), 409

    if existing and (existing.error or existing.pdf_type == "failed"):
        existing.filename    = original_name
        existing.file_path   = path
        existing.file_hash   = file_hash
        existing.pdf_type    = "pending"
        existing.is_processed = False
        existing.error       = None
        db.session.commit()

        process_pdf_task.delay(existing.id, user.id, chat_id, path)
        invalidate_chat(chat_id, user.id)

        return jsonify({
            "pdfId":      existing.id,
            "status":     "requeued",
            "processing": True
        }), 202

    # ── New document ──────────────────────────────────────────────────────
    pdf = PDFDocument(
        id=generate_id(),
        chat_id=chat_id,
        filename=original_name,
        file_path=path,
        file_hash=file_hash,
        pdf_type="pending",
        is_processed=False
    )

    db.session.add(pdf)
    db.session.commit()

    process_pdf_task.delay(pdf.id, user.id, chat_id, path)
    invalidate_chat(chat_id, user.id)

    return jsonify({
        "pdfId":      pdf.id,
        "status":     "uploaded",
        "processing": True
    }), 202


@bp.route("/api/chats/<chat_id>/pdfs", methods=["GET"])
def list_pdfs(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "unauthorized"}), 403

    return jsonify([
        {
            "pdfId":      pdf.id,
            "filename":   pdf.filename,
            "type":       pdf.pdf_type,
            "processed":  pdf.is_processed,
            "error":      pdf.error,
            "uploadedAt": pdf.uploaded_at.isoformat()
        }
        for pdf in chat.pdfs
    ])


@bp.route("/api/pdfs/<pdf_id>/retry", methods=["POST"])
def retry_pdf(pdf_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    pdf = PDFDocument.query.get(pdf_id)
    if not pdf:
        return jsonify({"error": "not found"}), 404

    chat = Chat.query.get(pdf.chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "unauthorized"}), 403

    if not (pdf.error or pdf.pdf_type == "failed"):
        return jsonify({"error": "Document is not in failed state"}), 400

    pdf.is_processed = False
    pdf.error        = None
    pdf.pdf_type     = "pending"
    db.session.commit()

    process_pdf_task.delay(pdf.id, user.id, pdf.chat_id, pdf.file_path)

    return jsonify({"status": "requeued"}), 202



@bp.route("/api/pdfs/<pdf_id>", methods=["DELETE"])
def delete_pdf(pdf_id):
    """
    Delete a single PDF/document from a chat.
    Also removes its embeddings from ChromaDB.
    """
    import os as _os
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    pdf = PDFDocument.query.get(pdf_id)
    if not pdf:
        return jsonify({"error": "not found"}), 404

    chat = Chat.query.get(pdf.chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "unauthorized"}), 403

    chat_id = pdf.chat_id

    # Remove embeddings from ChromaDB (best-effort)
    try:
        from services.chroma_service import get_chroma_client, chroma_collection_name, get_chroma_collection
        client     = get_chroma_client()
        col_name   = chroma_collection_name(user.id, chat_id)
        collection = get_chroma_collection(client, col_name)
        # Embeddings are stored with ids like "{pdf_id}_0", "{pdf_id}_1", ...
        # Get all ids that belong to this pdf
        try:
            all_ids = collection.get(where={"pdf_id": pdf_id}, include=[])
            if all_ids and all_ids.get("ids"):
                collection.delete(ids=all_ids["ids"])
        except Exception:
            # Fallback: try deleting by prefix pattern
            pass
    except Exception:
        pass

    # Remove file from disk (best-effort)
    try:
        if pdf.file_path and _os.path.exists(pdf.file_path):
            _os.remove(pdf.file_path)
    except Exception:
        pass

    db.session.delete(pdf)
    db.session.commit()

    invalidate_chat(chat_id, user.id)

    return jsonify({"deleted": True, "pdfId": pdf_id})