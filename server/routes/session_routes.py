"""
routes/session_routes.py

Changes from original:
1. Fill-blank LLM equivalence check is now BATCHED with the explanation call
   instead of firing one extra LLM call per question.  Saves N calls where N
   is the number of fill-blank questions that failed the fast token-match.

2. normalized_score is clamped to 0.0 minimum so heavy negative-marking never
   produces a negative session score that breaks the trend chart.

3. Everything else is unchanged.
"""

import json
from flask import Blueprint, request, jsonify
from models import PracticeSession, Chat, SubjectTopic
from extensions import db
from services.auth_service import get_user_from_token
from services.exam_service import get_question_types_config, default_question_type_config
from services.topic_service import map_to_closest_topic
from services.evaluation_service import (
    compare_objective_answer,
    update_topic_weakness,
    top_weak_topics,
    is_fill_blank_match,          # fast token-match check
    normalize_text_answer,
)
from services.cache_service import invalidate_chat
from services.chroma_service import (
    get_chroma_client,
    chroma_collection_name,
    get_chroma_collection,
    fetch_context_with_sources_for_question,
)
from llm import call_gemini
from services.misconception_service import record_wrong_answer, invalidate_misconception_cache

bp = Blueprint("session_routes", __name__)


@bp.route("/api/sessions/<sid>/submit", methods=["POST"])
def submit_answers(sid):
    user = get_user_from_token()
    if not user:
        return jsonify({"error": "unauthorized"}), 401

    session = PracticeSession.query.get(sid)
    if not session:
        return jsonify({"error": "invalid session"}), 404

    chat = Chat.query.get(session.chat_id)
    if not chat or chat.user_id != user.id:
        return jsonify({"error": "unauthorized"}), 403

    data    = request.json or {}
    answers = data.get("answers", {})

    questions = json.loads(session.questions or "[]")

    db_topics = SubjectTopic.query.filter_by(chat_id=chat.id).all()
    allowed   = [t.topic_name for t in db_topics if t.topic_name] or ["General"]

    for q in questions:
        q["topic"] = map_to_closest_topic(q.get("topic", ""), allowed, threshold=0.35)

    exam_cfg           = json.loads(chat.exam_config or "{}")
    question_types_cfg = get_question_types_config(exam_cfg)

    chroma_client   = get_chroma_client()
    collection_name = chroma_collection_name(user.id, chat.id)
    collection      = get_chroma_collection(chroma_client, collection_name)

    results      = {}
    weak_topics  = []
    topic_events = []

    total_possible_marks = 0.0
    total_awarded_marks  = 0.0

    # ── Payloads for the single batched LLM call ──────────────────────────
    # mcq_payload: questions that need explanations (all objective Qs)
    # fill_blank_pending_llm: fill-blank Qs that failed the fast match and
    #                         need the LLM to decide correct/wrong
    mcq_payload_for_explanations = []
    fill_blank_pending_llm: list[dict] = []   # {qid, user_ans, correct_ans, accepted}

    # ══════════════════════════════════════════════════════════════════════
    # Pass 1 — Objective questions (fast path, no LLM needed yet)
    # ══════════════════════════════════════════════════════════════════════

    for q in questions:
        qid   = q.get("id")
        qtype = q.get("type")
        qcfg  = question_types_cfg.get(qtype, default_question_type_config(qtype))

        max_marks      = float(qcfg.get("marks", 0) or 0)
        negative_marks = float(qcfg.get("negativeMarks", 0) or 0)

        total_possible_marks += max_marks

        user_ans = answers.get(qid)
        if user_ans in [None, ""]:
            continue

        if qtype == "mcq":
            correct    = q.get("answer")
            is_correct = compare_objective_answer(user_ans, correct, qtype="mcq")
            topic_name = map_to_closest_topic(q.get("topic", "General"), allowed)

            awarded_marks = max_marks if is_correct else (-negative_marks if negative_marks > 0 else 0.0)
            total_awarded_marks += awarded_marks

            topic_events.append({
                "topic":         topic_name,
                "correct":       is_correct,
                "difficulty":    q.get("difficulty", "medium"),
                "score_ratio":   1.0 if is_correct else 0.0,
                "question_type": "mcq",
                "bloom_level":   q.get("bloomLevel", "Understand"),
            })

            results[qid] = {
                "type":               "mcq",
                "topic":              topic_name,
                "question":           q.get("question"),
                "userAnswer":         user_ans,
                "correctAnswer":      correct,
                "isCorrect":          is_correct,
                "understandingScore": 10 if is_correct else 0,
                "awardedMarks":       awarded_marks,
                "maxMarks":           max_marks,
                "negativeMarks":      negative_marks,
                "difficulty":         q.get("difficulty"),
                "explanation":        "",
                "bloomLevel":         q.get("bloomLevel", "Understand"),
                "sources":            [],
            }

            if not is_correct:
                weak_topics.append(topic_name)
                record_wrong_answer(
                    chat_id=chat.id, session_id=sid, topic=topic_name,
                    bloom_level=q.get("bloomLevel", "Understand"),
                    difficulty=q.get("difficulty", "medium"),
                    question=q, user_answer=user_ans,
                )

            mcq_payload_for_explanations.append({
                "id":            qid,
                "question":      q.get("question"),
                "options":       q.get("options", []),
                "correctAnswer": correct,
                "userAnswer":    user_ans,
                "type":          "mcq",
            })

        elif qtype == "true_false":
            correct    = q.get("answer")
            is_correct = compare_objective_answer(user_ans, correct, qtype="true_false")
            topic_name = map_to_closest_topic(q.get("topic", "General"), allowed)

            awarded_marks = max_marks if is_correct else (-negative_marks if negative_marks > 0 else 0.0)
            total_awarded_marks += awarded_marks

            topic_events.append({
                "topic":         topic_name,
                "correct":       is_correct,
                "difficulty":    q.get("difficulty", "medium"),
                "score_ratio":   1.0 if is_correct else 0.0,
                "question_type": "true_false",
                "bloom_level":   q.get("bloomLevel", "Understand"),
            })

            results[qid] = {
                "type":               "true_false",
                "topic":              topic_name,
                "question":           q.get("question"),
                "userAnswer":         user_ans,
                "correctAnswer":      correct,
                "isCorrect":          is_correct,
                "understandingScore": 10 if is_correct else 0,
                "awardedMarks":       awarded_marks,
                "maxMarks":           max_marks,
                "negativeMarks":      negative_marks,
                "difficulty":         q.get("difficulty"),
                "explanation":        "",
                "bloomLevel":         q.get("bloomLevel", "Understand"),
                "sources":            [],
            }

            if not is_correct:
                weak_topics.append(topic_name)
                record_wrong_answer(
                    chat_id=chat.id, session_id=sid, topic=topic_name,
                    bloom_level=q.get("bloomLevel", "Understand"),
                    difficulty=q.get("difficulty", "medium"),
                    question=q, user_answer=user_ans,
                )

            mcq_payload_for_explanations.append({
                "id":            qid,
                "question":      q.get("question"),
                "correctAnswer": correct,
                "userAnswer":    user_ans,
                "type":          "true_false",
            })

        elif qtype == "fill_blank":
            if not isinstance(q.get("acceptedAnswers"), list):
                q["acceptedAnswers"] = [q.get("answer", "")]

            correct  = q.get("answer")
            accepted = q.get("acceptedAnswers") or [correct]

            # Fast token match first
            fast_match = is_fill_blank_match(user_ans, accepted)
            topic_name = map_to_closest_topic(q.get("topic", "General"), allowed)

            if fast_match:
                # No LLM call needed — mark correct immediately
                is_correct    = True
                awarded_marks = max_marks
                total_awarded_marks += awarded_marks

                topic_events.append({
                    "topic":         topic_name,
                    "correct":       True,
                    "difficulty":    q.get("difficulty", "medium"),
                    "score_ratio":   1.0,
                    "question_type": "fill_blank",
                    "bloom_level":   q.get("bloomLevel", "Understand"),
                })

                results[qid] = {
                    "type":               "fill_blank",
                    "topic":              topic_name,
                    "question":           q.get("question"),
                    "userAnswer":         user_ans,
                    "correctAnswer":      correct,
                    "isCorrect":          True,
                    "understandingScore": 10,
                    "awardedMarks":       awarded_marks,
                    "maxMarks":           max_marks,
                    "negativeMarks":      negative_marks,
                    "difficulty":         q.get("difficulty"),
                    "explanation":        "",
                    "bloomLevel":         q.get("bloomLevel", "Understand"),
                    "sources":            [],
                }
            else:
                # Needs LLM — defer to the batch call below
                fill_blank_pending_llm.append({
                    "qid":           qid,
                    "user_ans":      user_ans,
                    "correct":       correct,
                    "accepted":      accepted,
                    "topic_name":    topic_name,
                    "max_marks":     max_marks,
                    "negative_marks":negative_marks,
                    "difficulty":    q.get("difficulty"),
                    "bloom_level":   q.get("bloomLevel", "Understand"),
                    "question_text": q.get("question"),
                })

            # Always add to explanation payload
            mcq_payload_for_explanations.append({
                "id":            qid,
                "question":      q.get("question"),
                "correctAnswer": correct,
                "userAnswer":    user_ans,
                "type":          "fill_blank",
            })

    # ══════════════════════════════════════════════════════════════════════
    # Pass 2 — Batch LLM call for:
    #   a) Fill-blank equivalence checks that failed the fast path
    #   b) Explanations for all objective questions
    # Both are combined into ONE prompt to save API calls.
    # ══════════════════════════════════════════════════════════════════════

    if fill_blank_pending_llm or mcq_payload_for_explanations:
        # Build the combined prompt
        fill_blank_section = ""
        if fill_blank_pending_llm:
            fb_items = [
                {
                    "id":       item["qid"],
                    "question": item["question_text"],
                    "accepted": item["accepted"],
                    "student":  item["user_ans"],
                }
                for item in fill_blank_pending_llm
            ]
            fill_blank_section = f"""
PART A — Fill-Blank Equivalence
For each item, decide whether the student's answer is semantically equivalent
to one of the accepted answers.  Be strict: accept only clear equivalents
(different phrasing / capitalisation / hyphenation / plural form).
Return a JSON object keyed by "fillblank_<id>" → {{"isCorrect": true/false}}.

{json.dumps(fb_items, indent=2)}
"""

        exp_section = ""
        if mcq_payload_for_explanations:
            exp_section = f"""
PART B — Explanations
For each item, write a short student-friendly explanation (1-2 sentences).
Return a JSON object keyed by the question id → {{"explanation": "..."}}.

{json.dumps(mcq_payload_for_explanations, indent=2)}
"""

        combined_prompt = f"""
You are an exam grading assistant.  Complete BOTH parts below and return a
SINGLE JSON object with two top-level keys: "fillblank" and "explanations".

{fill_blank_section}

{exp_section}

Return format (include only keys that are relevant):
{{
  "fillblank":    {{ "fillblank_<id>": {{"isCorrect": true}} }},
  "explanations": {{ "<question_id>": {{"explanation": "..."}} }}
}}

Return ONLY valid JSON, no markdown.
"""
        combined_result = call_gemini(combined_prompt, expect_json=True) or {}

        fb_result  = combined_result.get("fillblank", {}) or {}
        exp_result = combined_result.get("explanations", {}) or {}

        # ── Resolve fill-blank pending items ──────────────────────────────
        for item in fill_blank_pending_llm:
            qid         = item["qid"]
            llm_key     = f"fillblank_{qid}"
            is_correct  = bool((fb_result.get(llm_key) or {}).get("isCorrect", False))

            max_marks      = item["max_marks"]
            negative_marks = item["negative_marks"]
            topic_name     = item["topic_name"]

            awarded_marks = max_marks if is_correct else (
                -negative_marks if negative_marks > 0 else 0.0
            )
            total_awarded_marks += awarded_marks

            topic_events.append({
                "topic":         topic_name,
                "correct":       is_correct,
                "difficulty":    item["difficulty"],
                "score_ratio":   1.0 if is_correct else 0.0,
                "question_type": "fill_blank",
                "bloom_level":   item["bloom_level"],
            })

            results[qid] = {
                "type":               "fill_blank",
                "topic":              topic_name,
                "question":           item["question_text"],
                "userAnswer":         item["user_ans"],
                "correctAnswer":      item["correct"],
                "isCorrect":          is_correct,
                "understandingScore": 10 if is_correct else 0,
                "awardedMarks":       awarded_marks,
                "maxMarks":           max_marks,
                "negativeMarks":      negative_marks,
                "difficulty":         item["difficulty"],
                "explanation":        "",
                "bloomLevel":         item["bloom_level"],
                "sources":            [],
            }

            if not is_correct:
                weak_topics.append(topic_name)
                # record_wrong_answer needs the original question dict — build minimal one
                record_wrong_answer(
                    chat_id=chat.id, session_id=sid, topic=topic_name,
                    bloom_level=item["bloom_level"],
                    difficulty=item["difficulty"],
                    question={
                        "type":    "fill_blank",
                        "answer":  item["correct"],
                        "question":item["question_text"],
                    },
                    user_answer=item["user_ans"],
                )

        # ── Attach explanations to objective results ───────────────────────
        for item in mcq_payload_for_explanations:
            qid = item["id"]
            if qid in results:
                results[qid]["explanation"] = (
                    (exp_result.get(qid) or {}).get("explanation", "")
                )

    # ══════════════════════════════════════════════════════════════════════
    # Pass 3 — Descriptive questions (with Chroma source context)
    # ══════════════════════════════════════════════════════════════════════

    desc_payload = []
    desc_sources: dict = {}

    for q in questions:
        qid      = q.get("id")
        user_ans = answers.get(qid)
        if not user_ans or q.get("type") != "descriptive":
            continue

        qcfg = question_types_cfg.get("descriptive", default_question_type_config("descriptive"))

        topic      = q.get("topic", "General")
        ctx_result = fetch_context_with_sources_for_question(
            collection,
            question=q.get("question", ""),
            topic=topic,
            n_results=4,
        )
        source_context     = ctx_result["context"]
        desc_sources[qid]  = ctx_result["sources"]

        desc_payload.append({
            "id":            qid,
            "question":      q.get("question"),
            "answer":        user_ans,
            "topic":         topic,
            "difficulty":    q.get("difficulty"),
            "bloomLevel":    q.get("bloomLevel", "Understand"),
            "marks":         float(qcfg.get("marks", 0) or 0),
            "negativeMarks": float(qcfg.get("negativeMarks", 0) or 0),
            "sourceContext": source_context,
        })

    if desc_payload:
        desc_prompt = f"""
Evaluate student understanding for descriptive answers.

IMPORTANT: Use the provided "sourceContext" for each question as the ground
truth from the student's own study material. Evaluate how well the answer
aligns with that context, not just general knowledge.

Rules:
- Focus on conceptual correctness against the source context
- Ignore grammar mistakes
- Do NOT grade like a formal exam
- understandingScore must be between 0 and 10
- Return ONLY a JSON object keyed by the SAME question id

{{
  "<question_id>": {{
    "understandingScore": 0-10,
    "coveredConcepts": [],
    "missingConcepts": [],
    "sampleAnswer": "A good answer would mention...",
    "explanation": "Explain what was right/wrong and how to improve."
  }}
}}

Data:
{json.dumps(desc_payload, indent=2)}
"""
        desc_result = call_gemini(desc_prompt, expect_json=True) or {}

        for item in desc_payload:
            qid   = item["id"]
            r     = desc_result.get(qid, {}) or {}
            score = float(r.get("understandingScore", 0) or 0)

            topic_name  = map_to_closest_topic(item.get("topic", "General"), allowed)
            score_ratio = max(0.0, min(1.0, score / 10.0))

            topic_events.append({
                "topic":         topic_name,
                "correct":       (score >= 6),
                "difficulty":    item.get("difficulty", "medium"),
                "score_ratio":   score_ratio,
                "question_type": "descriptive",
                "bloom_level":   item.get("bloomLevel", "Understand"),
            })

            max_marks     = float(item.get("marks", 0) or 0)
            awarded_marks = round((score / 10.0) * max_marks, 2)
            total_awarded_marks += awarded_marks

            results[qid] = {
                "type":               "descriptive",
                "topic":              topic_name,
                "question":           item.get("question"),
                "userAnswer":         item.get("answer"),
                "correctAnswer":      None,
                "isCorrect":          None,
                "understandingScore": score,
                "covered":            r.get("coveredConcepts", []),
                "missing":            r.get("missingConcepts", []),
                "sampleAnswer":       r.get("sampleAnswer", ""),
                "explanation":        r.get("explanation", ""),
                "awardedMarks":       awarded_marks,
                "maxMarks":           max_marks,
                "negativeMarks":      0.0,
                "difficulty":         item.get("difficulty"),
                "bloomLevel":         item.get("bloomLevel", "Understand"),
                "sources":            desc_sources.get(qid, []),
            }

            if score < 6:
                weak_topics.append(topic_name)

    # ── Scoring ───────────────────────────────────────────────────────────
    # FIX: clamp to 0 so negative marking never produces a negative session
    # score that breaks trend charts.
    normalized_score = 0.0
    if total_possible_marks > 0:
        raw_ratio        = total_awarded_marks / total_possible_marks
        normalized_score = round(max(0.0, raw_ratio * 10.0), 2)

    session.score            = normalized_score
    session.answers          = json.dumps(answers)
    session.weak_topics_json = json.dumps(weak_topics)
    session.feedback_json    = json.dumps(results)

    existing = json.loads(chat.weak_topics_json) if chat.weak_topics_json else {}
    updated  = update_topic_weakness(existing, topic_events, alpha=0.25)
    chat.weak_topics_json = json.dumps(updated)

    db.session.commit()
    invalidate_chat(chat.id, user.id)
    invalidate_misconception_cache(chat.id)

    return jsonify({
        "score":         normalized_score,
        "rawMarks":      round(total_awarded_marks, 2),
        "totalMarks":    round(total_possible_marks, 2),
        "results":       results,
        "weakTopics":    updated,
        "weakTopicList": top_weak_topics(updated, k=5),
    })



