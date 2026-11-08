"""
Authenticated gateway to the rules engine.

Every `/api/*` route not handled by this API is forwarded to the internal
TypeScript engine (backend/). The caller must hold a valid session, and the
acting-player fields of JSON bodies are overwritten with the caller's own
player id, so nobody can trade, quote or withdraw as someone else.

Registered LAST so the native `/api/v1/*` routes win.
"""

import json
import logging
from typing import Any, Dict

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from src.auth import auth
from src.backend.engine import ENGINE
from src.exceptions import BadGatewayError, BadRequestError

router = APIRouter(tags=["Engine"])

logger = logging.getLogger("uvicorn")

# Body fields that name the acting player in the engine's routes.
ACTOR_FIELDS = ("playerId", "player_id", "proposer_id")

# Response headers that must not be copied from the upstream response.
HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "content-length",
}

STREAM_PATHS = {"stream", "events"}


def bind_identity(path: str, payload: Dict[str, Any], auth_ctx: Dict[str, Any]) -> Dict[str, Any]:
    player_id = auth_ctx["player_id"]
    for field in ACTOR_FIELDS:
        payload[field] = player_id
    if path == "groups/join":
        payload["nickname"] = auth_ctx["username"]
    return payload


async def read_json_object(request: Request) -> Dict[str, Any]:
    """The request body as a JSON object ({} when empty).

    The engine parses every body as JSON whatever its content-type, so every
    body is validated and bound here: a non-object (array, scalar, text) would
    make the engine fall back to a default player id instead of the caller's.
    """

    body = await request.body()
    if not body.strip():
        return {}
    try:
        payload = json.loads(body)
    except ValueError as e:
        raise BadRequestError(detail="Request body must be a JSON object") from e
    if not isinstance(payload, dict):
        raise BadRequestError(detail="Request body must be a JSON object")
    return payload


def engine_headers(request: Request, auth_ctx: Dict[str, Any]) -> Dict[str, str]:
    return {
        "content-type": "application/json",
        "accept": request.headers.get("accept", "application/json"),
        "x-spread-user-id": auth_ctx["uid"],
        "x-spread-player-id": auth_ctx["player_id"],
    }


@router.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    summary="Rules engine gateway",
)
async def forward(path: str, request: Request, auth_ctx: Dict[str, Any] = Depends(auth())):
    body = b""
    if request.method != "GET":
        payload = bind_identity(path, await read_json_object(request), auth_ctx)
        body = json.dumps(payload).encode()

    headers = engine_headers(request, auth_ctx)

    upstream = ENGINE.client.build_request(
        request.method,
        f"/api/{path}",
        params=request.query_params,
        content=body if request.method not in ("GET", "HEAD") else None,
        headers=headers,
        timeout=None if path in STREAM_PATHS else httpx.USE_CLIENT_DEFAULT,
    )
    try:
        response = await ENGINE.client.send(upstream, stream=True)
    except httpx.HTTPError as e:
        logger.warning("Engine request %s /api/%s failed: %s", request.method, path, e)
        raise BadGatewayError(detail="Rules engine is unavailable") from e

    out_headers = {k: v for k, v in response.headers.items() if k.lower() not in HOP_BY_HOP}

    if "text/event-stream" in response.headers.get("content-type", ""):
        return StreamingResponse(
            response.aiter_raw(),
            status_code=response.status_code,
            headers=out_headers,
            background=BackgroundTask(response.aclose),
        )

    try:
        content = await response.aread()
    finally:
        await response.aclose()
    out_headers.pop("content-encoding", None)
    return Response(content=content, status_code=response.status_code, headers=out_headers)
