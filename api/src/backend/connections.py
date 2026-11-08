"""
Per-replica WebSocket registry (mirrors ../freevo-api/app/src/backend/connections.py).

Each API replica only knows its own sockets; cross-replica delivery goes
through the message bus (see ws_worker.py).
"""

import asyncio
import json
import logging
from typing import Any, Dict

from fastapi import WebSocket

logger = logging.getLogger("uvicorn")


class ConnectionManager:
    def __init__(self):
        self._by_device: Dict[str, set[WebSocket]] = {}
        self._by_user: Dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, user_id: str, device_id: str) -> None:
        async with self._lock:
            self._by_device.setdefault(str(device_id), set()).add(websocket)
            self._by_user.setdefault(str(user_id), set()).add(websocket)

    async def disconnect(self, websocket: WebSocket, user_id: str, device_id: str) -> None:
        async with self._lock:
            self._drop(self._by_device, str(device_id), websocket)
            self._drop(self._by_user, str(user_id), websocket)

    @staticmethod
    def _drop(index: Dict[str, set[WebSocket]], key: str, websocket: WebSocket) -> None:
        sockets = index.get(key)
        if sockets is None:
            return
        sockets.discard(websocket)
        if not sockets:
            index.pop(key, None)

    def stats(self) -> Dict[str, int]:
        all_sockets = set().union(*self._by_user.values()) if self._by_user else set()
        return {
            "sockets": len(all_sockets),
            "users": len(self._by_user),
            "devices": len(self._by_device),
        }

    async def send_to_device(self, device_id: str, payload: Dict[str, Any]) -> None:
        await self._send(set(self._by_device.get(str(device_id), ())), payload)

    async def send_to_user(self, user_id: str, payload: Dict[str, Any]) -> None:
        await self._send(set(self._by_user.get(str(user_id), ())), payload)

    async def broadcast(self, payload: Dict[str, Any]) -> None:
        sockets = set().union(*self._by_user.values()) if self._by_user else set()
        await self._send(sockets, payload)

    async def _send(self, sockets: set[WebSocket], payload: Dict[str, Any]) -> None:
        if not sockets:
            return
        message = json.dumps(payload, default=str)
        dead = []
        for ws in sockets:
            try:
                await ws.send_text(message)
            except Exception:  # pylint: disable=broad-except
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    for index in (self._by_device, self._by_user):
                        for key in list(index):
                            self._drop(index, key, ws)


CONNECTIONS = ConnectionManager()
