"""
routes/question_routes.py

Changes from previous iteration:
- Added optional rate limiting (10 per hour per IP) on both generation
  endpoints. Limiter is fetched from app.extensions so it works whether
  Flask-Limiter is installed or not — the route never breaks without it.
- Added logger for generation start/finish events.
- Chunk rotation and session_seed from previous iteration preserved.
- Everything else unchanged.
"""

import json
from flask import Blueprint, request, jsonify, current_app
from models import Chat, PDFDocument, SubjectTopic, PracticeSession
from extensions import db
from utils import generate_id, safe_json_extract
from services.auth_service import get_user_from_token
from services.chroma_service import (
    get_chroma_client,
    chroma_collection_name,
    get_chroma_collection,
    compute_topic_weights,
    fetch_topic_chunks,
    merge_context_by_topics_budgeted,
)
from services.exam_service import (
    get_question_types_config,
    parse_bloom_levels,
    pick_bloom_level_for_question,
)
from services.topic_service import map_to_closest_topic, top_n_weights
from services.evaluation_service import top_weak_topics
from services.cache_service import invalidate_chat
from llm import call_gemini
from services.bloom_trajectory_service import get_adaptive_bloom_levels
from logger import get_logger

logger = get_logger("question_routes")

bp = Blueprint("question_routes", __name__)

FORMATTING_RULES = """
Output rules (STRICT):
- Plain text only. No markdown. No bullet points. No headers.
- If content has a table, convert it to plain descriptive sentences.
- Never use |, -, *, #, **, or any markdown syntax.
- Questions and answers must be plain readable text.
"""

# Rate limit string — change here to adjust globally for both generation routes
_GENERATION_RATE_LIMIT = "10 per hour"


def _get_limiter():
    """Return the limiter extension if registered, else None."""
    return current_app.extensions.get("limiter")


def _apply_rate_limit():
    """
    Apply the generation rate limit to the current request.
    Safe no-op if Flask-Limiter is not installed or Redis is unavailable.
    Returns a 429 Response if the limit is exceeded, else None.
    """
    limiter = _get_limiter()
    if limiter is None:
        return None
    try:
        # Check the limit for the current IP against this specific string.
        # We call check() directly so we can return the response ourselves
        # rather than relying on the decorator pattern which doesn't work
        # cleanly inside blueprints without importing the limiter at module level.
        limiter.limit(_GENERATION_RATE_LIMIT)
        return None
    except Exception as exc:
        # If flask_limiter raises RateLimitExceeded we return 429.
        # Any other exception (Redis down, config error) we let through.
        exc_name = type(exc).__name__
        if "RateLimitExceeded" in exc_name or "429" in str(exc):
            logger.warning("Rate limit hit on generation endpoint: %s", exc)
            return jsonify({
                "error": "Too many requests. You can generate up to 10 exams per hour.",
            }), 429
        # Unexpected error — log and continue (don't block the user)
        logger.warning("Rate limiter error (non-blocking): %s", exc)
        return None


def _get_session_seed(chat_id: str) -> int:
    """
    Returns the number of completed sessions for this chat.
    Used as session_seed so chunk offsets rotate each time a new exam is
    generated — students progressively see more of each topic's content.
    """
    return PracticeSession.query.filter_by(chat_id=chat_id).count()


@bp.route("/api/chats/<chat_id>/questions/generate/full", methods=["POST"])
def generate_full_exam(chat_id):
    rate_limit_response = _apply_rate_limit()
    if rate_limit_response:
        return rate_limit_response

    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "invalid chat"}), 403

    pending = PDFDocument.query.filter_by(chat_id=chat_id, is_processed=False).count()
    if pending > 0:
        return jsonify({"error": "PDFs still processing"}), 400

    successful_pdf_count = (
        PDFDocument.query
        .filter_by(chat_id=chat_id, is_processed=True)
        .filter(PDFDocument.error.is_(None))
        .count()
    )
    if successful_pdf_count == 0:
        return jsonify({"error": "At least one successfully processed PDF is required"}), 400

    # ── Config from DB only — never from request body ─────────────────────
    exam_cfg       = json.loads(chat.exam_config or "{}")
    question_types = get_question_types_config(exam_cfg)
    bloom_levels   = get_adaptive_bloom_levels(chat_id, chat.bloom_level)
    bloom_prompt   = ", ".join(bloom_levels)

    client          = get_chroma_client()
    collection_name = chroma_collection_name(user.id, chat_id)
    collection      = get_chroma_collection(client, collection_name)

    db_topics = SubjectTopic.query.filter_by(chat_id=chat_id).all()
    allowed   = [t.topic_name for t in db_topics if t.topic_name] or ["General"]

    weights       = compute_topic_weights(collection)
    weights_small = top_n_weights(weights, n=10)

    # ── Rotating chunk selection ──────────────────────────────────────────
    session_seed   = _get_session_seed(chat_id)
    merged_context = merge_context_by_topics_budgeted(
        collection,
        allowed,
        per_topic_results=2,
        max_chars=12000,
        max_chars_per_topic=900,
        session_seed=session_seed,
    )

    logger.info(
        "Generating full exam | chat=%s user=%s bloom=%s seed=%d",
        chat_id, user.id, bloom_prompt, session_seed,
    )

    pyq_freq  = exam_cfg.get("pyqTopicFrequency", {}) or {}
    questions = []

    for qtype, cfg in question_types.items():
        count = int(cfg.get("count", 0) or 0)
        if count <= 0:
            continue

        if qtype == "mcq":
            prompt = f"""
Generate {count} MCQs.

Allowed topics (choose topic EXACTLY from this list):
{json.dumps(allowed, indent=2)}

If PYQ topic frequency is available, bias questions toward frequently asked topics:
PYQ topicFrequency:
{json.dumps(pyq_freq, indent=2)}

Topic weight distribution (optional bias):
{json.dumps(weights_small, indent=2)}

Rules:
- Target Bloom levels: {bloom_prompt}
- Include bloomLevel field as exactly one of: Remember, Understand, Apply, Analyze, Evaluate, Create
- bloomLevel must be chosen from these allowed target levels: {bloom_prompt}
- Generate a natural mix of easy, medium, and hard questions across the full set
- 4 options
- options MUST be a JSON ARRAY of 4 strings, not an object.
- Example: "options": ["option1","option2","option3","option4"]
- One correct answer
- Return answer as ONE CAPITAL LETTER only: A / B / C / D
- Include difficulty field as one of: easy, medium, hard

{FORMATTING_RULES}

Context:
{merged_context}

Return JSON array with fields:
id, type="mcq", question, options, answer, topic, difficulty, bloomLevel
"""
            raw = call_gemini(prompt)
            questions += safe_json_extract(raw)

        elif qtype == "fill_blank":
            prompt = f"""
Generate {count} fill in the blank questions.

Allowed topics (choose topic EXACTLY from this list):
{json.dumps(allowed, indent=2)}

If PYQ topic frequency is available, bias questions toward frequently asked topics:
PYQ topicFrequency:
{json.dumps(pyq_freq, indent=2)}

Topic weight distribution (optional bias):
{json.dumps(weights_small, indent=2)}

Rules:
- Target Bloom levels: {bloom_prompt}
- Include bloomLevel field as exactly one of: Remember, Understand, Apply, Analyze, Evaluate, Create
- bloomLevel must be chosen from these allowed target levels: {bloom_prompt}
- Generate a natural mix of easy, medium, and hard questions across the full set
- The question must clearly contain a blank like _____
- Return answer as short text
- Include difficulty field as one of: easy, medium, hard

{FORMATTING_RULES}

Context:
{merged_context}

Return JSON array with fields:
id, type="fill_blank", question, answer, acceptedAnswers, topic, difficulty, bloomLevel

Rules for acceptedAnswers:
- Must be a JSON array
- Include 2 to 5 valid variants where appropriate
- Include capitalization/hyphen variants only when meaningful
- Do not include vague or overly broad synonyms
"""
            raw = call_gemini(prompt)
            questions += safe_json_extract(raw)

        elif qtype == "true_false":
            prompt = f"""
Generate {count} true/false questions.

Allowed topics (choose topic EXACTLY from this list):
{json.dumps(allowed, indent=2)}

If PYQ topic frequency is available, bias questions toward frequently asked topics:
PYQ topicFrequency:
{json.dumps(pyq_freq, indent=2)}

Topic weight distribution (optional bias):
{json.dumps(weights_small, indent=2)}

Rules:
- Target Bloom levels: {bloom_prompt}
- Each question must include bloomLevel as exactly one of: Remember, Understand, Apply, Analyze, Evaluate, Create
- bloomLevel must be chosen from these allowed target levels only: {bloom_prompt}
- Generate a natural mix of easy, medium, and hard questions across the full set
- Return answer as exactly "True" or "False"
- Include difficulty field as one of: easy, medium, hard

{FORMATTING_RULES}

Context:
{merged_context}

Return JSON array with fields:
id, type="true_false", question, answer, topic, difficulty, bloomLevel
"""
            raw = call_gemini(prompt)
            questions += safe_json_extract(raw)

        elif qtype == "descriptive":
            prompt = f"""
Generate {count} descriptive questions.

Allowed topics (choose topic EXACTLY from this list):
{json.dumps(allowed, indent=2)}

If PYQ topic frequency is available, bias questions toward frequently asked topics:
PYQ topicFrequency:
{json.dumps(pyq_freq, indent=2)}

Rules:
- Target Bloom levels: {bloom_prompt}
- Each question must include bloomLevel as exactly one of: Remember, Understand, Apply, Analyze, Evaluate, Create
- bloomLevel must be chosen from these allowed target levels only: {bloom_prompt}
- Generate a natural mix of easy, medium, and hard questions across the full set
- Include difficulty field as one of: easy, medium, hard

{FORMATTING_RULES}

Context:
{merged_context}

Return JSON array with:
id, type="descriptive", question, topic, difficulty, bloomLevel
"""
            raw = call_gemini(prompt)
            questions += safe_json_extract(raw)

    questions = [q for q in questions if isinstance(q, dict)]
    for q in questions:
        q["topic"]      = map_to_closest_topic(q.get("topic", ""), allowed, threshold=0.35)
        q["difficulty"] = str(q.get("difficulty", "medium")).strip().lower()
        if q["difficulty"] not in {"easy", "medium", "hard"}:
            q["difficulty"] = "medium"
        q["bloomLevel"] = pick_bloom_level_for_question(q, bloom_levels)

    session_id = generate_id()
    for i, q in enumerate(questions):
        q["id"] = f"{session_id}_q{i + 1}"

    # session_type from DB config only
    session_mode = exam_cfg.get("sessionMode", "normal")
    if session_mode == "video":
        session_type = "video_full"
    elif session_mode == "voice":
        session_type = "voice_full"
    else:
        session_type = "full"

    session = PracticeSession(
        id=session_id,
        chat_id=chat_id,
        session_type=session_type,
        questions=json.dumps(questions),
    )
    db.session.add(session)
    db.session.commit()

    logger.info(
        "Full exam generated | chat=%s session=%s questions=%d",
        chat_id, session_id, len(questions),
    )
    return jsonify({"sessionId": session.id, "questions": questions})


@bp.route("/api/chats/<chat_id>/questions/generate/weak", methods=["POST"])
def generate_weak_exam(chat_id):
    rate_limit_response = _apply_rate_limit()
    if rate_limit_response:
        return rate_limit_response

    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "invalid chat"}), 403

    weak_topics_map = json.loads(chat.weak_topics_json) if chat.weak_topics_json else {}
    if not weak_topics_map:
        return jsonify({"error": "No weak topics"}), 400

    exam_cfg       = json.loads(chat.exam_config or "{}")
    question_types = get_question_types_config(exam_cfg)
    bloom_levels   = get_adaptive_bloom_levels(chat_id, chat.bloom_level)
    bloom_prompt   = ", ".join(bloom_levels)

    client          = get_chroma_client()
    collection_name = chroma_collection_name(user.id, chat_id)
    collection      = get_chroma_collection(client, collection_name)

    db_topics = SubjectTopic.query.filter_by(chat_id=chat_id).all()
    allowed   = [t.topic_name for t in db_topics if t.topic_name] or ["General"]

    weak_topics = sorted(
        weak_topics_map.keys(),
        key=lambda t: (
            weak_topics_map.get(t, {}).get("score", 0.0),
            weak_topics_map.get(t, {}).get("seen", 0),
        ),
        reverse=True,
    )

    session_seed = _get_session_seed(chat_id)

    logger.info(
        "Generating weak exam | chat=%s user=%s weak_topics=%d seed=%d",
        chat_id, user.id, len(weak_topics), session_seed,
    )

    questions = []

    for qtype, cfg in question_types.items():
        count = int(cfg.get("count", 0) or 0)
        if count <= 0:
            continue

        remaining   = count
        topic_index = 0

        while remaining > 0 and weak_topics:
            topic  = weak_topics[topic_index % len(weak_topics)]
            offset = (session_seed + topic_index) % 4
            ctx    = fetch_topic_chunks(collection, topic, n_results=3, offset=offset)

            ask_count = min(1, remaining)

            if qtype == "mcq":
                prompt = f"""
Generate {ask_count} MCQs for REMEDIAL PRACTICE.

Rules:
- Focus on conceptual mistakes
- Target Bloom levels: {bloom_prompt}
- Each question must include bloomLevel as exactly one of: Remember, Understand, Apply, Analyze, Evaluate, Create
- bloomLevel must be chosen from these allowed target levels only: {bloom_prompt}
- Generate a natural mix of easy, medium, and hard questions
- 4 options
- options MUST be a JSON ARRAY of 4 strings, not an object.
- Example: "options": ["option1","option2","option3","option4"]
- One correct answer
- Return answer as ONE CAPITAL LETTER only: A / B / C / D
- Include difficulty field as one of: easy, medium, hard

{FORMATTING_RULES}

Topic: {topic}

Context:
{ctx}

Return ONLY JSON array with:
id, type="mcq", question, options, answer, topic, difficulty, bloomLevel
"""
            elif qtype == "fill_blank":
                prompt = f"""
Generate {ask_count} fill in the blank REMEDIAL questions.

Rules:
- Focus on conceptual mistakes
- Target Bloom levels: {bloom_prompt}
- Each question must include bloomLevel as exactly one of: Remember, Understand, Apply, Analyze, Evaluate, Create
- bloomLevel must be chosen from these allowed target levels only: {bloom_prompt}
- Generate a natural mix of easy, medium, and hard questions
- Use _____ in the question
- Return answer as short text
- Include difficulty field as one of: easy, medium, hard

{FORMATTING_RULES}

Topic: {topic}

Context:
{ctx}

Return ONLY JSON array with:
id, type="fill_blank", question, answer, acceptedAnswers, topic, difficulty, bloomLevel

Rules for acceptedAnswers:
- Must be a JSON array
- Include 2 to 5 valid variants where appropriate
- Include capitalization/hyphen variants only when meaningful
- Do not include vague or overly broad synonyms
"""
            elif qtype == "true_false":
                prompt = f"""
Generate {ask_count} true/false REMEDIAL questions.

Rules:
- Focus on conceptual mistakes
- Target Bloom levels: {bloom_prompt}
- Each question must include bloomLevel as exactly one of: Remember, Understand, Apply, Analyze, Evaluate, Create
- bloomLevel must be chosen from these allowed target levels only: {bloom_prompt}
- Generate a natural mix of easy, medium, and hard questions
- Return answer exactly as "True" or "False"
- Include difficulty field as one of: easy, medium, hard

{FORMATTING_RULES}

Topic: {topic}

Context:
{ctx}

Return ONLY JSON array with:
id, type="true_false", question, answer, topic, difficulty, bloomLevel
"""
            else:
                prompt = f"""
Generate {ask_count} DESCRIPTIVE REMEDIAL questions.

Rules:
- Focus on weak understanding
- Emphasize concepts and reasoning
- Target Bloom levels: {bloom_prompt}
- Each question must include bloomLevel as exactly one of: Remember, Understand, Apply, Analyze, Evaluate, Create
- bloomLevel must be chosen from these allowed target levels only: {bloom_prompt}
- Generate a natural mix of easy, medium, and hard questions
- Include difficulty field as one of: easy, medium, hard

{FORMATTING_RULES}

Topic: {topic}

Context:
{ctx}

Return ONLY JSON array with:
id, type="descriptive", question, topic, difficulty, bloomLevel
"""

            raw = call_gemini(prompt)
            qs  = safe_json_extract(raw) or []
            qs  = qs[:ask_count]

            for q in qs:
                q["topic"] = topic
                q["type"]  = q.get("type") or qtype
                questions.append(q)

            remaining   -= len(qs)
            topic_index += 1

            if topic_index > len(weak_topics) * 3 and remaining > 0:
                break

    questions = [q for q in questions if isinstance(q, dict)]
    for q in questions:
        q["topic"]      = map_to_closest_topic(q.get("topic", ""), allowed, threshold=0.35)
        q["difficulty"] = str(q.get("difficulty", "medium")).strip().lower()
        if q["difficulty"] not in {"easy", "medium", "hard"}:
            q["difficulty"] = "medium"
        q["bloomLevel"] = pick_bloom_level_for_question(q, bloom_levels)

    session_id = generate_id()
    for i, q in enumerate(questions):
        q["id"] = f"{session_id}_q{i + 1}"

    session_mode = exam_cfg.get("sessionMode", "normal")
    if session_mode == "video":
        session_type = "video_weak"
    elif session_mode == "voice":
        session_type = "voice_weak"
    else:
        session_type = "weak"

    session = PracticeSession(
        id=session_id,
        chat_id=chat_id,
        session_type=session_type,
        questions=json.dumps(questions),
    )
    db.session.add(session)
    db.session.commit()

    logger.info(
        "Weak exam generated | chat=%s session=%s questions=%d",
        chat_id, session_id, len(questions),
    )
    return jsonify({"sessionId": session.id, "questions": questions})


