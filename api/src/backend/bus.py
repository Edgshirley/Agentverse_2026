"""
Pluggable real-time message bus (mirrors ../freevo-api/app/src/backend/bus.py).

  MESSAGE_BUS=redis   Redis pub/sub on BUS_CHANNEL (the engine publishes here)
  MESSAGE_BUS=memory  in-process queue (tests / single replica)
"""

import asyncio
import json
import logging
from abc import ABC, abstractmethod
from typing import Any, Awaitable, Callable, Dict, Optional

from src.backend.redis import REDIS
from src.config import config

logger = logging.getLogger("uvicorn")

Handler = Callable[[Dict[str, Any]], Awaitable[None]]


class MessageBus(ABC):
    @abstractmethod
    async def publish(self, event: Dict[str, Any]) -> None: ...

    @abstractmethod
    async def run(self, handler: Handler) -> None:
        """Consume events forever, calling `handler` for each one."""

    async def close(self) -> None:
        return None


class RedisMessageBus(MessageBus):
    def __init__(self, channel: str):
        self.channel = channel

    async def publish(self, event: Dict[str, Any]) -> None:
        await REDIS.publish(self.channel, json.dumps(event, default=str))

    async def run(self, handler: Handler) -> None:
        pubsub = REDIS.pubsub()
        try:
            await pubsub.subscribe(self.channel)
            logger.info("Message bus subscribed to redis channel %s", self.channel)
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    event = json.loads(message["data"])
                except (TypeError, ValueError):
                    logger.warning("Dropping malformed bus event")
                    continue
                await handler(event)
        finally:
            try:
                await pubsub.unsubscribe(self.channel)
                await pubsub.aclose()
            except Exception:  # pylint: disable=broad-except
                pass


class InMemoryMessageBus(MessageBus):
    def __init__(self):
        self._queue: asyncio.Queue = asyncio.Queue()

    async def publish(self, event: Dict[str, Any]) -> None:
        await self._queue.put(event)

    async def run(self, handler: Handler) -> None:
        while True:
            event = await self._queue.get()
            await handler(event)


class MessageBusSingleton:
    _bus: Optional[MessageBus] = None

    @classmethod
    def get(cls) -> MessageBus:
        if cls._bus is None:
            if config.MESSAGE_BUS == "memory":
                cls._bus = InMemoryMessageBus()
            else:
                cls._bus = RedisMessageBus(config.BUS_CHANNEL)
        return cls._bus

    @classmethod
    async def close(cls) -> None:
        if cls._bus is not None:
            bus, cls._bus = cls._bus, None
            await bus.close()


MESSAGE_BUS = MessageBusSingleton.get
