"""
Cookie-session authentication backed by Keycloak (mirrors ../freevo-api/app/src/auth.py).

Redis db 2 layout (same as freevo-api):

    {cookie_id}-access / -refresh / -id   the Keycloak tokens (TTL)
    {cookie_id}-sid                       the Keycloak session id (TTL)
    user-sessions:{uid}                   SET of the user's cookie ids (TTL)
    kc-session:{sid} -> cookie_id         Keycloak session id -> cookie id (TTL)
"""

import logging
import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

from fastapi import Request
from keycloak.exceptions import KeycloakConnectionError, KeycloakError
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from src.backend.keycloak import KEYCLOAK_FRONTEND_CLIENT, KEYCLOAK_OPENID_CLIENT
from src.backend.postgres import CONNECTION_ERRORS, POSTGRES_ASYNC_SESSION_FACTORY
from src.backend.redis import REDIS
from src.config import config
from src.exceptions import AuthenticationError, BadGatewayError, StatusLockedError
from src.orm import UserORM as User

logger = logging.getLogger("uvicorn")

SESSION_COOKIE = "session_id"


# ---------------------------------------------------------------------------
# Redis cookie-session store
# ---------------------------------------------------------------------------


def user_sessions_key(user_id: str) -> str:
    return f"user-sessions:{user_id}"


def kc_session_key(sid: str) -> str:
    return f"kc-session:{sid}"


async def _session_keys(cookie_session_id: str) -> list[str]:
    keys = [
        f"{cookie_session_id}-access",
        f"{cookie_session_id}-refresh",
        f"{cookie_session_id}-id",
        f"{cookie_session_id}-sid",
    ]
    sid = await REDIS.get(f"{cookie_session_id}-sid")
    if sid:
        keys.append(kc_session_key(sid))
    return keys


async def store_cookie_session(
    cookie_session_id: str, user_id: str, sid: Optional[str], tokens: Dict[str, Any]
) -> None:
    ttl = config.SESSION_TTL_SECONDS
    await REDIS.set_ex(f"{cookie_session_id}-access", tokens["access_token"], ttl)
    await REDIS.set_ex(f"{cookie_session_id}-refresh", tokens.get("refresh_token"), ttl)
    await REDIS.set_ex(f"{cookie_session_id}-id", tokens.get("id_token"), ttl)
    await REDIS.sadd(user_sessions_key(user_id), cookie_session_id, ttl)
    if sid:
        await REDIS.set_ex(f"{cookie_session_id}-sid", sid, ttl)
        await REDIS.set_ex(kc_session_key(sid), cookie_session_id, ttl)


async def clear_cookie_session(cookie_session_id: str, user_id: Optional[str] = None) -> None:
    await REDIS.delete(*(await _session_keys(cookie_session_id)))
    if user_id:
        await REDIS.srem(user_sessions_key(user_id), cookie_session_id)


# ---------------------------------------------------------------------------
# Users table
# ---------------------------------------------------------------------------


def player_id_for(username: str) -> str:
    """Same normalisation the engine applies in POST /api/groups/join."""

    return re.sub(r"[^a-z0-9]", "_", (username or "").strip().lower()) or "player"


async def ensure_user(user_id: str, claims: Dict[str, Any]) -> tuple[bool, str, str]:
    """
    Make sure the Keycloak user `user_id` has a row in `users`, creating it
    from the token claims on first sight. Returns (active, username, player_id).
    """

    username = claims.get("preferred_username") or claims.get("username") or user_id
    try:
        async with POSTGRES_ASYNC_SESSION_FACTORY()() as db:
            row = (
                await db.execute(
                    select(User.active, User.username, User.player_id).where(User.id == user_id)
                )
            ).first()
            if row is not None:
                return row[0], row[1], row[2]

            values = {
                "id": user_id,
                "username": username,
                "email": claims.get("email"),
                "first_name": claims.get("given_name"),
                "last_name": claims.get("family_name"),
            }
            base_player_id = player_id_for(username)
            # Two usernames can normalise to the same player id ("a.b" / "a_b"):
            # fall back to a suffix from the immutable Keycloak id.
            for player_id in (base_player_id, f"{base_player_id}_{user_id[:8]}"):
                try:
                    result = await db.execute(
                        pg_insert(User)
                        .values(**values, player_id=player_id)
                        .on_conflict_do_nothing(index_elements=[User.id])
                        .returning(User.active, User.username, User.player_id)
                    )
                    created = result.first()
                    await db.commit()
                    if created is None:  # concurrent first request won the race
                        row = (
                            await db.execute(
                                select(User.active, User.username, User.player_id).where(
                                    User.id == user_id
                                )
                            )
                        ).one()
                        return row[0], row[1], row[2]
                    return created[0], created[1], created[2]
                except IntegrityError:
                    await db.rollback()
            raise BadGatewayError(detail="Could not allocate a player id")
    except CONNECTION_ERRORS as e:
        raise BadGatewayError(detail="Failed to connect to the database") from e


async def touch_last_login(user_id: str) -> None:
    try:
        async with POSTGRES_ASYNC_SESSION_FACTORY()() as db:
            await db.execute(
                update(User).where(User.id == user_id).values(last_login_at=datetime.now(timezone.utc))
            )
            await db.commit()
    except CONNECTION_ERRORS:
        logger.warning("Could not record last login for %s", user_id)


# ---------------------------------------------------------------------------
# Session validation
# ---------------------------------------------------------------------------


async def introspect(access_token: str) -> Dict[str, Any]:
    try:
        return await KEYCLOAK_OPENID_CLIENT().a_introspect(access_token)
    except KeycloakConnectionError as e:
        raise BadGatewayError(detail="Failed to connect to Keycloak") from e
    except KeycloakError as e:
        raise BadGatewayError(detail="Keycloak introspection failed") from e


async def authenticate_session(session_id: Optional[str]) -> Dict[str, Any]:
    """
    Validate an opaque session id and return the caller's auth context.

    Shared by the HTTP `auth()` dependency and the WebSocket handshake:
    refreshes the Keycloak token when it expired, ensures the user row
    exists, and rejects locked users.
    """

    if not session_id:
        raise AuthenticationError(detail="Session ID does not exist")

    access_token = await REDIS.get(f"{session_id}-access")
    if access_token is None:
        raise AuthenticationError(detail="Access token with this session ID does not exist")

    status = await introspect(access_token)

    if not status.get("active"):
        refresh_token = await REDIS.get(f"{session_id}-refresh")
        if not refresh_token:
            await clear_cookie_session(session_id)
            raise AuthenticationError(detail="Session expired")
        try:
            data = await KEYCLOAK_FRONTEND_CLIENT().a_refresh_token(refresh_token)
        except KeycloakConnectionError as e:
            raise BadGatewayError(detail="Failed to connect to Keycloak") from e
        except KeycloakError as e:
            logger.info("Failed to refresh token: %s", e)
            await clear_cookie_session(session_id)
            raise AuthenticationError(detail="Failed to refresh token") from e

        # keep_ttl: a refresh rotates the tokens but must not extend the
        # cached session past the TTL armed at login.
        await REDIS.set(f"{session_id}-access", data["access_token"], keep_ttl=True)
        await REDIS.set(f"{session_id}-refresh", data.get("refresh_token"), keep_ttl=True)
        await REDIS.set(f"{session_id}-id", data.get("id_token"), keep_ttl=True)

        status = await introspect(data["access_token"])
        if not status.get("active"):
            await clear_cookie_session(session_id)
            raise AuthenticationError(detail="Session is not active")

    user_id = status.get("sub")
    if not user_id:
        raise AuthenticationError(detail="Token has no subject")

    active, username, player_id = await ensure_user(user_id, status)
    if not active:
        raise StatusLockedError(detail="This user is locked")

    return {
        "uid": user_id,
        "sid": status.get("sid"),
        "cookie_session_id": session_id,
        "username": username,
        "email": status.get("email"),
        "player_id": player_id,
    }


def auth() -> Callable[..., Any]:
    """FastAPI dependency factory: `Depends(auth())`."""

    async def dependency(request: Request) -> Dict[str, Any]:
        return await authenticate_session(request.cookies.get(SESSION_COOKIE))

    return dependency


async def end_session(auth_ctx: Dict[str, Any]) -> None:
    """Log out this device: end the Keycloak session, drop the cached cookie session."""

    cookie_session_id = auth_ctx["cookie_session_id"]
    refresh_token = await REDIS.get(f"{cookie_session_id}-refresh")
    if refresh_token:
        try:
            await KEYCLOAK_FRONTEND_CLIENT().a_logout(refresh_token)
        except KeycloakError as e:
            # The Keycloak session dies on its own; the local cache goes regardless.
            logger.warning("Keycloak logout failed: %s", e)
    await clear_cookie_session(cookie_session_id, auth_ctx.get("uid"))
