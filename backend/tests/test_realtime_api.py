"""The new stats routes: realtime composition, the shape payload, the AI summary.

Driven through the real app, because the value of these endpoints is the wire
shape the frontend consumes and the scoping that keeps one tape out of another.
The AI route is exercised with the gateway stubbed, so no test spends a request.
"""
from __future__ import annotations

import importlib
import json
import os
import random

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    os.environ["MOMENTO_DB"] = str(tmp_path_factory.mktemp("db") / "realtime-api.db")
    from momento import db as db_mod

    importlib.reload(db_mod)
    from momento import api as api_mod

    importlib.reload(api_mod)
    with TestClient(api_mod.app) as c:
        yield c


@pytest.fixture(scope="module")
def seeded(client):
    """A visitor with a real tape on it, ingested through the bulk route.

    One draw per round (inverse CDF): drawing a second uniform for the value
    pushes ~3% of rounds below 1.00x after rounding, and the bulk route filters
    those, so the tape silently came back shorter than what was posted.
    """
    rng = random.Random(21)
    multipliers = []
    for _ in range(700):
        u = rng.random()
        multipliers.append(1.0 if u > 0.97 else 0.97 / max(u, 1e-9))
    resp = client.post("/api/rounds/bulk",
                       json={"multipliers": [round(m, 2) for m in multipliers], "mode": "replace"},
                       headers={"X-Visitor-Id": "rt-api"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["inserted"] == 700, resp.json()
    return "rt-api"


# --------------------------------------------------------------- /stats/realtime

def test_realtime_route_composes_both_tiers(client, seeded):
    body = client.get("/api/stats/realtime", headers={"X-Visitor-Id": seeded}).json()

    # The cheap tier, recomputed on every round.
    assert body["realtime"]["label"] == "live"
    assert body["realtime"]["rounds"] >= 700
    assert 1.0 <= body["realtime"]["target"]["median"]

    # The scheduled tier, reported with its own cost and freshness.
    assert body["baseline"]["rounds"] >= 700
    assert isinstance(body["baseline"]["fresh"], bool)
    assert "payload" in body["baseline"], "the heavy payload must be reachable"

    # And the delta that shows the two are layered, not merged.
    assert "roundsApart" in body["delta"]


def test_realtime_route_is_scoped_per_visitor(client, seeded):
    other = client.get("/api/stats/realtime", headers={"X-Visitor-Id": "someone-else"}).json()
    mine = client.get("/api/stats/realtime", headers={"X-Visitor-Id": seeded}).json()
    assert other["realtime"]["rounds"] != mine["realtime"]["rounds"]


# ------------------------------------------------------------------ /stats/shape

def test_shape_route_returns_a_drawable_projection_with_etas(client, seeded):
    body = client.get("/api/stats/shape", headers={"X-Visitor-Id": seeded}).json()

    assert body["horizon"] > 0
    assert len(body["projected"]) == len(body["realized"]) == body["samples"]
    assert body["eta"], "the ETAs are the shape read as time"
    assert all(0.0 <= p["p"] <= 1.0 for p in body["projected"])
    assert body["shape"]["family"]


def test_reseed_invalidates_the_cached_heavy_tier(client):
    """After a reseed the baseline must describe the new tape, not the old one."""
    from momento import realtime

    # Warm a baseline against the current (900-round) seed tape.
    first = client.get("/api/stats/realtime", headers={"X-Visitor-Id": "reseed-visitor"}).json()
    before = first["baseline"]["rounds"]
    assert before >= 900
    assert realtime.baseline_fresh("reseed-visitor") is True

    # Replace it with a deliberately shorter tape.
    resp = client.post("/api/rounds/reseed", params={"count": 120},
                       headers={"X-Visitor-Id": "reseed-visitor"})
    assert resp.status_code == 200, resp.text

    after = client.get("/api/stats/realtime", headers={"X-Visitor-Id": "reseed-visitor"}).json()
    assert after["baseline"]["rounds"] == 120, "the baseline must be re-measured on the new tape"
    assert after["delta"]["roundsApart"] >= 0


def test_bulk_replace_invalidates_the_cached_heavy_tier(client):
    from momento import realtime

    client.get("/api/stats/realtime", headers={"X-Visitor-Id": "bulk-replace-visitor"})
    assert realtime.baseline_fresh("bulk-replace-visitor") is True

    client.post("/api/rounds/bulk",
                json={"multipliers": [2.0] * 150, "mode": "replace"},
                headers={"X-Visitor-Id": "bulk-replace-visitor"})

    body = client.get("/api/stats/realtime", headers={"X-Visitor-Id": "bulk-replace-visitor"}).json()
    assert body["baseline"]["rounds"] == 150
    assert body["delta"]["roundsApart"] >= 0


def test_shape_route_refuses_a_tape_it_cannot_fit(client):
    """422 rather than a curve fitted to a handful of rounds.

    A fresh visitor is auto-seeded with 900 rounds, so the short tape has to be
    constructed explicitly by replacing it with a handful.
    """
    short = client.post("/api/rounds/bulk",
                        json={"multipliers": [1.2, 3.4, 1.1], "mode": "replace"},
                        headers={"X-Visitor-Id": "short-shape"})
    assert short.status_code == 200, short.text

    resp = client.get("/api/stats/shape", headers={"X-Visitor-Id": "short-shape"})
    assert resp.status_code == 422
    assert "30 rounds" in resp.json()["detail"]


# ----------------------------------------------------------------- /stats/baseline

def test_baseline_route_publishes_only_the_scheduled_tier(client, seeded):
    body = client.get("/api/stats/baseline", headers={"X-Visitor-Id": seeded}).json()
    # Freshness metadata, then the heavy payload itself.
    assert body["rounds"] >= 700
    assert "fresh" in body
    heavy = body["payload"]
    assert set(["randomness", "skill", "diagnostics", "droughts"]).issubset(heavy.keys())
    assert "verdict" in heavy["randomness"]["overall"]


# ---------------------------------------------------------------- the AI summary

def test_ai_status_never_leaks_the_key(client):
    body = client.get("/api/stats/ai-status").json()
    assert "apiKey" not in json.dumps(body)
    assert body["baseUrl"].startswith("https://")
    assert isinstance(body["configured"], bool)


def test_ai_summary_route_degrades_without_spending_a_request(client, seeded, monkeypatch):
    from momento import ai_summary

    calls: list = []
    monkeypatch.setattr(ai_summary, "config", lambda: {
        "apiKey": "", "baseUrl": ai_summary.DEFAULT_BASE_URL, "model": ai_summary.DEFAULT_MODEL})
    monkeypatch.setattr(ai_summary, "_post", lambda cfg, m: calls.append(m) or {})
    monkeypatch.setattr(ai_summary, "_CACHE", {})

    body = client.get("/api/stats/ai-summary", headers={"X-Visitor-Id": seeded}).json()
    assert body["available"] is False
    assert "ENTRIM_API_KEY" in body["reason"]
    assert calls == []


def test_ai_summary_route_returns_a_guarded_summary(client, seeded, monkeypatch):
    from momento import ai_summary

    monkeypatch.setattr(ai_summary, "config", lambda: {
        "apiKey": "sk-test", "baseUrl": ai_summary.DEFAULT_BASE_URL, "model": "test-model"})
    monkeypatch.setattr(ai_summary, "_CACHE", {})
    monkeypatch.setattr(ai_summary, "_post", lambda cfg, m: {
        "choices": [{"message": {"content": json.dumps({
            "headline": "Measured distribution of the next round",
            "body": ["Median 1.94x, p90 9.8x over the recent window."],
            "watch": ["tenor of the tail index"],
        })}}]})

    body = client.get("/api/stats/ai-summary",
                      params={"force": True}, headers={"X-Visitor-Id": seeded}).json()
    assert body["available"] is True
    assert body["headline"] == "Measured distribution of the next round"
    assert body["guard"]["passed"] is True
    assert body["model"] == "test-model"
