#!/usr/bin/env python3
"""
MarketMate — Dev Environment Python Seeder
Used exclusively by the `seed` container in `docker-compose.dev.yml`.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

API_BASE_URL = os.environ.get("API_BASE_URL", "http://backend:4000").rstrip("/")
MAX_WAIT_SECONDS = int(os.environ.get("SEED_WAIT_TIMEOUT", "60"))


def api_request(method: str, path: str, payload: dict | None = None) -> dict:
    url = f"{API_BASE_URL}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def wait_for_app() -> None:
    print(f"[SEED] Waiting for Citadel Terminal API at {API_BASE_URL}/api/state ...")
    deadline = time.time() + MAX_WAIT_SECONDS
    while time.time() < deadline:
        try:
            state = api_request("GET", "/api/state")
            if state and "group" in state:
                print(
                    f"[SEED] Connected to group '{state['group']['name']}' "
                    f"(stateVersion={state.get('stateVersion')})"
                )
                return
        except Exception:
            pass
        time.sleep(1.5)
    print(f"[SEED] ERROR: Timed out after {MAX_WAIT_SECONDS}s waiting for {API_BASE_URL}", file=sys.stderr)
    sys.exit(1)


def run_seed() -> None:
    wait_for_app()

    # Reset to clean first-person baseline (no fake markets, just YOU with 1,000 TOKS)
    print("[SEED] 01 // Resetting to clean first-person state (/api/demo/reset)...")
    api_request("POST", "/api/demo/reset", {})

    final_state = api_request("GET", "/api/state")
    markets = final_state.get("markets", [])
    players = final_state.get("players", [])

    print("=" * 72)
    print(f"MARKETMATE // CLEAN START READY — {len(players)} PLAYER(S) | {len(markets)} ACTIVE MARKETS")
    print("=" * 72)


if __name__ == "__main__":
    run_seed()
