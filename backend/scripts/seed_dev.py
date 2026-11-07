#!/usr/bin/env python3
"""
Friend Spreader (Spread) — Dev Environment Python Seeder
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

    # 1. Reset to clean baseline
    print("[SEED] 01 // Resetting deterministic engine state (/api/demo/reset)...")
    api_request("POST", "/api/demo/reset", {})

    # 2. Register additional dev syndicate traders
    for nickname in ["MAX", "ZOE"]:
        res = api_request("POST", "/api/groups/join", {"nickname": nickname})
        player = res.get("player", {})
        print(
            f"[SEED] 02 // Joined dev player {player.get('nickname')} "
            f"(wallet={player.get('wallet_balance_toks')} TOKS)"
        )

    # 3. Run Agent 1 (Intake) -> Agent 2 (Classifier) for a dev spread market
    prompt = "When will Liverpool score first vs Real Madrid? 20 TOKS spread market"
    print(f"[SEED] 03 // Running Agent 1+2 pipeline for: '{prompt}'")
    intake = api_request(
        "POST",
        "/api/agents/intake",
        {"prompt": prompt, "playerId": "max"},
    )
    draft = intake["draft"]
    classification = intake["classification"]

    created = api_request(
        "POST",
        "/api/markets",
        {
            "id": "mkt_ucl_dev",
            "proposer_id": "max",
            "archetype": classification["archetype"],
            "question": draft["question"],
            "unit": draft["unit"],
            "bounds": draft["bounds"],
            "no_event_value": draft["no_event_value"],
            "criteria": draft["criteria"],
            "resolution_source": draft["resolution_source"],
            "payoff_mode": draft["payoff_mode"],
            "lot_stake_k": draft["lot_stake_k"],
            "verifiability": classification["verifiability"],
            "route": classification["route"],
        },
    )
    mkt_id = created["market"]["id"]
    print(f"[SEED] 04 // Created dev spread market '{mkt_id}' in width_auction state")

    # 4. Run width auction bids -> finalize -> quote [28, 38]
    api_request("POST", f"/api/markets/{mkt_id}/auction/bid", {"playerId": "zoe", "width": 16})
    api_request("POST", f"/api/markets/{mkt_id}/auction/bid", {"playerId": "max", "width": 10})
    api_request("POST", f"/api/markets/{mkt_id}/auction/finalize", {})
    api_request("POST", f"/api/markets/{mkt_id}/auction/quote", {"playerId": "max", "L": 28})
    print(f"[SEED] 05 // MAX won MM width auction (w=10) and quoted [28, 38] min")

    # 5. Place 1-tap takes & lock takes to go live
    api_request(
        "POST",
        f"/api/markets/{mkt_id}/take",
        {"playerId": "zoe", "side": "OVER", "amount": 2},
    )
    api_request(
        "POST",
        f"/api/markets/{mkt_id}/take",
        {"playerId": "ben", "side": "UNDER", "amount": 1},
    )
    api_request("POST", f"/api/markets/{mkt_id}/lock-takes", {})

    # 6. Post a standing P2P bid on mkt_ucl_dev
    api_request(
        "POST",
        f"/api/markets/{mkt_id}/p2p/bid",
        {"buyerId": "ana", "side": "OVER", "priceToks": 28},
    )

    # 7. Activate a 3-Part Risk Gate strategy on mkt_weather for ZOE
    api_request(
        "POST",
        "/api/markets/mkt_weather/strategy/activate",
        {
            "player_id": "zoe",
            "input_modality": "voice",
            "raw_transcript": "Put 100 TOKS on YES, take profit at 74%, cut me at 43% floor",
            "parsed_strategy_summary": "YES 100 TOKS | TP @ 74% | FLOOR @ 43%",
            "side": "YES",
            "stake_toks": 100,
            "take_profit_level": 74,
            "min_balance_floor": 43,
            "confirmed_at": int(time.time() * 1000),
        },
    )

    final_state = api_request("GET", "/api/state")
    markets = final_state.get("markets", [])
    players = final_state.get("players", [])

    print("=" * 72)
    print(f"SPREAD // DEV SEED COMPLETE — {len(players)} PLAYERS | {len(markets)} ACTIVE MARKETS")
    for m in markets:
        print(f"  * [{m['id']}] ({m['archetype'].upper()} / {m['state'].upper()}) :: {m['question']}")
    print("=" * 72)


if __name__ == "__main__":
    run_seed()
