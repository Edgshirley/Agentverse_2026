"""
Background WebSocket delivery worker (mirrors ../freevo-api/app/src/ws_worker.py).

Runs inside every API replica. Consumes events from the message bus (the
engine publishes one per state mutation) and pushes them to the sockets this
replica holds in CONNECTIONS. Events with `user_id` / `device_id` go to that
user / device only; everything else is broadcast to the trading ring.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict

from src.backend.bus import MESSAGE_BUS
from src.backend.connections import CONNECTIONS

logger = logging.getLogger("uvicorn")

RETRY_SECONDS = 3


def to_frame(event: Dict[str, Any]) -> Dict[str, Any]:
    """Bus event -> client frame. Strips any full-state blob: clients refetch
    `/api/state` for their own selected market."""

    data = dict(event.get("data") or {})
    data.pop("state", None)
    event_type = event.get("type") or "STATE_UPDATED"
    return {
        "event": event_type,
        "action": event.get("action") or event_type,
        "timestamp": event.get("timestamp") or datetime.now(timezone.utc).isoformat(),
        "data": data,
    }


async def handle_event(event: Dict[str, Any]) -> None:
    frame = to_frame(event)
    if event.get("device_id"):
        await CONNECTIONS.send_to_device(event["device_id"], frame)
    elif event.get("user_id"):
        await CONNECTIONS.send_to_user(event["user_id"], frame)
    else:
        await CONNECTIONS.broadcast(frame)


async def run() -> None:
    """Forever loop: consume the bus, back off and resubscribe on failure."""

    while True:
        try:
            await MESSAGE_BUS().run(handle_event)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # pylint: disable=broad-except
            logger.warning("ws_worker: bus consumer failed (%s); retrying in %ss", e, RETRY_SECONDS)
        await asyncio.sleep(RETRY_SECONDS)
