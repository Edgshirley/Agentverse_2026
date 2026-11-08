import json

import httpx
import pytest

from src.backend.gemini import GEMINI
from src.config import config
from tests.conftest import login

BET = {
    "question": "Will it rain in Paris on Saturday?",
    "archetype": "simple",
    "unit": "%",
    "bounds": [0, 100],
    "criteria": "",
    "resolution_source": "",
    "live_implied_value": 50,
    "proposer_id": "bob",
}


def events(stack):
    return [e["type"] for e in stack["bus_events"]]


def market_calls(stack):
    return [c for c in stack["engine_calls"] if c["path"] == "/api/markets"]


@pytest.fixture
def live_gemini(monkeypatch):
    """Switch to live mode with a fake Gemini endpoint; yields the captured requests."""

    calls: list[httpx.Request] = []
    reply = {"status": 200, "review": None}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if reply["status"] != 200:
            return httpx.Response(reply["status"], json={"error": {"message": "quota"}})
        text = json.dumps(reply["review"])
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": text}]}}]},
        )

    monkeypatch.setattr(config, "GEMINI_API", "test-key")
    monkeypatch.setattr(config, "GEMINI_MODEL", "gemini-3.8-flash")
    monkeypatch.setattr(
        GEMINI,
        "_client",
        httpx.AsyncClient(
            transport=httpx.MockTransport(handler),
            base_url="https://generativelanguage.googleapis.com/v1beta",
        ),
    )
    yield calls, reply


def test_simulated_review_streams_every_step_and_creates_the_bet(stack):
    login(stack, "alice")
    res = stack["client"].post("/api/markets", json=BET)
    assert res.status_code == 200, res.text
    body = res.json()

    assert events(stack) == ["BET_RECEIVED", "BET_AI_REVIEWING", "BET_AI_REVIEWED", "BET_CREATED"]
    bet_ids = {e["data"]["bet_id"] for e in stack["bus_events"]}
    assert len(bet_ids) == 1
    reviewing = stack["bus_events"][1]["data"]
    assert reviewing["mode"] == "simulated"
    assert stack["bus_events"][3]["data"]["market_id"] == "mkt_1"

    assert body["market"]["id"] == "mkt_1"
    assert body["ai_review"]["mode"] == "simulated"

    created = market_calls(stack)[-1]["body"]
    assert created["proposer_id"] == "alice"  # identity still bound
    assert created["criteria"]  # blank criteria filled by the review
    assert created["fair_value_source"] == "AI_ADVISORY"


def test_live_review_calls_gemini_and_applies_the_fair_value(stack, live_gemini):
    calls, reply = live_gemini
    reply["review"] = {
        "summary": "Paris in November: rain is likely.",
        "fair_value": 140,  # out of bounds: must be clamped
        "criteria": "YES if Météo-France records any rain in Paris on Saturday.",
        "resolution_source": "Météo-France",
        "verdict": "ok",
        "flags": [],
    }
    login(stack, "alice")
    res = stack["client"].post("/api/markets", json=BET)
    assert res.status_code == 200, res.text

    assert len(calls) == 1
    request = calls[0]
    assert request.url.path.endswith("/models/gemini-3.8-flash:generateContent")
    assert request.headers["x-goog-api-key"] == "test-key"
    sent = json.loads(request.content)
    assert sent["generationConfig"]["responseMimeType"] == "application/json"
    assert "Will it rain in Paris" in sent["contents"][0]["parts"][0]["text"]
    assert "proposer_id" not in sent["contents"][0]["parts"][0]["text"]

    created = market_calls(stack)[-1]["body"]
    assert created["live_implied_value"] == 100  # clamped to bounds
    assert created["criteria"].startswith("YES if Météo-France")
    reviewed = stack["bus_events"][2]["data"]
    assert reviewed["mode"] == "live"
    assert reviewed["review"]["summary"] == "Paris in November: rain is likely."


def test_live_review_keeps_player_criteria(stack, live_gemini):
    _calls, reply = live_gemini
    reply["review"] = {
        "summary": "ok",
        "fair_value": 30,
        "criteria": "model criteria",
        "resolution_source": "model source",
        "verdict": "ok",
        "flags": [],
    }
    login(stack, "alice")
    stack["client"].post(
        "/api/markets", json={**BET, "criteria": "Mine", "resolution_source": "Group"}
    )
    created = market_calls(stack)[-1]["body"]
    assert created["criteria"] == "Mine"
    assert created["resolution_source"] == "Group"
    assert created["live_implied_value"] == 30


def test_gemini_failure_falls_back_and_still_creates_the_bet(stack, live_gemini):
    _calls, reply = live_gemini
    reply["status"] = 429
    login(stack, "alice")
    res = stack["client"].post("/api/markets", json=BET)
    assert res.status_code == 200
    assert res.json()["ai_review"]["mode"] == "fallback"
    assert "429" in res.json()["ai_review"]["error"]
    assert events(stack)[-1] == "BET_CREATED"


def test_engine_rejection_is_streamed_as_bet_failed(stack):
    stack["engine_state"]["reject_markets"] = True
    login(stack, "alice")
    res = stack["client"].post("/api/markets", json=BET)
    assert res.status_code == 400
    assert res.json()["error"] == "Bounds are inverted"
    assert events(stack)[-1] == "BET_FAILED"
    assert stack["bus_events"][-1]["data"]["error"] == "Bounds are inverted"


@pytest.mark.parametrize("question", ["", "   ", "x" * 501])
def test_bad_questions_are_rejected_before_any_ai_call(stack, question):
    login(stack, "alice")
    res = stack["client"].post("/api/markets", json={**BET, "question": question})
    assert res.status_code == 400
    assert stack["bus_events"] == []
    assert market_calls(stack) == []


def test_bets_require_a_session(stack):
    res = stack["client"].post("/api/markets", json=BET)
    assert res.status_code == 401
    assert stack["bus_events"] == []


def test_other_players_can_trade_on_the_new_bet(stack):
    login(stack, "alice")
    stack["client"].post("/api/markets", json=BET)
    stack["client"].post("/api/v1/system/logout")

    login(stack, "bob")
    res = stack["client"].post(
        "/api/markets/mkt_1/take", json={"side": "YES", "amount": 1, "playerId": "alice"}
    )
    assert res.status_code == 200
    take = stack["engine_calls"][-1]
    assert take["path"] == "/api/markets/mkt_1/take"
    assert take["body"]["playerId"] == "bob"
