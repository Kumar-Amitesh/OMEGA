"""
routes/video_routes.py

SAVE-BEFORE-RESPOND ARCHITECTURE:
  After Gemini returns feedback for a question, this route:
    1. Parses and sanitises the feedback
    2. Upserts it into PracticeSession.feedback_json ATOMICALLY
    3. THEN returns the response to the frontend

  This means the data is already in the DB before the browser
  ever receives the response. Network drop, tab close, browser
  crash AFTER the server responds — doesn't matter. The question
  is already saved.

  The frontend no longer needs to call a separate save endpoint
  per question. It only calls /video-session/finalize at the end
  to set the final score and mark the session complete.

Required form fields:
  - media        : video/audio file
  - question     : question text
  - question_id  : the question's id from the questions list
  - session_id   : PracticeSession.id (pre-created or created on first question)
  - media_type   : "video" | "audio"
  - topic        : optional
  - bloom_level  : optional

File size handling:
  - Under 18 MB  → inline bytes (no Files API)
  - Over  18 MB  → Files API with optional ffmpeg conversion
  - ffmpeg is optional; install with: apt-get install -y ffmpeg
"""

import os
import json
import tempfile
import time
import re as _re
import subprocess
from flask import Blueprint, request, jsonify
from models import Chat, PracticeSession
from extensions import db
from services.auth_service import get_user_from_token
from utils import generate_id
from llm import get_gemini_model
from logger import get_logger
import google.generativeai as genai

logger = get_logger("video_routes")
bp = Blueprint("video_routes", __name__)

MAX_UPLOAD_BYTES = 100 * 1024 * 1024   # 100 MB hard limit
INLINE_THRESHOLD =  18 * 1024 * 1024   # < 18 MB → inline (no Files API)
FFMPEG_TIMEOUT   = 120


# ── ffmpeg helpers ─────────────────────────────────────────────────────────────

def _has_ffmpeg():
    try:
        subprocess.run(["ffmpeg", "-version"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        return True
    except Exception:
        return False


def _to_mp4(src, dst):
    result = subprocess.run([
        "ffmpeg", "-y", "-i", src,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-max_muxing_queue_size", "1024",
        dst,
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=FFMPEG_TIMEOUT)
    if result.returncode != 0:
        logger.error("[video] ffmpeg stderr: %s",
                     result.stderr.decode(errors="replace")[-1000:])
    return result.returncode == 0


def _to_mp3(src, dst):
    result = subprocess.run([
        "ffmpeg", "-y", "-i", src, "-vn",
        "-c:a", "libmp3lame", "-q:a", "4",
        dst,
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=FFMPEG_TIMEOUT)
    return result.returncode == 0


# ── Evaluation prompt ──────────────────────────────────────────────────────────

def _eval_prompt(question, is_video):
    visual_note = (
        "This is a VIDEO submission — evaluate eye contact with the camera, "
        "posture, and professional appearance."
        if is_video else
        "This is AUDIO-only — set visual.eyeContactEngagement and "
        "visual.postureProfessionalism to null."
    )
    return f"""You are a professional interview coach evaluating a candidate's recorded answer.

Question asked: "{question}"

{visual_note}

Listen/watch carefully. Return ONLY valid JSON (no markdown, no preamble).

Scoring: 0-10 (10 = excellent).

{{
  "overallScore": 0.0,
  "question": "{question}",
  "transcript": "verbatim transcript",
  "content": {{
    "answerRelevance": 0,
    "completeness": 0,
    "structure": 0,
    "examplesSpecificity": 0
  }},
  "delivery": {{
    "clarity": 0,
    "confidencePresentation": 0,
    "pacing": 0,
    "fillerWords": 0
  }},
  "visual": {{
    "eyeContactEngagement": null,
    "postureProfessionalism": null
  }},
  "naturalness": {{
    "score": 0,
    "notes": "2-3 sentence coaching note"
  }},
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["improvement 1", "improvement 2"],
  "suggestedBetterAnswer": "3-5 sentence example"
}}

Criteria:
- content.answerRelevance        how directly the answer addresses the question
- content.completeness           are all key points covered
- content.structure              clear opening, body, conclusion
- content.examplesSpecificity    concrete personal examples vs generic statements
- delivery.clarity               speech clarity and articulation
- delivery.confidencePresentation sounds confident, not hesitant
- delivery.pacing                comfortable pace
- delivery.fillerWords           INVERSE of filler frequency (10=none, 0=constant um/uh/like)
- visual.eyeContactEngagement    video only — natural eye contact with camera
- visual.postureProfessionalism  video only — upright posture, professional look
- naturalness.score              authentic/spontaneous vs scripted/memorised/generic
- overallScore                   content 40% + delivery 35% + visual 15%(video)/0%(audio) + naturalness 10%"""


# ── Score sanitiser ─────────────────────────────────────────────────────────────

def _clamp(v):
    try:
        return round(max(0.0, min(10.0, float(v))), 1)
    except Exception:
        return None


def _sanitise_feedback(feedback: dict, media_type: str) -> dict:
    """Clamp all numeric scores to 0-10."""
    for section in ("content", "delivery"):
        seg = feedback.get(section) or {}
        feedback[section] = {k: _clamp(v) for k, v in seg.items()}

    if media_type == "audio":
        feedback["visual"] = {
            "eyeContactEngagement": None,
            "postureProfessionalism": None,
        }
    elif feedback.get("visual"):
        feedback["visual"] = {
            k: (_clamp(v) if v is not None else None)
            for k, v in feedback["visual"].items()
        }

    if isinstance(feedback.get("naturalness"), dict):
        feedback["naturalness"]["score"] = _clamp(
            feedback["naturalness"].get("score")
        )

    if feedback.get("overallScore") is not None:
        feedback["overallScore"] = _clamp(feedback["overallScore"])

    return feedback


# ── Atomic per-question DB save ─────────────────────────────────────────────────

def _save_question_feedback_to_db(
    session_id: str,
    chat_id: str,
    question_id: str,
    question_obj: dict,
    feedback: dict,
    all_questions: list,
):
    """
    Upsert one question's feedback entry into PracticeSession.feedback_json.

    If the session row doesn't exist yet (first question of the session),
    it is created here. If it already exists, the new entry is merged in.

    This is called BEFORE returning the HTTP response so the data is
    persisted regardless of what happens to the client connection afterwards.
    """
    try:
        score          = feedback.get("overallScore") or 0.0
        feedback_entry = {
            "type":               "video",
            "topic":              question_obj.get("topic") or "General",
            "question":           question_obj.get("question") or "",
            "userAnswer":         feedback.get("transcript") or "",
            "correctAnswer":      None,
            "isCorrect":          None,
            "understandingScore": round((score / 10) * 10),
            "overallScore":       score,
            "videoFeedback":      feedback,
            "bloomLevel":         question_obj.get("bloomLevel"),
            "difficulty":         question_obj.get("difficulty"),
            "awardedMarks":       round(score * 10) / 10,
            "maxMarks":           10,
            "skipped":            False,
        }

        session = PracticeSession.query.get(session_id)

        if session:
            # Merge new entry into existing feedback map
            existing_feedback = {}
            if session.feedback_json:
                try:
                    existing_feedback = json.loads(session.feedback_json)
                except (json.JSONDecodeError, TypeError):
                    existing_feedback = {}

            existing_feedback[question_id] = feedback_entry
            session.feedback_json = json.dumps(existing_feedback)

            # Also keep questions list up to date
            if all_questions:
                session.questions = json.dumps(all_questions)

        else:
            # First question for this session — create the row
            feedback_map = {question_id: feedback_entry}
            session = PracticeSession(
                id            = session_id,
                chat_id       = chat_id,
                session_type  = "video_full",  # will be confirmed on finalize
                questions     = json.dumps(all_questions or []),
                answers       = json.dumps({question_id: feedback.get("transcript") or ""}),
                feedback_json = json.dumps(feedback_map),
                score         = None,          # null = in-progress
            )
            db.session.add(session)

        db.session.commit()
        logger.info(
            "[video] saved question=%s to session=%s score=%s",
            question_id, session_id, score,
        )

    except Exception as exc:
        db.session.rollback()
        # Log the error but DO NOT abort the request — the feedback was
        # already computed, we still return it to the user. They at minimum
        # see their result even if the DB write failed.
        logger.exception(
            "[video] DB save failed for session=%s question=%s: %s",
            session_id, question_id, exc,
        )


# ── Route ───────────────────────────────────────────────────────────────────────

@bp.route("/api/chats/<chat_id>/video-question", methods=["POST"])
def evaluate_video_answer(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "invalid chat"}), 403

    # ── Parse request ──────────────────────────────────────────────────────
    media_file  = request.files.get("media")
    question    = (request.form.get("question")    or "").strip()
    question_id = (request.form.get("question_id") or "").strip()
    session_id  = (request.form.get("session_id")  or "").strip()
    media_type  = (request.form.get("media_type")  or "video").strip().lower()
    topic       = (request.form.get("topic")       or "General").strip()
    bloom_level = (request.form.get("bloom_level") or "").strip()
    difficulty  = (request.form.get("difficulty")  or "medium").strip()

    # all_questions: the full question list, JSON-encoded, so we can persist it
    all_questions_raw = (request.form.get("all_questions") or "").strip()
    all_questions = []
    if all_questions_raw:
        try:
            all_questions = json.loads(all_questions_raw)
        except (json.JSONDecodeError, TypeError):
            all_questions = []

    if not media_file:
        return jsonify({"error": "No media file uploaded."}), 400
    if not question:
        return jsonify({"error": "Question is required."}), 400
    if media_type not in ("video", "audio"):
        media_type = "video"

    # Generate IDs if not provided (should always be provided from frontend)
    if not question_id:
        question_id = generate_id()
    if not session_id:
        session_id = generate_id()

    media_file.seek(0, 2)
    raw_size = media_file.tell()
    media_file.seek(0)

    if raw_size > MAX_UPLOAD_BYTES:
        return jsonify({"error": "File too large (max 100 MB)."}), 413

    logger.info(
        "[video] chat=%s session=%s question=%s media_type=%s size=%d bytes",
        chat_id, session_id, question_id, media_type, raw_size,
    )

    tmp_path  = None
    conv_path = None
    gfile     = None

    try:
        # ── 1. Save raw upload to temp file ───────────────────────────────
        orig_ext = os.path.splitext(media_file.filename or "rec.webm")[1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=orig_ext, delete=False) as f:
            media_file.save(f)
            tmp_path = f.name

        logger.info("[video] raw saved: %s", tmp_path)

        upload_path = tmp_path
        upload_mime = "audio/webm" if media_type == "audio" else "video/webm"

        # ── 2. Optionally convert large files via ffmpeg ───────────────────
        if raw_size >= INLINE_THRESHOLD and _has_ffmpeg():
            if media_type == "audio":
                conv_path = tmp_path + ".mp3"
                if _to_mp3(tmp_path, conv_path) and os.path.exists(conv_path):
                    upload_path = conv_path
                    upload_mime = "audio/mp3"
                    logger.info("[video] converted to mp3: %d bytes",
                                os.path.getsize(conv_path))
            else:
                conv_path = tmp_path + ".mp4"
                if _to_mp4(tmp_path, conv_path) and os.path.exists(conv_path):
                    upload_path = conv_path
                    upload_mime = "video/mp4"
                    logger.info("[video] converted to mp4: %d bytes",
                                os.path.getsize(conv_path))

        upload_size = os.path.getsize(upload_path)
        logger.info("[video] sending to Gemini: %s %s (%d bytes)",
                    upload_path, upload_mime, upload_size)

        # ── 3. Build prompt ────────────────────────────────────────────────
        model  = get_gemini_model()
        prompt = _eval_prompt(question, is_video=(media_type == "video"))

        # ── 4. Call Gemini ─────────────────────────────────────────────────
        if upload_size < INLINE_THRESHOLD:
            logger.info("[video] using inline bytes path")
            with open(upload_path, "rb") as f:
                media_bytes = f.read()

            try:
                from google.generativeai import types as gtypes
                part = gtypes.Part.from_bytes(data=media_bytes, mime_type=upload_mime)
                response = model.generate_content([part, prompt])
            except AttributeError:
                logger.warning("[video] Part.from_bytes unavailable, using dict form")
                response = model.generate_content([
                    {"inline_data": {"mime_type": upload_mime, "data": media_bytes}},
                    prompt,
                ])
        else:
            logger.info("[video] using Files API path")
            gfile = genai.upload_file(
                path=upload_path,
                mime_type=upload_mime,
                display_name=os.path.basename(upload_path),
            )
            logger.info("[video] uploaded: name=%s state=%s",
                        gfile.name, gfile.state.name)

            waited = 0
            while gfile.state.name == "PROCESSING" and waited < 120:
                time.sleep(3)
                waited += 3
                gfile = genai.get_file(gfile.name)
                logger.info("[video] polling state=%s waited=%ds",
                            gfile.state.name, waited)

            if gfile.state.name != "ACTIVE":
                logger.error("[video] file never became ACTIVE: state=%s",
                             gfile.state.name)
                return jsonify({
                    "error": "Could not process media. Try a shorter clip or audio-only mode."
                }), 500

            response = model.generate_content([gfile, prompt])

        # ── 5. Parse response ──────────────────────────────────────────────
        raw_text = getattr(response, "text", None) or ""
        logger.info("[video] Gemini response: %d chars", len(raw_text))

        clean = _re.sub(r"```json|```", "", raw_text, flags=_re.IGNORECASE).strip()
        match = _re.search(r"\{.*\}", clean, _re.DOTALL)

        feedback = {}
        if match:
            try:
                feedback = json.loads(match.group())
            except json.JSONDecodeError as e:
                logger.error("[video] JSON parse error: %s | text: %s",
                             e, raw_text[:300])

        if not feedback:
            return jsonify({
                "error": "AI returned an invalid response. Please try again."
            }), 500

        # ── 6. Sanitise scores ─────────────────────────────────────────────
        feedback = _sanitise_feedback(feedback, media_type)

        # ── 7. SAVE TO DB BEFORE RESPONDING ───────────────────────────────
        # This is the key step. Data is persisted here, not in the frontend.
        # Even if the client disconnects after this point, the feedback is safe.
        question_obj = {
            "id":         question_id,
            "question":   question,
            "topic":      topic,
            "bloomLevel": bloom_level,
            "difficulty": difficulty,
        }
        _save_question_feedback_to_db(
            session_id   = session_id,
            chat_id      = chat_id,
            question_id  = question_id,
            question_obj = question_obj,
            feedback     = feedback,
            all_questions = all_questions,
        )

        logger.info("[video] success, overallScore=%s session=%s",
                    feedback.get("overallScore"), session_id)

        # Return session_id so frontend always knows what session it's in
        return jsonify({
            "feedback":   feedback,
            "session_id": session_id,
            "saved":      True,   # tells frontend "already in DB"
        })

    except Exception as exc:
        logger.exception("[video] error: %s", exc)
        return jsonify({"error": f"Evaluation failed: {str(exc)}"}), 500

    finally:
        for path in (tmp_path, conv_path):
            if path and os.path.exists(path):
                try:
                    os.remove(path)
                except Exception:
                    pass
        if gfile:
            try:
                genai.delete_file(gfile.name)
            except Exception:
                pass


