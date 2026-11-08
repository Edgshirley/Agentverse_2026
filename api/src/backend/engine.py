"""
HTTP client for the internal TypeScript rules engine (backend/, Hono on :4000).

The engine is reachable only on the docker network. This API is the public
entry point: it authenticates the caller and forwards game requests here with
the caller's player id bound into the payload.
"""

import logging
from typing import Optional

import httpx

from src.config import config

logger = logging.getLogger("uvicorn")


class EngineClient:
    def __init__(self):
        self._client: Optional[httpx.AsyncClient] = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=config.ENGINE_URL,
                timeout=httpx.Timeout(config.ENGINE_TIMEOUT_SECONDS, connect=5.0),
            )
        return self._client

    async def register_player(self, username: str) -> None:
        """Idempotently seat the user in the engine's trading ring."""

        try:
            await self.client.post("/api/groups/join", json={"nickname": username})
        except httpx.HTTPError as e:
            logger.warning("Could not register player %s in engine: %s", username, e)

    async def get_state(self, market_id: Optional[str] = None) -> Optional[dict]:
        try:
            params = {"marketId": market_id} if market_id else None
            res = await self.client.get("/api/state", params=params)
            res.raise_for_status()
            return res.json()
        except (httpx.HTTPError, ValueError) as e:
            logger.warning("Could not fetch engine state: %s", e)
            return None

    async def ping(self) -> bool:
        try:
            res = await self.client.get("/api/health", timeout=3.0)
            return res.status_code == 200
        except httpx.HTTPError:
            return False

    async def close(self) -> None:
        if self._client is not None:
            client, self._client = self._client, None
            await client.aclose()


ENGINE = EngineClient()
