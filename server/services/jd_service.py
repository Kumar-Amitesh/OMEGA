"""
services/jd_service.py

All JD-specific LLM logic.
Kept fully isolated from the existing exam-prep feature.
"""

import json
from llm import call_gemini
from logger import get_logger

logger = get_logger("jd_service")

# ── Constants ─────────────────────────────────────────────────────────────────
ALLOWED_JD_QUESTION_TYPES = {"behavioral", "technical", "situational", "role_specific"}
MAX_JD_QUESTIONS = 20
MIN_JD_QUESTIONS = 1


# ── JD Parsing ────────────────────────────────────────────────────────────────

def parse_jd_with_llm(text: str) -> dict:
    """
    Use LLM to extract structured info from raw JD text.
    Returns a dict with title, company, skills, responsibilities, etc.
    """
    prompt = f"""
You are analyzing a Job Description (JD) for interview preparation.

Extract structured information from the JD below.

Return ONLY valid JSON with this exact schema (no markdown, no preamble):
{{
  "title": "Job title e.g. Senior Backend Engineer",
  "company": "Company name or Unknown",
  "skills": ["skill1", "skill2"],
  "experience": "Experience requirement e.g. 3-5 years",
  "responsibilities": ["responsibility1", "responsibility2"],
  "requirements": ["requirement1", "requirement2"],
  "keywords": ["keyword1", "keyword2"],
  "domain": "Domain/industry e.g. FinTech, SaaS, E-commerce"
}}

Rules:
- skills: extract all technical and soft skills (max 20)
- responsibilities: key job duties (max 10, each under 15 words)
- requirements: must-have qualifications (max 10, each under 15 words)
- keywords: important terms for interview prep (max 15)
- If a field cannot be determined, use empty array [] or "Unknown"

JD Text:
{text[:8000]}
"""
    result = call_gemini(prompt, expect_json=True)

    if not isinstance(result, dict):
        logger.warning("[jd_service] parse_jd_with_llm: LLM returned non-dict, using fallback")
        return _empty_parsed_jd()

    # Sanitise lists
    for key in ("skills", "responsibilities", "requirements", "keywords"):
        val = result.get(key)
        if not isinstance(val, list):
            result[key] = []

    result.setdefault("title",      "Unknown")
    result.setdefault("company",    "Unknown")
    result.setdefault("experience", "Unknown")
    result.setdefault("domain",     "Unknown")

    return result


def _empty_parsed_jd() -> dict:
    return {
        "title": "Unknown", "company": "Unknown",
        "skills": [], "experience": "Unknown",
        "responsibilities": [], "requirements": [],
        "keywords": [], "domain": "Unknown",
    }


# ── Question Generation ───────────────────────────────────────────────────────

def generate_jd_questions(parsed_jd: dict, count: int, question_type: str) -> list:
    """
    Generate interview questions tailored to the parsed JD.

    question_type: behavioral | technical | situational | role_specific | mixed
    """
    if question_type not in ALLOWED_JD_QUESTION_TYPES and question_type != "mixed":
        question_type = "mixed"

    count = max(MIN_JD_QUESTIONS, min(MAX_JD_QUESTIONS, count))

    type_instruction = {
        "behavioral":   "Focus on past behaviour using STAR method prompts (Situation, Task, Action, Result).",
        "technical":    "Focus on technical skills, tools, and domain concepts listed in the JD.",
        "situational":  "Present hypothetical scenarios directly relevant to this role.",
        "role_specific":"Focus on the specific responsibilities and requirements of this exact role.",
        "mixed":        "Generate a balanced mix: ~30% behavioral, ~35% technical, ~20% situational, ~15% role-specific.",
    }.get(question_type, "Generate a balanced mix of question types.")

    prompt = f"""
You are an expert interview coach generating practice questions for a job candidate.

Job Details:
- Title: {parsed_jd.get('title', 'Unknown')}
- Company: {parsed_jd.get('company', 'Unknown')}
- Domain: {parsed_jd.get('domain', 'Unknown')}
- Experience Required: {parsed_jd.get('experience', 'Unknown')}
- Key Skills: {json.dumps(parsed_jd.get('skills', [])[:10])}
- Key Responsibilities: {json.dumps(parsed_jd.get('responsibilities', [])[:5])}
- Requirements: {json.dumps(parsed_jd.get('requirements', [])[:5])}
- Keywords: {json.dumps(parsed_jd.get('keywords', [])[:10])}

Question Type: {question_type}
Instruction: {type_instruction}
Number of questions to generate: {count}

Rules:
- Each question must be realistic and commonly asked for this exact role
- Questions must reference the JD's skills, responsibilities, or requirements
- No duplicate questions
- Return ONLY valid JSON (no markdown, no preamble)

Return format:
{{
  "questions": [
    {{
      "id": "jd_q1",
      "question": "Full question text",
      "category": "behavioral",
      "difficulty": "medium",
      "tip": "1–2 sentence hint on how to approach this answer",
      "skill_tested": "Name of skill or concept being tested"
    }}
  ]
}}

Valid values:
- category: behavioral | technical | situational | role_specific
- difficulty: easy | medium | hard
"""

    result = call_gemini(prompt, expect_json=True)
    if not isinstance(result, dict):
        logger.warning("[jd_service] generate_jd_questions: LLM returned non-dict")
        return []

    questions = result.get("questions") or []

    valid_categories   = {"behavioral", "technical", "situational", "role_specific"}
    valid_difficulties = {"easy", "medium", "hard"}
    clean = []

    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        question_text = str(q.get("question") or "").strip()
        if not question_text:
            continue

        category   = str(q.get("category")   or "role_specific").strip().lower()
        difficulty = str(q.get("difficulty") or "medium").strip().lower()

        clean.append({
            "id":          q.get("id") or f"jd_q{i + 1}",
            "question":    question_text,
            "category":    category   if category   in valid_categories   else "role_specific",
            "difficulty":  difficulty if difficulty in valid_difficulties else "medium",
            "tip":         str(q.get("tip")          or "").strip(),
            "skill_tested":str(q.get("skill_tested") or "").strip(),
        })

    return clean


# ── JD Validation ─────────────────────────────────────────────────────────────

def classify_text_as_jd(text: str) -> bool:
    """
    Ask LLM whether the uploaded text is actually a Job Description.
    Returns True if yes, False otherwise.
    """
    prompt = f"""Is the following text a Job Description (JD) or job posting?

Answer with ONLY one word: yes or no

Text:
{text[:3000]}
"""
    result = call_gemini(prompt)
    answer = str(result or "").strip().lower()
    return answer.startswith("yes")


# ── Answer Evaluation ─────────────────────────────────────────────────────────

def evaluate_jd_answers(questions: list, answers: dict) -> dict:
    """
    Evaluate a set of text/voice answers against their JD interview questions.

    Returns a dict keyed by question id:
    {
      qid: {
        "type": "jd_interview",
        "overallScore": 7.5,
        "contentScore": 8.0,
        "structureScore": 7.0,
        "strengths": [...],
        "improvements": [...],
        "sampleAnswer": "...",
        "explanation": "...",
        "userAnswer": "...",
        "awardedMarks": 7.5,
        "maxMarks": 10,
      }
    }
    """
    if not questions or not answers:
        return {}

    # Build a compact representation for the prompt
    qa_pairs = []
    for q in questions:
        qid    = q.get("id") or ""
        answer = str(answers.get(qid) or "").strip()
        qa_pairs.append({
            "id":       qid,
            "question": q.get("question", ""),
            "category": q.get("category", ""),
            "answer":   answer or "[No answer provided]",
        })

    prompt = f"""
You are an expert interview coach evaluating candidate answers to job interview questions.

Evaluate each answer and return ONLY valid JSON (no markdown, no preamble).

Questions and Answers:
{json.dumps(qa_pairs, indent=2)}

For each answer return an object keyed by the question id.
Use this exact schema per question:
{{
  "<qid>": {{
    "overallScore": 7.5,
    "contentScore": 8.0,
    "structureScore": 7.0,
    "strengths": ["strength 1", "strength 2"],
    "improvements": ["area 1", "area 2"],
    "sampleAnswer": "3–5 sentence ideal answer",
    "explanation": "1–2 sentence overall comment"
  }}
}}

Scoring rules (0–10 each):
- overallScore:   weighted average (content 50% + structure 30% + communication 20%)
- contentScore:   relevance, depth, use of examples, specificity
- structureScore: clear opening, logical flow, strong conclusion (STAR format for behavioral)
- 0 = no answer / completely irrelevant
- 10 = outstanding, exceeds expectations

Return a single JSON object containing all question ids as keys.
"""

    result = call_gemini(prompt, expect_json=True)
    if not isinstance(result, dict):
        logger.warning("[jd_service] evaluate_jd_answers: LLM returned non-dict")
        return {}

    # Normalise and clamp scores
    def clamp(v):
        try:
            return round(max(0.0, min(10.0, float(v))), 1)
        except Exception:
            return 0.0

    out = {}
    for q in questions:
        qid     = q.get("id") or ""
        raw     = result.get(qid) or {}
        answer  = str(answers.get(qid) or "").strip()

        if not isinstance(raw, dict):
            raw = {}

        overall  = clamp(raw.get("overallScore",   0))
        content  = clamp(raw.get("contentScore",   0))
        struct   = clamp(raw.get("structureScore", 0))

        out[qid] = {
            "type":           "jd_interview",
            "topic":          q.get("category", "General"),
            "question":       q.get("question", ""),
            "userAnswer":     answer,
            "overallScore":   overall,
            "contentScore":   content,
            "structureScore": struct,
            "understandingScore": overall,      # for compatibility with SessionReview
            "strengths":      raw.get("strengths",    []) if isinstance(raw.get("strengths"),    list) else [],
            "improvements":   raw.get("improvements", []) if isinstance(raw.get("improvements"), list) else [],
            "sampleAnswer":   str(raw.get("sampleAnswer", "") or "").strip(),
            "explanation":    str(raw.get("explanation",  "") or "").strip(),
            "isCorrect":      None,
            "correctAnswer":  None,
            "awardedMarks":   overall,
            "maxMarks":       10,
            "bloomLevel":     "Apply",
            "difficulty":     q.get("difficulty", "medium"),
            "skipped":        not bool(answer),
        }

    return out

