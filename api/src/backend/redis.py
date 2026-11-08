"""
Redis client singleton (db 2), mirrors ../freevo-api/app/src/backend/redis.py.
Connection failures surface as BadGatewayError.
"""

import functools
from typing import Optional, Set

import redis.asyncio as aioredis
from redis.exceptions import ConnectionError as RedisConnectionError
from redis.exceptions import TimeoutError as RedisTimeoutError

from src.config import config
from src.exceptions import BadGatewayError


def _wrap(fn):
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except (RedisConnectionError, RedisTimeoutError, OSError) as e:
            raise BadGatewayError(detail="Failed to connect to Redis") from e

    return wrapper


class RedisClient:
    """Thin async wrapper around one shared connection pool."""

    def __init__(self):
        self._client: Optional[aioredis.Redis] = None

    @property
    def conn(self) -> aioredis.Redis:
        if self._client is None:
            self._client = aioredis.Redis(
                host=config.REDIS_HOST,
                port=config.REDIS_PORT,
                password=config.REDIS_PASSWORD,
                db=2,
                decode_responses=True,
                socket_connect_timeout=3,
                health_check_interval=30,
            )
        return self._client

    @_wrap
    async def get(self, key: str) -> Optional[str]:
        return await self.conn.get(key)

    @_wrap
    async def getdel(self, key: str) -> Optional[str]:
        return await self.conn.getdel(key)

    @_wrap
    async def set(self, key: str, value: Optional[str], keep_ttl: bool = False) -> None:
        if value is None:
            return
        await self.conn.set(key, value, keepttl=keep_ttl)

    @_wrap
    async def set_ex(self, key: str, value: Optional[str], ttl: int) -> None:
        if value is None:
            return
        await self.conn.set(key, value, ex=ttl)

    @_wrap
    async def delete(self, *keys: str) -> None:
        if keys:
            await self.conn.delete(*keys)

    @_wrap
    async def sadd(self, key: str, member: str, ttl: Optional[int] = None) -> None:
        await self.conn.sadd(key, member)
        if ttl is not None:
            await self.conn.expire(key, ttl)

    @_wrap
    async def srem(self, key: str, member: str) -> None:
        await self.conn.srem(key, member)

    @_wrap
    async def smembers(self, key: str) -> Set[str]:
        return set(await self.conn.smembers(key))

    @_wrap
    async def publish(self, channel: str, message: str) -> None:
        await self.conn.publish(channel, message)

    def pubsub(self):
        return self.conn.pubsub()

    async def ping(self) -> bool:
        try:
            return bool(await self.conn.ping())
        except Exception:  # pylint: disable=broad-except
            return False

    async def close(self) -> None:
        if self._client is not None:
            client, self._client = self._client, None
            await client.aclose()


REDIS = RedisClient()
