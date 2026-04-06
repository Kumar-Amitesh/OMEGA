"""
services/cache_service.py

Redis-backed caching service.
Safe for multi-instance deployments — all instances share the same Redis.

Usage:
    from services.cache_service import cache_get, cache_set, cache_delete, cache_delete_pattern

Key patterns:
    chat_list:{user_id}          — list of chats for a user
    chat_detail:{chat_id}        — single chat detail
    topics:{chat_id}             — allowed topics for a chat
"""

import json
import functools
from typing import Any, Optional
from logger import get_logger

logger = get_logger("cache_service")

# TTLs in seconds
TTL_CHAT_LIST = 60          # 1 minute — refreshed on mutation
TTL_CHAT_DETAIL = 120       # 2 minutes
TTL_TOPICS = 300            # 5 minutes — topics rarely change after PDF processing

_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is None:
        try:
            import redis
            import os
            redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
            _redis_client = redis.Redis.from_url(redis_url, decode_responses=True, socket_connect_timeout=2)
            _redis_client.ping()
            logger.info("Redis cache connected at %s", redis_url)
        except Exception as e:
            logger.warning("Redis not available, caching disabled: %s", e)
            _redis_client = None
    return _redis_client


def cache_get(key: str) -> Optional[Any]:
    """Get a value from cache. Returns None on miss or error."""
    try:
        r = _get_redis()
        if not r:
            return None
        raw = r.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as e:
        logger.debug("Cache GET error key=%s: %s", key, e)
        return None


def cache_set(key: str, value: Any, ttl: int = 60) -> bool:
    """Set a value in cache. Returns True on success."""
    try:
        r = _get_redis()
        if not r:
            return False
        r.setex(key, ttl, json.dumps(value, default=str))
        return True
    except Exception as e:
        logger.debug("Cache SET error key=%s: %s", key, e)
        return False


def cache_delete(key: str) -> bool:
    """Delete a key from cache."""
    try:
        r = _get_redis()
        if not r:
            return False
        r.delete(key)
        return True
    except Exception as e:
        logger.debug("Cache DELETE error key=%s: %s", key, e)
        return False


def cache_delete_pattern(pattern: str) -> int:
    """Delete all keys matching a pattern. Returns count deleted."""
    try:
        r = _get_redis()
        if not r:
            return 0
        keys = r.keys(pattern)
        if keys:
            return r.delete(*keys)
        return 0
    except Exception as e:
        logger.debug("Cache DELETE PATTERN error pattern=%s: %s", pattern, e)
        return 0


# ── Key builders ──────────────────────────────────────────────────────────────

def chat_list_key(user_id: str) -> str:
    return f"chat_list:{user_id}"


def chat_detail_key(chat_id: str) -> str:
    return f"chat_detail:{chat_id}"


def topics_key(chat_id: str) -> str:
    return f"topics:{chat_id}"


# ── Invalidation helpers (call on mutations) ──────────────────────────────────

def invalidate_chat_list(user_id: str):
    cache_delete(chat_list_key(user_id))


def invalidate_chat(chat_id: str, user_id: str = None):
    cache_delete(chat_detail_key(chat_id))
    cache_delete(topics_key(chat_id))
    if user_id:
        invalidate_chat_list(user_id)