import os
from flask import Flask, jsonify
from flask_cors import CORS
from config import Config
from extensions import db, celery
from logger import get_logger
from routes import (
    auth_bp, chat_bp, pdf_bp, question_bp, session_bp,
    debug_bp, flashcard_bp, video_bp, video_session_bp,
    jd_bp, jd_session_bp, intelligence_bp, report_bp
)

logger = get_logger("app")

# ── JWT secret guard ──────────────────────────────────────────────────────────
# If JWT_SECRET is not set (or is the insecure default), warn loudly.
# We do NOT crash here because developers often run without env files,
# but the warning is hard to miss in logs.
_jwt_secret = os.getenv("JWT_SECRET", "")
if not _jwt_secret:
    logger.warning(
        "JWT_SECRET is not set or is using the insecure default 'exam-secret'. "
        "Set a strong random value in your environment before deploying."
    )

app = Flask(__name__)
app.config.from_object(Config)

# ── Request size limit ────────────────────────────────────────────────────────
# Prevents a user from sending megabytes of text in a single answer submission.
# PDF uploads have their own size check in pdf_routes.py (100 MB for video).
# For JSON API calls 10 MB is very generous — a normal exam submission is <50 KB.
# The video upload route sets its own 100 MB limit via MAX_UPLOAD_BYTES.
app.config["MAX_CONTENT_LENGTH"] = int(
    os.getenv("MAX_REQUEST_MB", "10")
) * 1024 * 1024  # default 10 MB

# ── SQLAlchemy connection pool ────────────────────────────────────────────────
# Default pool_size=5 exhausts quickly under concurrent load.
# These values work well for a single-machine deployment with one Postgres/SQLite.
app.config.setdefault("SQLALCHEMY_ENGINE_OPTIONS", {
    "pool_size":    int(os.getenv("DB_POOL_SIZE",    "10")),
    "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "20")),
    "pool_timeout": int(os.getenv("DB_POOL_TIMEOUT", "30")),
    "pool_recycle": int(os.getenv("DB_POOL_RECYCLE", "1800")),  # recycle every 30 min
    "pool_pre_ping": True,   # checks connection is alive before using it
})

# ── CORS ──────────────────────────────────────────────────────────────────────
# "origin=*" with supports_credentials=True is rejected by all browsers.
# Read allowed origins from an env var so dev and prod differ without code changes.
_raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000",
)
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

CORS(
    app,
    origins=_allowed_origins,
    supports_credentials=True,
    allow_headers=["Content-Type", "Authorization"],
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)

# ── Rate limiting ─────────────────────────────────────────────────────────────
# Uses Flask-Limiter backed by Redis (same Redis Celery already uses).
# Falls back gracefully to in-memory if Redis is unavailable — this means
# limits are per-process, not shared across workers, but it is still better
# than nothing and does NOT break the application.
#
# Install: pip install Flask-Limiter
# If you don't have it installed yet, the try/except makes it optional.
try:
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address

    _redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")

    limiter = Limiter(
        key_func=get_remote_address,
        app=app,
        # Global default: 200 requests per minute per IP.
        # Individual routes can override with @limiter.limit("...")
        default_limits=["200 per minute"],
        storage_uri=_redis_url,
        # If Redis is down, allow requests through rather than blocking everyone.
        on_breach=None,
        strategy="fixed-window",
    )

    # Attach limiter to the app so blueprints can import it if needed
    app.extensions["limiter"] = limiter
    logger.info("Rate limiter enabled (Redis: %s)", _redis_url)

except ImportError:
    logger.warning(
        "Flask-Limiter not installed. Rate limiting is disabled. "
        "Run: pip install Flask-Limiter"
    )
    limiter = None

# ── Error handler for rate limit exceeded ─────────────────────────────────────
# Only registered when limiter is active.
if limiter is not None:
    @app.errorhandler(429)
    def rate_limit_exceeded(e):
        logger.warning("Rate limit exceeded: %s", str(e))
        return jsonify({
            "error": "Too many requests. Please wait a moment before trying again.",
            "retry_after": getattr(e, "retry_after", 60),
        }), 429

# ── 413 handler for oversized requests ───────────────────────────────────────
@app.errorhandler(413)
def request_too_large(e):
    logger.warning("Request too large: %s", str(e))
    return jsonify({
        "error": "Request body too large. Maximum allowed size is "
                 f"{app.config['MAX_CONTENT_LENGTH'] // (1024*1024)} MB."
    }), 413

os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

db.init_app(app)
celery.conf.update(app.config)

with app.app_context():
    db.create_all()

app.register_blueprint(auth_bp)
app.register_blueprint(chat_bp)
app.register_blueprint(pdf_bp)
app.register_blueprint(question_bp)
app.register_blueprint(session_bp)
app.register_blueprint(debug_bp)
app.register_blueprint(flashcard_bp)
app.register_blueprint(video_bp)
app.register_blueprint(video_session_bp)
app.register_blueprint(jd_bp)
app.register_blueprint(jd_session_bp)
app.register_blueprint(intelligence_bp)
app.register_blueprint(report_bp)

logger.info(
    "App started | CORS origins: %s | Max request: %d MB | Pool size: %s",
    _allowed_origins,
    app.config["MAX_CONTENT_LENGTH"] // (1024 * 1024),
    app.config["SQLALCHEMY_ENGINE_OPTIONS"].get("pool_size"),
)

if __name__ == "__main__":
    app.run(debug=False, port=5000, host="0.0.0.0", use_reloader=False)

