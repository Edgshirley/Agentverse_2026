"""
Live end-to-end check against the running dev stack (`make dev`).
Not collected by pytest (no test_ prefix). Run with:

    python api/tests/live_login_check.py

Drives the real browser flow through the UI's dev server (:5173):
  1. GET /api/v1/system/login -> Keycloak login page
  2. submit alice's credentials to Keycloak
  3. Keycloak -> /api/v1/system/callback -> session_id cookie
  4. /api/v1/system/me, /api/state through the gateway
  5. a market proposed "as bob" is created by alice (identity binding)
  6. the WebSocket streams the bet pipeline: received -> AI review -> created
  7. bob logs in and trades on alice's new bet
"""

import asyncio
import html
import json
import os
import re
import sys

import httpx
import websockets

UI = os.getenv("UI_URL", "http://localhost:5173")
USERNAME = os.getenv("LIVE_USERNAME", "alice")
OTHER_USERNAME = os.getenv("LIVE_OTHER_USERNAME", "bob")
PASSWORD = os.getenv("LIVE_PASSWORD", "spread123")


def step(msg: str) -> None:
    print(f"  ✓ {msg}")


def fail(msg: str) -> None:
    print(f"  ✗ {msg}", file=sys.stderr)
    sys.exit(1)


def browser_login(client: httpx.Client, username: str = USERNAME) -> str:
    page = client.get(f"{UI}/api/v1/system/login", follow_redirects=True)
    if "kc-form-login" not in page.text:
        fail(f"expected the Keycloak login form, got {page.status_code} {page.url}")
    step(f"redirected to Keycloak login ({page.url.host}:{page.url.port})")

    # Keycloak marks its login cookies `Secure; SameSite=None`. Browsers treat
    # http://localhost as a secure context and send them; Python's cookie jar
    # does not over plain HTTP, so mimic the browser here.
    for cookie in client.cookies.jar:
        cookie.secure = False

    action = html.unescape(re.search(r'id="kc-form-login"[^>]*action="([^"]+)"', page.text).group(1))
    res = client.post(
        action,
        data={"username": username, "password": PASSWORD, "credentialId": ""},
        follow_redirects=True,
    )
    session_id = client.cookies.get("session_id")
    if not session_id:
        fail(f"no session cookie after login (landed on {res.url}, HTTP {res.status_code})")
    step(f"Keycloak -> callback -> session cookie set, landed on {res.url}")
    return session_id


BET_STEPS = ["BET_RECEIVED", "BET_AI_REVIEWING", "BET_AI_REVIEWED", "BET_CREATED"]


async def ws_collect_bet(session_id: str, trigger) -> list[dict]:
    """Run `trigger` and collect the bet pipeline frames up to BET_CREATED / BET_FAILED."""

    ws_url = UI.replace("http", "ws", 1) + "/api/v1/ws?device_id=live-check"
    async with websockets.connect(ws_url, additional_headers={"cookie": f"session_id={session_id}"}) as ws:
        hello = json.loads(await asyncio.wait_for(ws.recv(), 5))
        if hello.get("event") != "connected":
            fail(f"unexpected ws hello {hello}")
        step(f"WebSocket connected as {hello['data']['player_id']}")
        task = asyncio.create_task(asyncio.to_thread(trigger))
        frames = []
        while True:
            frame = json.loads(await asyncio.wait_for(ws.recv(), 30))
            if frame.get("event", "").startswith("BET_"):
                frames.append(frame)
                if frame["event"] in ("BET_CREATED", "BET_FAILED"):
                    break
        await task
        return frames


def main() -> None:
    print(f"Live login check against {UI} as {USERNAME}")
    with httpx.Client(timeout=20) as client:
        if client.get(f"{UI}/api/state").status_code != 401:
            fail("/api/state must require a session")
        step("anonymous /api/state -> 401")

        session_id = browser_login(client)

        me = client.get(f"{UI}/api/v1/system/me").json()
        player_id = me["user"]["player_id"]
        step(f"/me -> {me['user']['username']} (player_id={player_id})")

        state = client.get(f"{UI}/api/state").json()
        if player_id not in [p["id"] for p in state["players"]]:
            fail(f"{player_id} is not seated in the ring")
        step(f"seated in the ring with {len(state['players'])} player(s)")

        def spoofed_create():
            res = client.post(
                f"{UI}/api/markets",
                json={"question": "LIVE CHECK: will this pass?", "archetype": "simple", "proposer_id": "bob"},
            )
            if res.status_code != 200:
                fail(f"market creation failed: {res.status_code} {res.text[:200]}")
            proposer = res.json()["market"]["proposer_id"]
            if proposer != player_id:
                fail(f"market proposed 'as bob' was created by {proposer}")
            step(f"market sent with proposer_id='bob' was created by {proposer}")

        frames = asyncio.run(ws_collect_bet(session_id, spoofed_create))
        events = [f["event"] for f in frames]
        if events != BET_STEPS:
            fail(f"bet pipeline over WebSocket was {events}, expected {BET_STEPS}")
        review = frames[2]["data"]
        step(f"WebSocket streamed {' -> '.join(events)}")
        step(
            f"AI review ({review['mode']}, {review['model']}, {review['latency_ms']} ms): "
            f"{review['review']['summary']} fair value={review['review']['fair_value']}"
        )
        market_id = frames[3]["data"]["market_id"]

    # Another player trades on the new bet
    with httpx.Client(timeout=20) as other:
        browser_login(other, OTHER_USERNAME)
        res = other.post(f"{UI}/api/markets/{market_id}/take", json={"side": "YES", "amount": 1})
        if res.status_code != 200:
            fail(f"{OTHER_USERNAME} could not trade on the new bet: {res.status_code} {res.text[:200]}")
        positions = [
            p for p in other.get(f"{UI}/api/state", params={"marketId": market_id}).json()["activeBundle"]["positions"]
            if p.get("player_id") == OTHER_USERNAME
        ]
        if not positions:
            fail(f"{OTHER_USERNAME}'s trade left no position on {market_id}")
        step(f"{OTHER_USERNAME} traded on {player_id}'s bet ({len(positions)} position(s))")
        other.post(f"{UI}/api/v1/system/logout")

    with httpx.Client(timeout=20) as client:
        client.cookies.set("session_id", session_id)

        if client.post(f"{UI}/api/v1/system/logout").status_code != 204:
            fail("logout failed")
        if client.get(f"{UI}/api/state").status_code != 401:
            fail("session still valid after logout")
        step("logout -> session revoked")
    print("ALL LIVE CHECKS PASSED")


if __name__ == "__main__":
    main()
