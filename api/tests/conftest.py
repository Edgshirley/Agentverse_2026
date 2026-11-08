"""
Unit-test fixtures: the API runs against in-memory fakes of Redis, Keycloak,
Postgres (users table) and the rules engine, so `pytest` needs no stack.
The live-stack check is tests/live_login_check.py.
"""

import json
import os

os.environ.setdefault("ENV", "test")
os.environ.setdefault("KEYCLOAK_CLIENT_SECRET", "test-secret")
os.environ.setdefault("MESSAGE_BUS", "memory")
os.environ.setdefault("ENGINE_URL", "http://engine.test")

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import src.auth as auth_module  # noqa: E402
import src.routers.bets as bets_module  # noqa: E402
import src.routers.core as core_module  # noqa: E402
from src.config import config  # noqa: E402
from src.auth import player_id_for  # noqa: E402
from src.backend.engine import ENGINE  # noqa: E402
from src.main import api  # noqa: E402


class FakeRedis:
    def __init__(self):
        self.kv: dict[str, str] = {}
        self.sets: dict[str, set[str]] = {}

    async def get(self, key):
        return self.kv.get(key)

    async def getdel(self, key):
        return self.kv.pop(key, None)

    async def set(self, key, value, keep_ttl=False):
        if value is not None:
            self.kv[key] = value

    async def set_ex(self, key, value, ttl):
        if value is not None:
            self.kv[key] = value

    async def delete(self, *keys):
        for k in keys:
            self.kv.pop(k, None)
            self.sets.pop(k, None)

    async def sadd(self, key, member, ttl=None):
        self.sets.setdefault(key, set()).add(member)

    async def srem(self, key, member):
        self.sets.get(key, set()).discard(member)

    async def smembers(self, key):
        return set(self.sets.get(key, set()))

    async def ping(self):
        return True


class FakeKeycloak:
    """Stands in for both the public and the confidential client."""

    def __init__(self):
        self.active_tokens: dict[str, dict] = {}
        self.refreshable: dict[str, str] = {}
        self.logged_out: list[str] = []

    def issue(self, username: str, suffix: str = "1") -> dict:
        access = f"access-{username}-{suffix}"
        self.active_tokens[access] = {
            "active": True,
            "sub": f"uuid-{username}",
            "sid": f"sid-{username}",
            "preferred_username": username,
            "email": f"{username}@spread.local",
        }
        return {"access_token": access, "refresh_token": f"refresh-{username}", "id_token": "id"}

    async def a_token(self, grant_type, code, redirect_uri, code_verifier):
        assert grant_type == "authorization_code"
        assert code_verifier, "PKCE verifier must be sent"
        return self.issue(code)

    async def a_introspect(self, token):
        return self.active_tokens.get(token, {"active": False})

    async def a_refresh_token(self, refresh_token):
        username = refresh_token.removeprefix("refresh-")
        return self.issue(username, suffix="refreshed")

    async def a_logout(self, refresh_token):
        self.logged_out.append(refresh_token)


class FakeUsers:
    def __init__(self):
        self.locked: set[str] = set()

    async def ensure_user(self, user_id, claims):
        username = claims["preferred_username"]
        return user_id not in self.locked, username, player_id_for(username)


@pytest.fixture
def stack(monkeypatch):
    redis = FakeRedis()
    keycloak = FakeKeycloak()
    users = FakeUsers()
    engine_calls: list[dict] = []
    engine_state = {"reject_markets": False}
    bus_events: list[dict] = []

    def engine_handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        engine_calls.append({"method": request.method, "path": request.url.path, "body": body})
        if request.url.path == "/api/state":
            return httpx.Response(200, json={"stateVersion": 7, "players": []})
        if request.url.path == "/api/markets" and request.method == "POST":
            if engine_state["reject_markets"]:
                return httpx.Response(400, json={"error": "Bounds are inverted"})
            return httpx.Response(200, json={"market": {"id": "mkt_1", **body}, "bundle": {}})
        return httpx.Response(200, json={"ok": True, "echo": body})

    class RecordingBus:
        async def publish(self, event):
            bus_events.append(event)

    monkeypatch.setattr(bets_module, "MESSAGE_BUS", lambda: RecordingBus())
    monkeypatch.setattr(config, "GEMINI_API", None)
    monkeypatch.setattr(config, "GEMINI_SIMULATED_DELAY_SECONDS", 0)

    for module in (auth_module, core_module):
        monkeypatch.setattr(module, "REDIS", redis)
        monkeypatch.setattr(module, "ensure_user", users.ensure_user, raising=False)
    monkeypatch.setattr(auth_module, "KEYCLOAK_FRONTEND_CLIENT", lambda: keycloak)
    monkeypatch.setattr(auth_module, "KEYCLOAK_OPENID_CLIENT", lambda: keycloak)
    monkeypatch.setattr(core_module, "KEYCLOAK_FRONTEND_CLIENT", lambda: keycloak)

    async def no_touch(_user_id):
        return None

    monkeypatch.setattr(core_module, "touch_last_login", no_touch)
    monkeypatch.setattr(
        ENGINE,
        "_client",
        httpx.AsyncClient(
            transport=httpx.MockTransport(engine_handler), base_url="http://engine.test"
        ),
    )

    with TestClient(api, base_url="http://localhost:5173") as client:
        yield {
            "client": client,
            "redis": redis,
            "keycloak": keycloak,
            "users": users,
            "engine_calls": engine_calls,
            "engine_state": engine_state,
            "bus_events": bus_events,
        }


def login(stack, username: str = "alice") -> str:
    """Drive the real /login -> /callback flow; returns the session id."""

    client = stack["client"]
    res = client.get("/api/v1/system/login", follow_redirects=False)
    state = client.cookies.get("oauth_state")
    assert res.status_code == 307 and state
    res = client.get(
        "/api/v1/system/callback",
        params={"code": username, "state": state},
        follow_redirects=False,
    )
    assert res.status_code == 307, res.text
    session_id = client.cookies.get("session_id")
    assert session_id
    return session_id
