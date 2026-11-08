import asyncio
import json
from urllib.parse import parse_qs, urlparse

import pytest
from starlette.websockets import WebSocketDisconnect

from src.backend.connections import ConnectionManager
from src import ws_worker
from tests.conftest import login


def test_ping_is_public(stack):
    res = stack["client"].get("/api/v1/system/ping")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_engine_routes_require_a_session(stack):
    client = stack["client"]
    assert client.get("/api/state").status_code == 401
    res = client.post("/api/markets/m1/take", json={"playerId": "bob", "side": "YES", "amount": 5})
    assert res.status_code == 401
    assert res.json()["error"]
    assert stack["engine_calls"] == []


def test_login_redirects_to_keycloak_with_pkce_and_state(stack):
    client = stack["client"]
    res = client.get("/api/v1/system/login", follow_redirects=False)
    assert res.status_code == 307
    url = urlparse(res.headers["location"])
    assert url.netloc == "localhost:8080"
    assert url.path == "/realms/master/protocol/openid-connect/auth"
    qs = parse_qs(url.query)
    assert qs["client_id"] == ["spread-ui"]
    assert qs["code_challenge_method"] == ["S256"]
    state = qs["state"][0]
    assert client.cookies.get("oauth_state") == state
    assert f"oauth-state:{state}" in stack["redis"].kv


def test_callback_rejects_state_mismatch(stack):
    client = stack["client"]
    client.get("/api/v1/system/login", follow_redirects=False)
    res = client.get(
        "/api/v1/system/callback",
        params={"code": "alice", "state": "forged"},
        follow_redirects=False,
    )
    assert res.status_code == 401
    assert client.cookies.get("session_id") is None


def test_callback_state_is_single_use(stack):
    client = stack["client"]
    client.get("/api/v1/system/login", follow_redirects=False)
    state = client.cookies.get("oauth_state")
    first = client.get(
        "/api/v1/system/callback", params={"code": "alice", "state": state}, follow_redirects=False
    )
    assert first.status_code == 307
    client.cookies.set("oauth_state", state)
    replay = client.get(
        "/api/v1/system/callback", params={"code": "alice", "state": state}, follow_redirects=False
    )
    assert replay.status_code == 401


def test_login_flow_creates_session_and_seats_player(stack):
    session_id = login(stack, "alice")
    redis = stack["redis"]
    assert redis.kv[f"{session_id}-access"] == "access-alice-1"
    assert redis.kv["kc-session:sid-alice"] == session_id
    assert session_id in redis.sets["user-sessions:uuid-alice"]
    assert {"method": "POST", "path": "/api/groups/join", "body": {"nickname": "alice"}} in stack[
        "engine_calls"
    ]

    me = stack["client"].get("/api/v1/system/me")
    assert me.status_code == 200
    assert me.json()["user"]["player_id"] == "alice"


def test_gateway_binds_the_acting_player(stack):
    login(stack, "alice")
    res = stack["client"].post(
        "/api/markets/m1/take",
        json={"playerId": "bob", "player_id": "bob", "side": "YES", "amount": 5},
    )
    assert res.status_code == 200
    forwarded = stack["engine_calls"][-1]
    assert forwarded["path"] == "/api/markets/m1/take"
    assert forwarded["body"]["playerId"] == "alice"
    assert forwarded["body"]["player_id"] == "alice"
    assert forwarded["body"]["proposer_id"] == "alice"
    assert forwarded["body"]["amount"] == 5


@pytest.mark.parametrize(
    "content, content_type",
    [
        ('{"playerId": "bob", "amount": 5}', "text/plain"),
        ('{"playerId": "bob", "amount": 5}', None),
    ],
)
def test_gateway_binds_regardless_of_content_type(stack, content, content_type):
    login(stack, "alice")
    headers = {"content-type": content_type} if content_type else {}
    res = stack["client"].post("/api/markets/m1/take", content=content, headers=headers)
    assert res.status_code == 200
    assert stack["engine_calls"][-1]["body"]["playerId"] == "alice"


@pytest.mark.parametrize("content", ['[{"playerId": "bob"}]', '"bob"', "not json"])
def test_gateway_rejects_non_object_bodies(stack, content):
    login(stack, "alice")
    calls_before = len(stack["engine_calls"])
    res = stack["client"].post(
        "/api/markets/m1/take", content=content, headers={"content-type": "application/json"}
    )
    assert res.status_code == 400
    assert len(stack["engine_calls"]) == calls_before


def test_gateway_binds_join_nickname(stack):
    login(stack, "alice")
    stack["client"].post("/api/groups/join", json={"nickname": "BOB"})
    assert stack["engine_calls"][-1]["body"]["nickname"] == "alice"


def test_gateway_forwards_get_with_query(stack):
    login(stack, "alice")
    res = stack["client"].get("/api/state", params={"marketId": "m9"})
    assert res.status_code == 200
    assert res.json()["stateVersion"] == 7


def test_expired_access_token_is_refreshed(stack):
    session_id = login(stack, "alice")
    stack["keycloak"].active_tokens.pop("access-alice-1")
    res = stack["client"].get("/api/v1/system/verify")
    assert res.status_code == 204
    assert stack["redis"].kv[f"{session_id}-access"] == "access-alice-refreshed"


def test_unrefreshable_session_is_cleared(stack):
    session_id = login(stack, "alice")
    stack["keycloak"].active_tokens.clear()
    del stack["redis"].kv[f"{session_id}-refresh"]
    assert stack["client"].get("/api/v1/system/verify").status_code == 401
    assert f"{session_id}-access" not in stack["redis"].kv


def test_locked_user_is_rejected(stack):
    login(stack, "alice")
    stack["users"].locked.add("uuid-alice")
    assert stack["client"].get("/api/state").status_code == 423


def test_logout_ends_keycloak_session_and_clears_cache(stack):
    session_id = login(stack, "alice")
    res = stack["client"].post("/api/v1/system/logout")
    assert res.status_code == 204
    assert stack["keycloak"].logged_out == ["refresh-alice"]
    assert f"{session_id}-access" not in stack["redis"].kv
    assert "kc-session:sid-alice" not in stack["redis"].kv
    assert stack["client"].get("/api/state").status_code == 401


def test_websocket_rejects_anonymous(stack):
    with pytest.raises(WebSocketDisconnect) as exc:
        with stack["client"].websocket_connect("/api/v1/ws") as ws:
            ws.receive_text()
    assert exc.value.code == 1008


def test_websocket_handshake_and_ping(stack):
    session_id = login(stack, "alice")
    with stack["client"].websocket_connect(
        "/api/v1/ws?device_id=tab-1", headers={"cookie": f"session_id={session_id}"}
    ) as ws:
        hello = json.loads(ws.receive_text())
        assert hello["event"] == "connected"
        assert hello["data"]["player_id"] == "alice"
        ws.send_text(json.dumps({"type": "PING"}))
        assert json.loads(ws.receive_text())["event"] == "pong"


class FakeSocket:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_text(self, text):
        self.sent.append(json.loads(text))


def test_ws_worker_strips_state_and_routes_events(monkeypatch):
    manager = ConnectionManager()
    monkeypatch.setattr(ws_worker, "CONNECTIONS", manager)
    alice, bob = FakeSocket(), FakeSocket()

    async def scenario():
        await manager.connect(alice, "alice", "d1")
        await manager.connect(bob, "bob", "d2")
        await ws_worker.handle_event(
            {
                "type": "STATE_UPDATED",
                "action": "TAKE",
                "data": {"marketId": "m1", "stateVersion": 3, "state": {"huge": True}},
            }
        )
        await ws_worker.handle_event({"type": "NOTICE", "user_id": "bob", "data": {"x": 1}})

    asyncio.run(scenario())
    assert alice.sent == [
        {
            "event": "STATE_UPDATED",
            "action": "TAKE",
            "timestamp": alice.sent[0]["timestamp"],
            "data": {"marketId": "m1", "stateVersion": 3},
        }
    ]
    assert [f["event"] for f in bob.sent] == ["STATE_UPDATED", "NOTICE"]
