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
  6. the WebSocket receives the engine's bus event for that trade
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
PASSWORD = os.getenv("LIVE_PASSWORD", "spread123")


def step(msg: str) -> None:
    print(f"  ✓ {msg}")


def fail(msg: str) -> None:
    print(f"  ✗ {msg}", file=sys.stderr)
    sys.exit(1)


def browser_login(client: httpx.Client) -> str:
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
        data={"username": USERNAME, "password": PASSWORD, "credentialId": ""},
        follow_redirects=True,
    )
    session_id = client.cookies.get("session_id")
    if not session_id:
        fail(f"no session cookie after login (landed on {res.url}, HTTP {res.status_code})")
    step(f"Keycloak -> callback -> session cookie set, landed on {res.url}")
    return session_id


async def ws_wait_for_event(session_id: str, trigger) -> dict:
    ws_url = UI.replace("http", "ws", 1) + "/api/v1/ws?device_id=live-check"
    async with websockets.connect(ws_url, additional_headers={"cookie": f"session_id={session_id}"}) as ws:
        hello = json.loads(await asyncio.wait_for(ws.recv(), 5))
        if hello.get("event") != "connected":
            fail(f"unexpected ws hello {hello}")
        step(f"WebSocket connected as {hello['data']['player_id']}")
        await asyncio.to_thread(trigger)
        while True:
            frame = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if frame.get("event") not in ("connected", "pong"):
                return frame


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

        frame = asyncio.run(ws_wait_for_event(session_id, spoofed_create))
        step(f"WebSocket pushed {frame['event']} (stateVersion={frame['data'].get('stateVersion')})")

        if client.post(f"{UI}/api/v1/system/logout").status_code != 204:
            fail("logout failed")
        if client.get(f"{UI}/api/state").status_code != 401:
            fail("session still valid after logout")
        step("logout -> session revoked")
    print("ALL LIVE CHECKS PASSED")


if __name__ == "__main__":
    main()
