"""Ingesting a database must not require knowing its schema.

The inspect step already reported candidates, but the commit step demanded an
explicit table and column — which means any caller that has not first walked the
report by hand (a script, a cron, a user who just wants their file read) could not
ingest at all. These tests drive the real routes and pin that omitting the table
and column makes the server choose, and that it says out loud what it chose.
"""
from __future__ import annotations

import datetime as dt
import importlib
import json
import math
import os
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    os.environ["MOMENTO_DB"] = str(tmp_path_factory.mktemp("db") / "ingest-api.db")
    from momento import db as db_mod

    importlib.reload(db_mod)
    from momento import api as api_mod

    importlib.reload(api_mod)
    with TestClient(api_mod.app) as c:
        yield c


def tape(n: int, seed: int = 11) -> list[float]:
    import random
    rng = random.Random(seed)
    return [math.floor(max(1.0, 0.97 / max(rng.random(), 1e-12)) * 100) / 100 for _ in range(n)]


def hundredths_db(path: str, values: list[float]) -> str:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE game_rounds (id INTEGER PRIMARY KEY, round_no INTEGER, "
                 "crash_point INTEGER, bet_total REAL, ended_at INTEGER)")
    base = dt.datetime(2026, 9, 20, 8, 0, 0, tzinfo=dt.timezone.utc)
    conn.executemany(
        "INSERT INTO game_rounds (round_no, crash_point, bet_total, ended_at) VALUES (?,?,?,?)",
        [(9000 + i, int(round(m * 100)), 250.0,
          int((base + dt.timedelta(seconds=19 * i)).timestamp() * 1000))
         for i, m in enumerate(values)],
    )
    conn.commit()
    conn.close()
    return path


def json_db(path: str, values: list[float]) -> str:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY, seen_at INTEGER, payload TEXT)")
    base = dt.datetime(2026, 9, 20, 8, 0, 0, tzinfo=dt.timezone.utc)
    conn.executemany(
        "INSERT INTO events (seen_at, payload) VALUES (?,?)",
        [(int((base + dt.timedelta(seconds=20 * i)).timestamp() * 1000),
          json.dumps({"crash_point": m, "bet_total": 300 + i}))
         for i, m in enumerate(values)],
    )
    conn.commit()
    conn.close()
    return path


def stage(client, path: str, visitor: str) -> dict:
    with open(path, "rb") as fh:
        r = client.post("/api/ingest/db/inspect", files={"file": ("scrape.db", fh.read())},
                        headers={"X-Visitor-Id": visitor})
    assert r.status_code == 200, r.text
    return r.json()


def fresh() -> str:
    return f"i-{uuid.uuid4().hex[:10]}"


def test_ingest_without_a_table_or_column_picks_one_and_explains_it(client, tmp_path):
    v = fresh()
    staged = stage(client, hundredths_db(str(tmp_path / "a.db"), tape(900)), v)
    r = client.post("/api/ingest/db", json={"uploadId": staged["uploadId"], "limit": 5000},
                    headers={"X-Visitor-Id": v})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["auto"]["table"] == "game_rounds"
    assert body["auto"]["column"] == "crash_point"
    assert body["auto"]["scale"] == 0.01          # integer hundredths, converted
    assert body["auto"]["why"]
    assert body["inserted"] == 900
    # and the scale really was applied, not just reported
    assert 1.5 <= body["preview"]["median"] <= 2.5


def test_auto_ingest_reads_a_json_column(client, tmp_path):
    v = fresh()
    staged = stage(client, json_db(str(tmp_path / "b.db"), tape(400)), v)
    r = client.post("/api/ingest/db", json={"uploadId": staged["uploadId"], "limit": 5000},
                    headers={"X-Visitor-Id": v})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["auto"]["column"] == "payload.crash_point"
    assert body["inserted"] == 400


def test_an_explicit_choice_still_overrides_the_detector(client, tmp_path):
    v = fresh()
    staged = stage(client, hundredths_db(str(tmp_path / "c.db"), tape(300)), v)
    r = client.post("/api/ingest/db", json={
        "uploadId": staged["uploadId"], "table": "game_rounds", "column": "crash_point",
        "scale": 0.01, "limit": 5000, "dryRun": True,
    }, headers={"X-Visitor-Id": v})
    assert r.status_code == 200, r.text
    assert r.json()["auto"] is None


def test_auto_ingest_refuses_a_database_with_nothing_tape_shaped(client, tmp_path):
    v = fresh()
    path = str(tmp_path / "d.db")
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE config (key TEXT, value TEXT)")
    conn.executemany("INSERT INTO config VALUES (?,?)",
                     [(f"k{i}", f"v{i}") for i in range(50)])
    conn.commit()
    conn.close()
    staged = stage(client, path, v)
    r = client.post("/api/ingest/db", json={"uploadId": staged["uploadId"]},
                    headers={"X-Visitor-Id": v})
    assert r.status_code == 400
    assert "manually" in r.json()["detail"]


def test_an_auto_ingest_arms_a_forecast(client, tmp_path):
    v = fresh()
    staged = stage(client, hundredths_db(str(tmp_path / "e.db"), tape(500)), v)
    r = client.post("/api/ingest/db", json={"uploadId": staged["uploadId"], "limit": 5000},
                    headers={"X-Visitor-Id": v})
    assert r.status_code == 200, r.text
    assert r.json()["locked"] is not None
    led = client.get("/api/ledger", headers={"X-Visitor-Id": v}).json()
    assert led["open"] is not None
