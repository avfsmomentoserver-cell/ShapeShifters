"""Schema migrations must actually reach databases that already exist.

create_all() only creates absent tables, so a change to an existing table is
invisible to it. These tests build a database with the old schema by hand, run
the migration, and check both that the data survived and that the defect the
change was meant to close is really closed.
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3

import pytest

LEGACY_PREDICTIONS = """
CREATE TABLE predictions (
    id INTEGER NOT NULL PRIMARY KEY,
    visitor_id VARCHAR NOT NULL,
    target_round_id INTEGER,
    state VARCHAR NOT NULL,
    band_lo FLOAT NOT NULL,
    band_hi FLOAT NOT NULL,
    probability FLOAT NOT NULL,
    p_above_2 FLOAT NOT NULL,
    p_above_10 FLOAT NOT NULL,
    eta FLOAT,
    actual FLOAT,
    actual_state VARCHAR,
    band_hit BOOLEAN,
    hit_2 BOOLEAN,
    hit_10 BOOLEAN,
    brier FLOAT,
    distribution TEXT,
    drivers TEXT,
    locked_at VARCHAR NOT NULL,
    resolved_at VARCHAR
)
"""


def build_legacy_db(path: str) -> None:
    """A database as an earlier version of the app left it: no AUTOINCREMENT."""
    c = sqlite3.connect(path)
    c.executescript(LEGACY_PREDICTIONS)
    c.executescript("CREATE INDEX ix_predictions_visitor_id ON predictions (visitor_id)")
    c.executescript("""
        CREATE TABLE rounds (
            id INTEGER NOT NULL PRIMARY KEY,
            timestamp VARCHAR NOT NULL,
            multiplier FLOAT NOT NULL,
            band VARCHAR,
            source VARCHAR
        )
    """)
    dist = json.dumps({"Collapse": 0.5, "Shelf": 0.2, "Normal": 0.15, "Ignition": 0.1, "Moonshot": 0.05})
    for i in (1, 2, 3):
        c.execute(
            "INSERT INTO predictions (id, visitor_id, target_round_id, state, band_lo, band_hi,"
            " probability, p_above_2, p_above_10, distribution, drivers, locked_at, actual)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (i, "legacy-user", 100 + i, "Collapse", 1.0, 2.0, 0.51, 0.48, 0.10, dist, "[]",
             f"2026-09-0{i}T00:00:00+00:00", 1.5 if i < 3 else None),
        )
    c.commit()
    c.close()


@pytest.fixture
def migrated(tmp_path):
    """Run the real init_db() against a legacy file and hand back the module."""
    path = tmp_path / "legacy.db"
    build_legacy_db(str(path))
    os.environ["MOMENTO_DB"] = str(path)
    from momento import db as db_mod

    importlib.reload(db_mod)
    db_mod.init_db()
    return db_mod, str(path)


def schema_of(path: str, name: str) -> str:
    c = sqlite3.connect(path)
    try:
        row = c.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()
        return row[0] if row else ""
    finally:
        c.close()


def test_a_legacy_predictions_table_gains_autoincrement(migrated):
    _, path = migrated
    assert "AUTOINCREMENT" in schema_of(path, "predictions").upper()


def test_the_migration_keeps_every_row_and_its_id(migrated):
    db, path = migrated
    rows = db.predictions(visitor="legacy-user")
    assert [r["id"] for r in rows] == [1, 2, 3]
    assert [r["targetRoundId"] for r in rows] == [101, 102, 103]
    assert rows[0]["actual"] == pytest.approx(1.5)
    assert rows[2]["actual"] is None
    assert rows[2]["distribution"]["Collapse"] == pytest.approx(0.5)


def test_the_migration_leaves_no_scaffolding_behind(migrated):
    _, path = migrated
    c = sqlite3.connect(path)
    names = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    c.close()
    assert "predictions_pre_autoincrement" not in names
    assert "predictions" in names


def test_ids_are_no_longer_reused_after_migrating(migrated):
    """The point of the whole exercise: a replaced forecast gets a new identity."""
    db, _ = migrated
    payload = {
        "targetRoundId": 500, "state": "Shelf", "band": [2.0, 3.0], "probability": 0.2,
        "pAbove2": 0.48, "pAbove10": 0.1, "eta": 2.0,
        "distribution": {"Shelf": 0.2, "Collapse": 0.5}, "drivers": [],
    }
    first = db.lock_prediction("legacy-user", payload)
    second = db.lock_prediction("legacy-user", payload)  # deletes the first, then inserts
    assert second["id"] != first["id"], "a replaced forecast inherited the dead one's id"
    assert second["id"] > 3, "new ids must continue past the migrated history"


def test_running_the_migration_again_is_a_no_op(migrated):
    db, path = migrated
    before = schema_of(path, "predictions")
    db.init_db()
    db.init_db()
    assert schema_of(path, "predictions") == before
    assert [r["id"] for r in db.predictions(visitor="legacy-user")] == [1, 2, 3]


def test_an_already_current_database_is_left_alone(tmp_path):
    os.environ["MOMENTO_DB"] = str(tmp_path / "fresh.db")
    from momento import db as db_mod

    importlib.reload(db_mod)
    db_mod.init_db()
    with db_mod._engine.begin() as conn:
        assert db_mod._migrate_predictions_to_autoincrement(conn) is False
