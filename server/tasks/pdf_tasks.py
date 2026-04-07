"""
tasks/pdf_tasks.py
 
Changes from original:
- Fixed Celery retry race condition:
  The original caught generic Exception, set is_processed=True, then re-raised.
  Celery saw the re-raise and scheduled a retry — but the DB already said
  "failed/processed", so the retry would find a document that looks done
  and behave unpredictably.
 
  Fix: generic exceptions now call self.retry() explicitly with a countdown,
  capped at max_retries. If retries are exhausted, THEN we mark the document
  as permanently failed and commit. This means:
    - Transient errors (network, Gemini timeout) → retried up to 3 times
    - Permanent errors (bad file, wrong extension) → marked failed immediately
    - DB is only marked "failed" when we are genuinely giving up
 
- Uses existing get_logger() instead of bare logging calls.
- Everything else (page-aware chunking, PPTX support, topic upsert, etc.)
  is unchanged.
"""
 
import json
import os
from extensions import celery, db
from models import Chat, PDFDocument, SubjectTopic
from utils.document_extractor import extract_pages, extract_text, get_supported_extensions
from services.embedding_service import create_embeddings_from_pages
from services.topic_service import tag_chunk_with_topics
from services.chroma_service import store_embeddings_in_chroma
from services.exam_service import analyze_pdf_intelligence, normalize_exam_pattern
from logger import get_logger
from llm import NonRetryableError
 
logger = get_logger("celery")
 
# Maximum number of automatic retries for transient failures
_MAX_RETRIES = 3
# Seconds to wait before first retry; doubles each time (exponential backoff)
_RETRY_COUNTDOWN = 15
 
 
@celery.task(bind=True, max_retries=_MAX_RETRIES)
def process_pdf_task(self, pdf_id, user_id, chat_id, path):
    """
    Process a single uploaded document (PDF or PPTX):
      1. Extract text page-by-page
      2. Analyse with LLM (classify, detect topics, infer exam pattern)
      3. Embed and store in ChromaDB
 
    Retry behaviour:
      - NonRetryableError  → mark failed immediately, no retry
      - Any other error    → retry up to _MAX_RETRIES times with backoff
      - Retries exhausted  → mark failed permanently
    """
    from app import app
 
    with app.app_context():
        pdf = PDFDocument.query.get(pdf_id)
        if not pdf:
            logger.error("[CELERY] PDF row missing: %s — aborting", pdf_id)
            return
 
        chat = Chat.query.get(chat_id)
        if not chat:
            logger.error("[CELERY] Chat missing: %s — aborting", chat_id)
            return
 
        try:
            # ── Validate file extension ───────────────────────────────────
            ext = os.path.splitext(path)[1].lower()
            supported = get_supported_extensions()
            if ext not in supported:
                raise NonRetryableError(
                    f"Unsupported file type '{ext}'. Supported: {', '.join(supported)}"
                )
 
            if not os.path.exists(path):
                raise NonRetryableError(f"File not found on disk: {path}")
 
            logger.info("[CELERY] Processing document %s (type=%s)", pdf_id, ext)
 
            # ── Extract pages ─────────────────────────────────────────────
            pages = extract_pages(path)
            if not pages:
                raise NonRetryableError("No text could be extracted from this document.")
 
            full_text = extract_text(path)
            logger.info("[CELERY] Extracted %d chars from %s", len(full_text), pdf_id)
 
            # ── Analyse document intelligence ─────────────────────────────
            analysis = analyze_pdf_intelligence(full_text) or {
                "type": "notes",
                "subject": "Unknown",
                "topics": [{"unit": "Unit", "topic": "General"}],
                "topicFrequency": {},
                "examPattern": {
                    "questionTypes": {
                        "mcq":         {"count": 0, "marks": 0, "negativeMarks": 0},
                        "fill_blank":  {"count": 0, "marks": 0, "negativeMarks": 0},
                        "true_false":  {"count": 0, "marks": 0, "negativeMarks": 0},
                        "descriptive": {"count": 0, "marks": 0, "negativeMarks": 0},
                    }
                },
            }
 
            pdf.pdf_type     = analysis["type"]
            base_cfg         = json.loads(chat.exam_config or "{}")
            detected_subject = analysis.get("subject", "Unknown")
 
            # ── Subject tracking (display only — no rejection) ────────────
            # We record the first detected subject for display in the topbar,
            # but intentionally do NOT block uploads whose detected subject
            # differs. A single course (e.g. BCSE206L) legitimately spans SQL,
            # NLP, Statistics, etc. — each PPT/PDF gets classified differently
            # by the LLM even though they all belong in the same chat.
            # ChromaDB retrieval is semantic — wrong-topic chunks simply get
            # low relevance scores and don't appear in question generation.
            if not base_cfg.get("subject") or base_cfg.get("subject") == "Unknown":
                if detected_subject and detected_subject != "Unknown":
                    base_cfg["subject"] = detected_subject
                    chat.exam_config    = json.dumps(base_cfg)
 
            # ── Upsert topics ─────────────────────────────────────────────
            for t in analysis.get("topics", []):
                exists = SubjectTopic.query.filter_by(
                    chat_id=chat_id,
                    topic_name=t["topic"],
                    unit_name=t["unit"],
                ).first()
                if not exists:
                    db.session.add(SubjectTopic(
                        chat_id=chat_id,
                        topic_name=t["topic"],
                        unit_name=t["unit"],
                    ))
 
            # ── Merge exam pattern if question paper ──────────────────────
            if analysis["type"] == "question_paper" and analysis.get("examPattern"):
                base             = json.loads(chat.exam_config or "{}")
                inferred_pattern = normalize_exam_pattern(analysis.get("examPattern") or {})
                inferred_qtypes  = inferred_pattern.get("questionTypes") or {}
                existing_qtypes  = base.get("questionTypes") or {}
                merged_qtypes    = {}
 
                for qtype in ["mcq", "fill_blank", "true_false", "descriptive"]:
                    old_cfg = existing_qtypes.get(qtype) or {}
                    new_cfg = inferred_qtypes.get(qtype) or {}
                    merged_qtypes[qtype] = {
                        "count":  int(old_cfg.get("count",  new_cfg.get("count",  0)) or 0),
                        "marks":  float(old_cfg.get("marks", new_cfg.get("marks",  0)) or 0),
                        "negativeMarks": (
                            0.0 if qtype == "descriptive"
                            else float(
                                old_cfg.get("negativeMarks",
                                            new_cfg.get("negativeMarks", 0)) or 0
                            )
                        ),
                    }
 
                base["questionTypes"] = merged_qtypes
                chat.exam_config      = json.dumps(base)
 
            if analysis["type"] == "question_paper" and analysis.get("topicFrequency"):
                base = json.loads(chat.exam_config or "{}")
                old  = base.get("pyqTopicFrequency", {}) or {}
                new  = analysis.get("topicFrequency", {}) or {}
                for k, v in new.items():
                    try:
                        old[k] = old.get(k, 0) + int(v or 0)
                    except Exception:
                        old[k] = old.get(k, 0)
                base["pyqTopicFrequency"] = old
                chat.exam_config          = json.dumps(base)
 
            # ── Embed with page-aware chunking ────────────────────────────
            topic_tree = SubjectTopic.query.filter_by(chat_id=chat_id).all()
            topic_map  = [{"topic": t.topic_name, "unit": t.unit_name} for t in topic_tree]
 
            page_chunks, emb = create_embeddings_from_pages(pages)
            logger.info("[CELERY] Embeddings: %d chunks for %s", len(emb), pdf_id)
 
            tagged = [
                {
                    "text":   c["text"],
                    "page":   c["page"],
                    "topics": tag_chunk_with_topics(c["text"], topic_map),
                }
                for c in page_chunks
            ]
 
            store_embeddings_in_chroma(
                user_id, chat_id, pdf.id,
                tagged, emb, pdf.pdf_type,
                filename=pdf.filename or "",
            )
 
            pdf.is_processed = True
            pdf.error        = None
            db.session.commit()
            logger.info("[CELERY] Done: %s", pdf_id)
 
        except NonRetryableError as e:
            # Permanent failure — mark and stop immediately, no retry
            logger.error("[CELERY] Non-retryable error for %s: %s", pdf_id, e)
            pdf.error        = str(e)
            pdf.pdf_type     = "failed"
            pdf.is_processed = True
            db.session.commit()
            return  # explicit return — do NOT re-raise, do NOT retry
 
        except Exception as e:
            logger.warning(
                "[CELERY] Transient error for %s (attempt %d/%d): %s",
                pdf_id, self.request.retries + 1, _MAX_RETRIES, e,
            )
 
            if self.request.retries < _MAX_RETRIES:
                # Schedule a retry with exponential backoff.
                # Do NOT touch the DB here — the document stays in "pending"
                # state so the next attempt can try again cleanly.
                countdown = _RETRY_COUNTDOWN * (2 ** self.request.retries)
                raise self.retry(exc=e, countdown=countdown)
            else:
                # Retries exhausted — now we give up and mark as failed
                logger.error(
                    "[CELERY] All retries exhausted for %s: %s", pdf_id, e
                )
                pdf.error        = f"Failed after {_MAX_RETRIES} retries: {str(e)}"
                pdf.pdf_type     = "failed"
                pdf.is_processed = True
                db.session.commit()
                # Do NOT re-raise — this would cause Celery to try again
                # even though max_retries is reached in some configurations
                return