"""
routes/flashcard_routes.py

Security hardened:
- mode is validated server-side (full | weak | topic only)
- count is capped server-side (max 30)
- topic is validated to belong to this chat's own topics
"""

import json
from flask import Blueprint, request, jsonify
from models import Chat, SubjectTopic, PracticeSession
from services.auth_service import get_user_from_token
from services.chroma_service import (
    get_chroma_client,
    chroma_collection_name,
    get_chroma_collection,
    merge_context_by_topics_budgeted,
    fetch_topic_chunks,
)
from services.topic_service import get_allowed_topics_for_chat, map_to_closest_topic
from services.validation_service import validate_flashcard_request
from llm import call_gemini

bp = Blueprint("flashcard_routes", __name__)


def _build_flashcard_prompt(context: str, topics: list, count: int, focus_label: str) -> str:
    return f"""
You are generating flashcards for exam revision.

Focus: {focus_label}
Topics available: {json.dumps(topics[:15])}
Number of cards to generate: {count}

Rules:
- Each card must have a clear, specific question on the front.
- The back must be a concise but complete answer (2-5 sentences max).
- mnemonicHint: a short memory trick or analogy. Keep it under 15 words. Omit if none is natural.
- relatedConcepts: 2-4 closely related topic keywords (short strings, not sentences).
- difficulty: one of easy / medium / hard
- bloomLevel: one of Remember / Understand / Apply / Analyze / Evaluate / Create
- topic: pick from the topics list above (exact string)
- Vary difficulty — aim for roughly 30% easy, 50% medium, 20% hard.
- Do NOT generate duplicate questions.
- Return ONLY a JSON object — no markdown, no explanation.

Return format:
{{
  "flashcards": [
    {{
      "id": "fc_1",
      "front": "Question text",
      "back": "Answer text",
      "topic": "Topic name",
      "difficulty": "medium",
      "bloomLevel": "Understand",
      "mnemonicHint": "short mnemonic or empty string",
      "relatedConcepts": ["concept1", "concept2"]
    }}
  ]
}}

Study context:
{context}
"""


@bp.route("/api/chats/<chat_id>/flashcards/generate", methods=["POST"])
def generate_flashcards(chat_id):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    chat = Chat.query.get(chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "invalid chat"}), 403

    allowed_topics = get_allowed_topics_for_chat(chat_id)
    if not allowed_topics:
        return jsonify({"error": "No topics found. Upload and process a PDF first."}), 400

    # ── Validate and sanitize request server-side ─────────────────────────
    raw_data = request.json or {}
    sanitized, error = validate_flashcard_request(raw_data, allowed_topics)
    if error:
        return jsonify({"error": error}), 400

    mode = sanitized["mode"]
    count = sanitized["count"]
    topic_hint = sanitized["topic"]

    client          = get_chroma_client()
    collection_name = chroma_collection_name(user.id, chat_id)
    collection      = get_chroma_collection(client, collection_name)

    # ── Session seed for chunk rotation — gives different flashcards each time ─
    # Combines session count + mode/count/topic so each generation request
    # gets a different offset into the vector store, avoiding repeated content.
    flashcard_seed = PracticeSession.query.filter_by(chat_id=chat_id).count()
    flashcard_seed = abs(flashcard_seed + hash(f"{mode}_{count}_{topic_hint}") % 100)

    # ── Build context based on mode ──────────────────────────────────────
    if mode == "topic" and topic_hint:
        # Re-validate topic belongs to this chat using embedding match
        matched_topic = map_to_closest_topic(topic_hint, allowed_topics, threshold=0.35)
        context     = fetch_topic_chunks(collection, matched_topic, n_results=6,
                                         offset=(flashcard_seed % 4))
        focus_label = f"Deep dive on: {matched_topic}"
        topics_used = [matched_topic]

    elif mode == "weak":
        weak_map    = json.loads(chat.weak_topics_json) if chat.weak_topics_json else {}
        if not weak_map:
            return jsonify({"error": "No weak topics yet. Complete a practice session first."}), 400

        weak_sorted = sorted(
            [(t, v.get("score", 0) if isinstance(v, dict) else 0) for t, v in weak_map.items()],
            key=lambda x: x[1], reverse=True
        )
        topics_used = [t for t, _ in weak_sorted[:6]]
        context     = merge_context_by_topics_budgeted(
            collection, topics_used,
            per_topic_results=2, max_chars=10000, max_chars_per_topic=1200,
            session_seed=flashcard_seed,
        )
        focus_label = f"Weak topic remediation: {', '.join(topics_used[:4])}"

    else:  # full
        topics_used = allowed_topics[:10]
        context     = merge_context_by_topics_budgeted(
            collection, topics_used,
            per_topic_results=2, max_chars=10000, max_chars_per_topic=800,
            session_seed=flashcard_seed,
        )
        focus_label = "Full syllabus coverage"

    if not context:
        return jsonify({"error": "No content found in vector store. Make sure PDFs are processed."}), 400

    prompt = _build_flashcard_prompt(context, topics_used, count, focus_label)
    result = call_gemini(prompt, expect_json=True)

    if not result or not isinstance(result, dict):
        return jsonify({"error": "Flashcard generation failed. Please try again."}), 500

    flashcards = result.get("flashcards") or []
    if not flashcards:
        return jsonify({"error": "No flashcards were generated."}), 500

    valid_difficulties = {"easy", "medium", "hard"}
    valid_blooms       = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"}

    clean = []
    for i, fc in enumerate(flashcards):
        if not isinstance(fc, dict):
            continue
        front = str(fc.get("front") or "").strip()
        back  = str(fc.get("back")  or "").strip()
        if not front or not back:
            continue

        diff  = str(fc.get("difficulty", "medium")).strip().lower()
        bloom = str(fc.get("bloomLevel", "Understand")).strip().title()

        clean.append({
            "id":              fc.get("id") or f"fc_{i+1}",
            "front":           front,
            "back":            back,
            "topic":           str(fc.get("topic") or (topics_used[0] if topics_used else "General")).strip(),
            "difficulty":      diff if diff in valid_difficulties else "medium",
            "bloomLevel":      bloom if bloom in valid_blooms else "Understand",
            "mnemonicHint":    str(fc.get("mnemonicHint") or "").strip(),
            "relatedConcepts": [str(c).strip() for c in (fc.get("relatedConcepts") or []) if c][:4],
        })

    if not clean:
        return jsonify({"error": "All generated flashcards were malformed."}), 500

    return jsonify({
        "flashcards": clean,
        "count":      len(clean),
        "mode":       mode,
        "topics":     topics_used,
    })