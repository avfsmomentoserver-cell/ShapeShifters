"""The predictor must be armed by any complete tape, not only by a live round.

The defect these pin: a committed forecast was locked only inside the
single-round ingest path, so a workspace whose tape arrived by demo seed, paste
import, reseed or database ingest showed "warming up" forever while the engine
already had everything it needed. These tests drive the real app through
TestClient against a throwaway database so the whole chain — seed, arm, resolve —
is exercised, not just the helper.
"""
from __future__ import annotations

import importlib
import os
import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    """A fresh app on its own SQLite file, so tests never touch the dev tape."""
    os.environ["MOMENTO_DB"] = str(tmp_path_factory.mktemp("db") / "test.db")
    from momento import db as db_mod

    importlib.reload(db_mod)
    from momento import api as api_mod

    importlib.reload(api_mod)
    with TestClient(api_mod.app) as c:
        yield c


def head(v: str) -> dict:
    return {"X-Visitor-Id": v}


def fresh() -> str:
    return f"t-{uuid.uuid4().hex[:10]}"


def test_a_freshly_seeded_workspace_is_already_armed(client):
    """First paint, feed never started: the forecast must already be committed."""
    v = fresh()
    r = client.get("/api/ledger", headers=head(v))
    assert r.status_code == 200
    open_ = r.json()["open"]
    assert open_ is not None, "a seeded tape left the predictor warming up"
    assert open_["actual"] is None
    assert open_["band"][0] >= 1.0
    assert 0.0 < open_["probability"] <= 1.0
    assert open_["lockedAt"]


def test_every_surface_reports_the_same_open_forecast(client):
    """Forecast, summary and ledger must not each mint their own commitment."""
    v = fresh()
    ids = {
        client.get("/api/forecast", headers=head(v)).json()["open"]["id"],
        client.get("/api/stats/summary", headers=head(v)).json()["ledger"]["open"]["id"],
        client.get("/api/ledger", headers=head(v)).json()["open"]["id"],
    }
    assert len(ids) == 1


def test_reading_twice_does_not_re_lock_the_forecast(client):
    """Re-locking on every read would reset the commit time and erase the audit."""
    v = fresh()
    first = client.get("/api/ledger", headers=head(v)).json()["open"]
    again = client.get("/api/ledger", headers=head(v)).json()["open"]
    assert first["id"] == again["id"]
    assert first["lockedAt"] == again["lockedAt"]


def test_a_pasted_import_arms_the_predictor(client):
    v = fresh()
    body = {"multipliers": [1.2, 3.4, 1.05, 9.9, 2.1, 1.5, 4.2, 1.01, 2.8, 15.3, 1.1, 6.6],
            "mode": "replace"}
    r = client.post("/api/rounds/bulk", json=body, headers=head(v))
    assert r.status_code == 200
    assert r.json()["locked"] is not None
    assert client.get("/api/ledger", headers=head(v)).json()["open"] is not None


def test_a_reseed_arms_the_predictor_on_the_new_tape(client):
    v = fresh()
    before = client.get("/api/ledger", headers=head(v)).json()["open"]["id"]
    r = client.post("/api/rounds/reseed?count=200", headers=head(v))
    assert r.status_code == 200
    after = r.json()["locked"]
    assert after is not None
    assert after["id"] != before, "the stale forecast survived a tape replacement"


def test_an_armed_forecast_resolves_against_the_next_real_round(client):
    """The committed forecast must be scored by reality, and a new one committed."""
    v = fresh()
    armed = client.get("/api/ledger", headers=head(v)).json()["open"]
    r = client.post("/api/rounds", json={"multiplier": 7.77}, headers=head(v))
    assert r.status_code == 200
    payload = r.json()
    assert payload["resolved"] >= 1
    assert payload["locked"] is not None
    assert payload["locked"]["id"] != armed["id"]

    ledger = client.get("/api/ledger", headers=head(v)).json()
    assert ledger["resolvedCount"] >= 1
    scored = next(e for e in ledger["entries"] if e["id"] == armed["id"])
    assert scored["actual"] == pytest.approx(7.77)
    assert scored["hit2"] is True
    assert scored["hit10"] is False
    assert scored["brier"] is not None
    assert scored["bandHit"] == (scored["band"][0] <= 7.77 <= scored["band"][1])


def test_the_arm_endpoint_is_idempotent_unless_forced(client):
    v = fresh()
    a = client.post("/api/predictions/arm", headers=head(v)).json()["open"]
    b = client.post("/api/predictions/arm", headers=head(v)).json()["open"]
    assert a["id"] == b["id"]
    c = client.post("/api/predictions/arm?force=true", headers=head(v)).json()["open"]
    assert c["id"] != a["id"]
    # forcing must not leave two open commitments behind
    entries = client.get("/api/ledger", headers=head(v)).json()["entries"]
    assert sum(1 for e in entries if e["actual"] is None) == 1


def test_a_tape_too_short_to_forecast_says_so_instead_of_pretending(client):
    v = fresh()
    client.delete("/api/rounds", headers=head(v))
    client.post("/api/rounds/bulk", json={"multipliers": [1.2, 2.3, 4.5], "mode": "replace"},
                headers=head(v))
    r = client.post("/api/predictions/arm?force=true", headers=head(v))
    assert r.status_code == 400
    assert "10 rounds" in r.json()["detail"]


def test_the_armed_forecast_appears_in_the_entries_list_on_the_first_read(client):
    """Arming must happen before the list is built, not after.

    The list was assembled first and the forecast armed second, so the very first
    read of a workspace returned an `open` forecast that was missing from
    `entries` — and a client deriving the open forecast from the list showed the
    predictor as unarmed on exactly the first paint that mattered.
    """
    v = fresh()
    d = client.get("/api/ledger", headers=head(v)).json()
    assert d["open"] is not None
    assert any(e["id"] == d["open"]["id"] for e in d["entries"])


def test_the_summary_counts_the_forecast_it_reports_as_open(client):
    v = fresh()
    led = client.get("/api/stats/summary", headers=head(v)).json()["ledger"]
    assert led["open"] is not None
    assert led["locked"] >= 1, "reported an open forecast while counting zero locked"
