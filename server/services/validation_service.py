"""
services/validation_service.py

Server-side validation for exam config and session parameters.
Ensures frontend cannot manipulate critical values.
"""

from typing import Tuple, Optional

ALLOWED_SESSION_MODES = {"normal", "voice", "video"}
ALLOWED_MEDIA_MODES = {"camera", "audio", "screen"}
ALLOWED_QUESTION_TYPES = {"mcq", "fill_blank", "true_false", "descriptive"}
ALLOWED_BLOOM_LEVELS = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"}

MAX_QUESTIONS_PER_TYPE = 50
MAX_TOTAL_QUESTIONS = 100
MAX_MARKS_PER_QUESTION = 20
MAX_FLASHCARD_COUNT = 30
MIN_FLASHCARD_COUNT = 5


def validate_exam_config(data: dict) -> Tuple[dict, Optional[str]]:
    """
    Validate and sanitize exam config from frontend.
    Returns (sanitized_config, error_message).
    error_message is None if valid.
    """
    exam_config = data.get("examConfig") or {}
    session_mode = str(exam_config.get("sessionMode") or data.get("sessionMode") or "normal").strip().lower()

    if session_mode not in ALLOWED_SESSION_MODES:
        session_mode = "normal"

    video_media_mode = str(exam_config.get("videoMediaMode") or "camera").strip().lower()
    if video_media_mode not in ALLOWED_MEDIA_MODES:
        video_media_mode = "camera"

    # Validate question types
    raw_qtypes = exam_config.get("questionTypes") or {}
    sanitized_qtypes = {}

    total_questions = 0
    for qtype in ALLOWED_QUESTION_TYPES:
        cfg = raw_qtypes.get(qtype) or {}
        count = _clamp_int(cfg.get("count", 0), 0, MAX_QUESTIONS_PER_TYPE)
        marks = _clamp_float(cfg.get("marks", 0), 0, MAX_MARKS_PER_QUESTION)
        neg_marks = 0.0 if qtype == "descriptive" else _clamp_float(cfg.get("negativeMarks", 0), 0, marks)

        sanitized_qtypes[qtype] = {
            "count": count,
            "marks": marks,
            "negativeMarks": neg_marks,
        }
        total_questions += count

    if total_questions > MAX_TOTAL_QUESTIONS:
        return {}, f"Total questions ({total_questions}) exceeds maximum allowed ({MAX_TOTAL_QUESTIONS})"

    # Validate bloom levels
    raw_blooms = data.get("bloomLevels") or data.get("blooms") or []
    if not raw_blooms and data.get("bloom"):
        raw_blooms = [data.get("bloom")]

    sanitized_blooms = [
        b for b in (str(x).strip().title() for x in raw_blooms)
        if b in ALLOWED_BLOOM_LEVELS
    ]
    if not sanitized_blooms:
        sanitized_blooms = ["Understand"]

    sanitized_config = {
        **{k: v for k, v in exam_config.items()
           if k not in ("questionTypes", "sessionMode", "videoMediaMode")},
        "questionTypes": sanitized_qtypes,
        "sessionMode": session_mode,
        "videoMediaMode": video_media_mode,
    }

    return sanitized_config, None, sanitized_blooms


def validate_flashcard_request(data: dict, allowed_topics: list) -> Tuple[dict, Optional[str]]:
    """
    Validate flashcard generation request.
    Returns (sanitized_data, error_message).
    """
    mode = str(data.get("mode") or "full").strip().lower()
    if mode not in {"full", "weak", "topic"}:
        mode = "full"

    count = _clamp_int(data.get("count", 15), MIN_FLASHCARD_COUNT, MAX_FLASHCARD_COUNT)

    topic_hint = str(data.get("topic") or "").strip()
    if topic_hint and allowed_topics:
        # Ensure topic belongs to this chat's topics
        allowed_lower = {t.lower(): t for t in allowed_topics}
        matched = allowed_lower.get(topic_hint.lower())
        if not matched:
            # Do fuzzy match — if topic not found at all, clear it
            topic_hint = matched or ""

    return {"mode": mode, "count": count, "topic": topic_hint}, None


def _clamp_int(value, min_val: int, max_val: int) -> int:
    try:
        return max(min_val, min(max_val, int(value or 0)))
    except (TypeError, ValueError):
        return min_val


def _clamp_float(value, min_val: float, max_val: float) -> float:
    try:
        return max(float(min_val), min(float(max_val), float(value or 0)))
    except (TypeError, ValueError):
        return float(min_val)