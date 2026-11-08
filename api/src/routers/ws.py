"""
WebSocket endpoint for real-time market updates (mirrors ../freevo-api/app/src/routers/ws.py).

Authenticates the same httpOnly `session_id` cookie as the REST API (the
browser sends it on the upgrade request), registers the socket in this
replica's CONNECTIONS, and lets `ws_worker` push engine events to it.

Client -> server frames: {"type": "PING"} -> {"event": "pong"}. Anything else
is ignored (all mutations go through the REST API).
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from src.auth import SESSION_COOKIE, authenticate_session
from src.backend.connections import CONNECTIONS
from src.exceptions import APIException

router = APIRouter(prefix="/api/v1", tags=["Realtime"])

logger = logging.getLogger("uvicorn")

# Policy violation close code (RFC 6455).
_WS_POLICY_VIOLATION = 1008


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.websocket("/ws")
async def ws_market_stream(websocket: WebSocket, device_id: Optional[str] = Query(None)):
    try:
        auth_ctx = await authenticate_session(websocket.cookies.get(SESSION_COOKIE))
    except APIException:
        await websocket.close(code=_WS_POLICY_VIOLATION)
        return

    # A device id only scopes targeted deliveries; it is namespaced by user so
    # one user can never subscribe to another user's device stream.
    device = f"{auth_ctx['uid']}:{device_id or uuid.uuid4()}"
    user_id = auth_ctx["player_id"]

    await websocket.accept()
    await CONNECTIONS.connect(websocket, user_id, device)
    logger.info("ws connected: user=%s device=%s", user_id, device)
    try:
        await websocket.send_text(
            json.dumps(
                {
                    "event": "connected",
                    "timestamp": _now(),
                    "data": {"player_id": user_id, "username": auth_ctx["username"]},
                }
            )
        )
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if isinstance(msg, dict) and (msg.get("type") == "PING" or msg.get("event") == "ping"):
                await websocket.send_text(json.dumps({"event": "pong", "timestamp": _now()}))
    except WebSocketDisconnect:
        pass
    finally:
        await CONNECTIONS.disconnect(websocket, user_id, device)
        logger.info("ws disconnected: user=%s device=%s", user_id, device)
