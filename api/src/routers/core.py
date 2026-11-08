"""
System & authentication endpoints (mirrors ../freevo-api/app/src/routers/core.py).

Login flow (authorization code + PKCE, public frontend client):

  GET  /api/v1/system/login     -> 307 to Keycloak, sets a short-lived `oauth_state` cookie
  GET  /api/v1/system/callback  <- Keycloak redirect; exchanges the code, stores the
                                   tokens in Redis, sets the httpOnly `session_id` cookie
  POST /api/v1/system/logout    ends this device's session
  GET  /api/v1/system/me        who am I (401 when not logged in)
"""

import logging
import secrets
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import RedirectResponse
from keycloak.exceptions import KeycloakConnectionError, KeycloakError

from src.auth import (
    SESSION_COOKIE,
    auth,
    end_session,
    ensure_user,
    introspect,
    store_cookie_session,
    touch_last_login,
)
from src.backend.connections import CONNECTIONS
from src.backend.engine import ENGINE
from src.backend.keycloak import KEYCLOAK_FRONTEND_CLIENT, auth_url, new_pkce_pair
from src.backend.postgres import PostgresConnectionSingleton
from src.backend.redis import REDIS
from src.config import config
from src.exceptions import AuthenticationError, BadGatewayError, StatusLockedError

router = APIRouter(prefix="/api/v1/system", tags=["System"])

logger = logging.getLogger("uvicorn")

STATE_COOKIE = "oauth_state"
STATE_TTL_SECONDS = 10 * 60


def _cookie_kwargs(max_age: int) -> Dict[str, Any]:
    return {
        "httponly": True,
        "secure": config.FRONTEND_COOKIE_SECURE,
        "samesite": config.FRONTEND_COOKIE_SAMESITE,
        "path": "/",
        "max_age": max_age,
    }


@router.get("/ping")
async def ping():
    return {"status": "ok"}


@router.get("/info")
async def info():
    return {"service": config.TITLE, "version": config.VERSION, "docs": "/api/v1/docs"}


@router.get(
    "/login",
    status_code=307,
    summary="Login Operation",
    description="Redirects the browser to the Keycloak login page.",
)
async def login():
    state = secrets.token_urlsafe(32)
    verifier, challenge = new_pkce_pair()
    await REDIS.set_ex(f"oauth-state:{state}", verifier, STATE_TTL_SECONDS)

    redirect = RedirectResponse(url=auth_url(state, challenge), status_code=307)
    # Binds the login to this browser (login-CSRF protection); SameSite=lax
    # still sends it on Keycloak's top-level redirect back to /callback.
    redirect.set_cookie(STATE_COOKIE, state, **_cookie_kwargs(STATE_TTL_SECONDS))
    return redirect


@router.get(
    "/callback",
    status_code=307,
    summary="Validate KC Code",
    description="Exchanges the Keycloak code for tokens and redirects to the UI.",
)
async def callback(
    request: Request,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    if error:
        logger.info("Keycloak login returned error=%s", error)
        return RedirectResponse(url=f"{config.FRONTEND_EXT_URL}/?auth_error={error}")

    if not code or not state or request.cookies.get(STATE_COOKIE) != state:
        raise AuthenticationError(detail="Invalid login state")

    verifier = await REDIS.getdel(f"oauth-state:{state}")
    if not verifier:
        raise AuthenticationError(detail="Login state expired, please log in again")

    try:
        tokens = await KEYCLOAK_FRONTEND_CLIENT().a_token(
            grant_type="authorization_code",
            code=code,
            redirect_uri=config.KEYCLOAK_REDIRECT_URI,
            code_verifier=verifier,
        )
    except KeycloakConnectionError as e:
        raise BadGatewayError(detail="Failed to connect to Keycloak") from e
    except KeycloakError as e:
        logger.warning("Keycloak code exchange failed: %s", e)
        raise AuthenticationError(detail="Keycloak rejected the login") from e

    claims = await introspect(tokens["access_token"])
    user_id = claims.get("sub")
    if not claims.get("active") or not user_id:
        raise AuthenticationError(detail="Keycloak returned an inactive token")

    active, username, _player_id = await ensure_user(user_id, claims)
    if not active:
        raise StatusLockedError(detail="This user is locked")

    session_id = str(uuid.uuid4())
    await store_cookie_session(session_id, user_id, claims.get("sid"), tokens)
    await touch_last_login(user_id)
    await ENGINE.register_player(username)
    logger.info("Session created for %s", username)

    redirect = RedirectResponse(url=config.FRONTEND_EXT_URL, status_code=307)
    redirect.set_cookie(SESSION_COOKIE, session_id, **_cookie_kwargs(config.SESSION_TTL_SECONDS))
    redirect.delete_cookie(STATE_COOKIE, path="/")
    return redirect


@router.post(
    "/logout",
    status_code=204,
    summary="Logs out current user",
    description="Ends the current session only (this device).",
)
async def logout(auth_ctx: Dict[str, Any] = Depends(auth())):
    await end_session(auth_ctx)
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@router.get(
    "/verify",
    status_code=204,
    summary="Verifies the current session",
    dependencies=[Depends(auth())],
)
async def verify():
    return Response(status_code=204)


@router.get("/me", summary="Current user")
async def me(auth_ctx: Dict[str, Any] = Depends(auth())):
    # Seat the user in the ring (no-op if already there; re-seats after a demo reset)
    await ENGINE.register_player(auth_ctx["username"])
    return {
        "authenticated": True,
        "user": {
            "id": auth_ctx["uid"],
            "username": auth_ctx["username"],
            "email": auth_ctx.get("email"),
            "player_id": auth_ctx["player_id"],
        },
        "keycloak": {
            "url": config.KEYCLOAK_EXT_URL,
            "realm": config.KEYCLOAK_REALM,
            "client_id": config.KEYCLOAK_FRONTEND_CLIENT_ID,
        },
    }


@router.get("/status", summary="Dependency status", dependencies=[Depends(auth())])
async def status():
    return {
        "service": config.TITLE,
        "version": config.VERSION,
        "env": config.ENV,
        "postgres": await PostgresConnectionSingleton.ping(),
        "redis": await REDIS.ping(),
        "engine": await ENGINE.ping(),
        "message_bus": {"driver": config.MESSAGE_BUS, "channel": config.BUS_CHANNEL},
        "websockets": CONNECTIONS.stats(),
    }
