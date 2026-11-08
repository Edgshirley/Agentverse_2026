"""
Bet creation with a Gemini review, streamed to every player over the WebSocket.

POST /api/markets (the UI's "place bet") is handled here instead of the
generic engine gateway:

  1. BET_RECEIVED      the bet arrived (who, what)
  2. BET_AI_REVIEWING  Gemini is looking at it (live / simulated)
  3. BET_AI_REVIEWED   the review: summary, fair value, criteria, verdict, flags
  4. BET_CREATED       the engine opened the market; everyone can trade on it
     BET_FAILED        the engine rejected the bet

Each event goes on the message bus, so ws_worker broadcasts it to every
connected player on every replica. The review is advisory: it sets the
market's fair value and fills in missing settlement details, but never
blocks a bet.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from src.auth import auth
from src.backend.bus import MESSAGE_BUS
from src.backend.engine import ENGINE
from src.backend.gemini import GEMINI
from src.config import config
from src.exceptions import BadGatewayError, BadRequestError
from src.routers.engine import bind_identity, engine_headers, read_json_object

router = APIRouter(tags=["Bets"])

logger = logging.getLogger("uvicorn")

MAX_QUESTION_LENGTH = 500


async def publish(event_type: str, data: Dict[str, Any]) -> None:
    """Best effort: a bus outage must not fail the bet."""

    try:
        await MESSAGE_BUS().publish(
            {
                "type": event_type,
                "action": event_type,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "data": data,
            }
        )
    except Exception as e:  # pylint: disable=broad-except
        logger.warning("Could not publish %s: %s", event_type, e)


def apply_review(bet: Dict[str, Any], review: Dict[str, Any]) -> None:
    """Advisory fields only: the fair value, and settlement details the player left blank."""

    if review.get("fair_value") is not None:
        bet["live_implied_value"] = review["fair_value"]
        bet["fair_value_source"] = "AI_ADVISORY"
    for field in ("criteria", "resolution_source"):
        if not str(bet.get(field) or "").strip() and review.get(field):
            bet[field] = review[field]


@router.post("/api/markets", summary="Place a bet (reviewed by Gemini)")
async def create_bet(request: Request, auth_ctx: Dict[str, Any] = Depends(auth())):
    bet = bind_identity("markets", await read_json_object(request), auth_ctx)

    question = str(bet.get("question") or "").strip()
    if not question:
        raise BadRequestError(detail="A bet needs a question")
    if len(question) > MAX_QUESTION_LENGTH:
        raise BadRequestError(detail=f"Keep the question under {MAX_QUESTION_LENGTH} characters")
    bet["question"] = question

    who = {
        "bet_id": uuid.uuid4().hex[:12],
        "player_id": auth_ctx["player_id"],
        "username": auth_ctx["username"],
        "question": question,
    }
    await publish("BET_RECEIVED", who)
    await publish("BET_AI_REVIEWING", {**who, "mode": GEMINI.mode, "model": config.GEMINI_MODEL})

    result = await GEMINI.review_bet(bet)
    await publish("BET_AI_REVIEWED", {**who, **result})
    apply_review(bet, result["review"])

    try:
        res = await ENGINE.client.post(
            "/api/markets", json=bet, headers=engine_headers(request, auth_ctx)
        )
    except httpx.HTTPError as e:
        await publish("BET_FAILED", {**who, "error": "Rules engine is unavailable"})
        raise BadGatewayError(detail="Rules engine is unavailable") from e

    try:
        body = res.json()
    except ValueError:
        body = {"error": res.text[:200] or f"Engine returned HTTP {res.status_code}"}

    if res.status_code >= 400 or not isinstance(body, dict):
        error = body.get("error") if isinstance(body, dict) else None
        await publish("BET_FAILED", {**who, "error": error or f"HTTP {res.status_code}"})
        return JSONResponse(status_code=res.status_code, content=body)

    market = body.get("market") or {}
    await publish(
        "BET_CREATED",
        {**who, "market_id": market.get("id"), "fair_value": market.get("live_implied_value")},
    )
    return JSONResponse(status_code=res.status_code, content={**body, "ai_review": result})
