import os
import threading
import google.generativeai as genai
import re
import json
from logger import get_logger

logger = get_logger("gemini")


class NonRetryableError(Exception):
    pass


# ── API key setup ─────────────────────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    logger.error("GEMINI_API_KEY not set. Gemini calls will fail.")

# ── Thread-safe model singleton ───────────────────────────────────────────────
# The old code used a bare global. Under Flask's threaded server multiple
# requests can hit get_gemini_model() concurrently, causing a race where
# _model is set twice or read while being set.  A lock fixes this without
# any performance cost (the lock is only contested during first call).
_model = None
_model_lock = threading.Lock()

_GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL", "")


def get_gemini_model():
    global _model
    if not GEMINI_API_KEY:
        raise NonRetryableError("GEMINI_API_KEY is not set")
    if _model is None:
        with _model_lock:
            # Double-checked locking pattern
            if _model is None:
                _model = genai.GenerativeModel(_GEMINI_MODEL_NAME)
                logger.info("Gemini model initialised: %s", _GEMINI_MODEL_NAME)
    return _model


# ── JSON extraction ───────────────────────────────────────────────────────────

def extract_json_block(text: str):
    """
    Try several strategies to pull a JSON object or array out of LLM output.
    Returns parsed Python object or None.
    """
    if not text:
        return None

    # Strip markdown fences first
    cleaned = re.sub(r"```json|```", "", text, flags=re.IGNORECASE).strip()

    # Strategy 1: entire cleaned text is valid JSON
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Strategy 2: first {...} block
    obj_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if obj_match:
        try:
            return json.loads(obj_match.group())
        except json.JSONDecodeError:
            pass

    # Strategy 3: first [...] block
    arr_match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if arr_match:
        try:
            return json.loads(arr_match.group())
        except json.JSONDecodeError:
            pass

    return None


# ── Main call wrapper ─────────────────────────────────────────────────────────

def call_gemini(prompt: str, expect_json: bool = False):
    """
    Call Gemini and return the response.

    If expect_json=True, attempts to parse the response as JSON and returns
    a dict/list.  On failure raises a clear exception rather than silently
    returning {} so callers can decide how to handle the error.

    Raises NonRetryableError for permanent failures (bad key, invalid model).
    Raises RuntimeError for transient failures (network, quota) so Celery
    can retry if this is called from a task.
    """
    try:
        model = get_gemini_model()
    except NonRetryableError:
        raise

    try:
        response = model.generate_content(prompt)
    except Exception as exc:
        # Distinguish quota / server errors from permanent failures
        err_str = str(exc).lower()
        if any(k in err_str for k in ("api_key", "invalid_argument", "not found")):
            raise NonRetryableError(f"Gemini permanent error: {exc}") from exc
        raise RuntimeError(f"Gemini transient error: {exc}") from exc

    # Log at DEBUG so production logs aren't flooded
    logger.debug("Gemini prompt (first 500 chars): %s", prompt[:500])

    text = getattr(response, "text", None)

    if not text:
        logger.error("Gemini returned no text. Response: %s", response)
        if expect_json:
            return {}
        return ""

    if not expect_json:
        return text

    parsed = extract_json_block(text)

    if parsed is None:
        logger.error(
            "JSON extraction failed.\nPrompt (first 300): %s\nResponse (first 500): %s",
            prompt[:300],
            text[:500],
        )
        return {}

    return parsed

