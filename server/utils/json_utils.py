import json
import re

def safe_json_extract(text: str):
    if not text:
        return []

    text = text.strip()

    def normalize(parsed):
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            return [parsed]
        return []

    try:
        return normalize(json.loads(text))
    except:
        pass

    fence = re.search(r"```json\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if fence:
        try:
            return normalize(json.loads(fence.group(1).strip()))
        except:
            pass

    fence2 = re.search(r"```\s*([\s\S]*?)\s*```", text)
    if fence2:
        try:
            return normalize(json.loads(fence2.group(1).strip()))
        except:
            pass

    start = text.find("[")
    if start != -1:
        try:
            candidate = text[start:text.rfind("]")+1]
            return normalize(json.loads(candidate))
        except:
            pass

    start = text.find("{")
    if start != -1:
        try:
            candidate = text[start:text.rfind("}")+1]
            return normalize(json.loads(candidate))
        except:
            pass

    return []
