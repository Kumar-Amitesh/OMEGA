import json
from llm import call_gemini
from utils.json_utils import safe_json_extract


def detect_pdf_type_llm(text):
    prompt = f"""
Classify this document strictly into one category:
- syllabus
- notes
- question_paper

Return ONLY one word.

{text[:6000]}
"""
    result = call_gemini(prompt).lower()

    if "syllabus" in result:
        return "syllabus"
    if "question" in result:
        return "question_paper"
    return "notes"


def distribute_questions(weights, total_q):
    if not weights:
        return {"General": total_q}

    allocation = {}

    for t, w in weights.items():
        allocation[t] = max(1, round(w * total_q))

    while sum(allocation.values()) > total_q:
        allocation[max(allocation, key=allocation.get)] -= 1

    while sum(allocation.values()) < total_q:
        allocation[max(weights, key=weights.get)] += 1

    return allocation


def generate_without_pdfs(chat, user):
    exam_cfg = json.loads(chat.exam_config)
    bloom = chat.bloom_level or "understand"

    prompt = f"""
Generate exam questions using standard syllabus knowledge.

Exam Type: {chat.exam_type}
Bloom Level: {bloom}
Config: {json.dumps(exam_cfg)}

Return JSON array:
[
 {{
  "id":"q1",
  "type":"mcq|descriptive",
  "question":"...",
  "options":[],
  "answer":""
 }}
]
"""

    raw = call_gemini(prompt)
    return safe_json_extract(raw)


def normalize_exam_pattern(exam_pattern: dict) -> dict:
    default_qtypes = {
        "mcq": {"count": 0, "marks": 0, "negativeMarks": 0},
        "fill_blank": {"count": 0, "marks": 0, "negativeMarks": 0},
        "true_false": {"count": 0, "marks": 0, "negativeMarks": 0},
        "descriptive": {"count": 0, "marks": 0, "negativeMarks": 0},
    }

    if not isinstance(exam_pattern, dict):
        return {"questionTypes": default_qtypes}

    if isinstance(exam_pattern.get("questionTypes"), dict):
        raw = exam_pattern.get("questionTypes") or {}
        normalized = {}

        for qtype, base in default_qtypes.items():
            cfg = raw.get(qtype) or {}
            normalized[qtype] = {
                "count": int(cfg.get("count", base["count"]) or 0),
                "marks": float(cfg.get("marks", base["marks"]) or 0),
                "negativeMarks": 0.0 if qtype == "descriptive" else float(cfg.get("negativeMarks", 0) or 0),
            }

        return {"questionTypes": normalized}

    normalized = dict(default_qtypes)

    old_mcq = exam_pattern.get("mcq") or {}
    old_desc = exam_pattern.get("descriptive") or {}

    normalized["mcq"] = {
        "count": int(old_mcq.get("count", 0) or 0),
        "marks": float(old_mcq.get("marks", 0) or 0),
        "negativeMarks": float(old_mcq.get("negativeMarks", 0) or 0),
    }

    normalized["descriptive"] = {
        "count": int(old_desc.get("count", 0) or 0),
        "marks": float(old_desc.get("marks", 0) or 0),
        "negativeMarks": 0.0,
    }

    return {"questionTypes": normalized}


def analyze_pdf_intelligence(text):
    prompt = f"""
You are analyzing ONE academic PDF for an exam prep app.

Goals:
1) Classify the PDF type strictly: syllabus | notes | question_paper
2) Detect the SUBJECT name (example: "Operating Systems", "DBMS", "CN", etc.)
3) Extract a clean topic list that can be used for practice generation.
4) If the PDF is a question paper, infer the exam pattern using the generic question type schema.

Rules:
- Return ONLY JSON.
- topics must be practical exam topics, not generic words like "General".
- Keep topics <= 12 items.
- unit can be "Unit 1", "Module 2", "Chapter 3", etc. If unknown use "Unit".
- If it is a question_paper, also infer which topics appear frequently (topicFrequency).
- topicFrequency should be a dict: {{"Topic": countEstimate}} (rough estimate is ok).
- examPattern must support all question types:
  - mcq
  - fill_blank
  - true_false
  - descriptive
- If a type does not appear, set its count and marks to 0.
- negativeMarks should default to 0.

Return JSON schema:
{{
  "type": "syllabus|notes|question_paper",
  "subject": "Subject Name or Unknown",
  "topics": [{{"unit":"Unit/Module","topic":"Topic"}}],
  "topicFrequency": {{"Topic": 0}},
  "examPattern": {{
    "questionTypes": {{
      "mcq": {{"count": 0, "marks": 0, "negativeMarks": 0}},
      "fill_blank": {{"count": 0, "marks": 0, "negativeMarks": 0}},
      "true_false": {{"count": 0, "marks": 0, "negativeMarks": 0}},
      "descriptive": {{"count": 0, "marks": 0, "negativeMarks": 0}}
    }}
  }}
}}

Important:
- Infer counts and per-question marks as best as possible from the paper.
- If the paper mixes sections, combine totals by question type.
- Do not omit any supported question type keys.

PDF Text (partial):
{text[:12000]}
"""
    parsed = call_gemini(prompt, expect_json=True)

    if not parsed:
        return {
            "type": "notes",
            "subject": "Unknown",
            "topics": [{"unit": "Unit", "topic": "General"}],
            "topicFrequency": {},
            "examPattern": {
                "questionTypes": {
                    "mcq": {"count": 0, "marks": 0, "negativeMarks": 0},
                    "fill_blank": {"count": 0, "marks": 0, "negativeMarks": 0},
                    "true_false": {"count": 0, "marks": 0, "negativeMarks": 0},
                    "descriptive": {"count": 0, "marks": 0, "negativeMarks": 0},
                }
            }
        }

    parsed.setdefault("subject", "Unknown")
    parsed.setdefault("topics", [{"unit": "Unit", "topic": "General"}])
    parsed.setdefault("topicFrequency", {})
    parsed.setdefault("examPattern", {})

    if not parsed["topics"]:
        parsed["topics"] = [{"unit": "Unit", "topic": "General"}]

    parsed["examPattern"] = normalize_exam_pattern(parsed.get("examPattern") or {})

    return parsed


def parse_bloom_levels(raw):
    if not raw:
        return ["Understand"]

    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]

    s = str(raw).strip()
    if not s:
        return ["Understand"]

    legacy_map = {
        "easy": ["Remember"],
        "medium": ["Understand", "Apply"],
        "hard": ["Analyze", "Evaluate"]
    }
    if s.lower() in legacy_map:
        return legacy_map[s.lower()]

    try:
        parsed = json.loads(s)
        if isinstance(parsed, list):
            cleaned = [str(x).strip() for x in parsed if str(x).strip()]
            return cleaned or ["Understand"]
    except:
        pass

    return [s]


def default_question_type_config(qtype: str):
    if qtype == "descriptive":
        return {"count": 0, "marks": 10, "negativeMarks": 0}
    if qtype == "mcq":
        return {"count": 0, "marks": 1, "negativeMarks": 0}
    if qtype == "fill_blank":
        return {"count": 0, "marks": 1, "negativeMarks": 0}
    if qtype == "true_false":
        return {"count": 0, "marks": 1, "negativeMarks": 0}
    return {"count": 0, "marks": 1, "negativeMarks": 0}


def get_question_types_config(exam_cfg: dict):
    question_types = exam_cfg.get("questionTypes")
    if isinstance(question_types, dict) and question_types:
        normalized = {}
        for qtype in ["mcq", "fill_blank", "descriptive", "true_false"]:
            raw = question_types.get(qtype) or {}
            base = default_question_type_config(qtype)
            neg = float(raw.get("negativeMarks", base["negativeMarks"]) or 0)
            if qtype == "descriptive":
                neg = 0.0
            normalized[qtype] = {
                "count": int(raw.get("count", base["count"]) or 0),
                "marks": float(raw.get("marks", base["marks"]) or 0),
                "negativeMarks": neg,
            }
        return normalized

    old_mcq = exam_cfg.get("mcq") or {"count": 0, "marks": 1}
    old_desc = exam_cfg.get("descriptive") or {"count": 0, "marks": 10}
    return {
        "mcq": {
            "count": int(old_mcq.get("count", 0) or 0),
            "marks": float(old_mcq.get("marks", 1) or 0),
            "negativeMarks": 0.0
        },
        "fill_blank": {"count": 0, "marks": 1, "negativeMarks": 0.0},
        "descriptive": {
            "count": int(old_desc.get("count", 0) or 0),
            "marks": float(old_desc.get("marks", 10) or 0),
            "negativeMarks": 0.0
        },
        "true_false": {"count": 0, "marks": 1, "negativeMarks": 0.0},
    }


def pick_bloom_level_for_question(question: dict, allowed_blooms: list[str]) -> str:
    valid = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"}

    raw = question.get("bloomLevel") or question.get("bloom") or ""
    s = str(raw).strip().title()

    if s in valid:
        if allowed_blooms and s in allowed_blooms:
            return s
        if not allowed_blooms:
            return s

    cleaned = [str(x).strip().title() for x in (allowed_blooms or []) if str(x).strip().title() in valid]
    if cleaned:
        return cleaned[0]

    return "Understand"