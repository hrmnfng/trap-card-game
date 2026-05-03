"""Redis client setup with connection pooling."""

from typing import Any

import redis.asyncio as redis
from redis.asyncio.client import PubSub, Redis

from app.config import get_settings

settings = get_settings()

# Global Redis client instance
redis_client: Redis | None = None


async def init_redis() -> Redis:
    """Initialize Redis connection pool."""
    global redis_client
    
    if redis_client is None:
        redis_client = redis.from_url(
            str(settings.redis_url),
            encoding="utf-8",
            decode_responses=True,
            max_connections=50,
        )
    
    return redis_client


async def get_redis() -> Redis:
    """Get Redis client instance."""
    if redis_client is None:
        await init_redis()
    
    assert redis_client is not None
    return redis_client


async def get_redis_pubsub() -> PubSub:
    """Get Redis pub/sub instance."""
    client = await get_redis()
    return client.pubsub()


async def close_redis() -> None:
    """Close Redis connection."""
    global redis_client
    
    if redis_client is not None:
        await redis_client.close()
        redis_client = None
