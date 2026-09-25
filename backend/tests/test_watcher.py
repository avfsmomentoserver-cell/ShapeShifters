"""The watcher must feed each archived round exactly once, with its own time.

The defect these pin: _scan only recorded *grown* files in the seen-cache, so
every archive file created after the watcher's first run stayed unseen forever
and was re-parsed + re-ingested on every 1-second poll. The tape filled with
old rounds stamped by the ingest clock (~1 row/s sustained) while the real
feed produces one round every 15-30 s — every statistic computed from the
tape was therefore wrong, not just noisy.
"""
from __future__ import annotations

import asyncio
import importlib
import json
import os
import uuid

import pytest

from momento import watcher


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    """A fresh SQLite file so tests never touch the dev tape."""
    monkeypatch.setenv("MOMENTO_DB", str(tmp_path / "test.db"))
    from momento import db as db_mod

    importlib.reload(db_mod)
    db_mod.init_db()
    yield db_mod


@pytest.fixture()
def clean_seen(monkeypatch, tmp_path):
    """An empty seen-cache, persisted to a throwaway path."""
    monkeypatch.setattr(watcher, "_seen", {})
    monkeypatch.setattr(watcher, "_seen_path", lambda: tmp_path / "seen.json")
    monkeypatch.setattr(watcher, "_seen_dirty", False)
    return watcher


def archive_file(directory, name: str, multiplier: float, stamp: str) -> None:
    payload = {
        "source": "aviator",
        "collectedAt": stamp,
        "rounds": [{"timestamp": stamp, "multiplier": multiplier, "source": "aviator"}],
    }
    (directory / name).write_text(json.dumps(payload), encoding="utf-8")


def test_normalize_ts_forms():
    z = "2026-09-25T01:30:37.708Z"
    assert watcher._normalize_ts(z) == "2026-09-25T01:30:37.708000+00:00"
    assert watcher._normalize_ts("2026-09-25T01:30:37") == "2026-09-25T01:30:37+00:00"
    assert watcher._normalize_ts("not a date") is None
    assert watcher._normalize_ts("") is None
    assert watcher._normalize_ts(None) is None


def test_new_files_ingested_once_with_real_timestamps(temp_db, clean_seen, tmp_path, monkeypatch):
    """Two scans of the same new files must insert each round exactly once,
    carrying the round's own timestamp — not the ingest clock."""
    d = tmp_path / "downloads"
    d.mkdir()
    archive_file(d, "momento_rounds_aviator_1.json", 3.09, "2026-09-25T01:30:37.708Z")
    archive_file(d, "momento_rounds_aviator_2.json", 1.10, "2026-09-25T01:30:14.146Z")

    seen_calls: list[tuple[float, str | None]] = []

    async def fake_ingest(visitor, multiplier, source, ts=None):
        seen_calls.append((multiplier, ts))
        return {}

    monkeypatch.setattr("momento.api._ingest", fake_ingest)

    # first poll: both files found, marks handed back to the caller
    first = watcher._scan(d)
    assert len(first) == 2
    n1 = asyncio.run(watcher._ingest_rounds("local", [r for _, rounds, _ in first for r in rounds]))
    for path, _, seen in first:
        watcher._seen[str(path)] = seen
        watcher._seen_dirty = True
    assert n1 == 2
    assert sorted(seen_calls) == [(1.10, "2026-09-25T01:30:14.146000+00:00"),
                                  (3.09, "2026-09-25T01:30:37.708000+00:00")]

    # second poll immediately after: the same files are unchanged, nothing new
    assert watcher._scan(d) == []

    # the failure mode being pinned: a poll that ingests but does NOT mark
    # (a crash in between) must not duplicate on the next poll. The rounds are
    # on the tape (the first poll committed them via the real pipeline in
    # test_ingest_rounds_skips_rounds_already_on_tape); replaying the file must
    # dedupe round-by-round.
    temp_db.insert_round(3.09, ts="2026-09-25T01:30:37.708000+00:00")
    del watcher._seen[str(d / "momento_rounds_aviator_1.json")]
    rescan = watcher._scan(d)
    assert len(rescan) == 1
    seen_calls.clear()
    n2 = asyncio.run(watcher._ingest_rounds("local", rescan[0][1]))
    assert n2 == 0 and seen_calls == []  # deduped round-by-round


def test_grown_file_takes_only_the_tail(temp_db, clean_seen, tmp_path):
    d = tmp_path / "downloads"
    d.mkdir()
    path = d / "live_tail.jsonl"
    path.write_text('{"multiplier": 1.5, "timestamp": "2026-09-25T02:00:00Z"}\n', encoding="utf-8")
    first = watcher._scan(d)
    assert len(first) == 1
    for p, _, seen in first:
        watcher._seen[str(p)] = seen

    path.write_text(
        '{"multiplier": 1.5, "timestamp": "2026-09-25T02:00:00Z"}\n'
        '{"multiplier": 7.25, "timestamp": "2026-09-25T02:00:30Z"}\n',
        encoding="utf-8",
    )
    grown = watcher._scan(d)
    assert len(grown) == 1
    rounds = grown[0][1]
    assert [r["multiplier"] for r in rounds] == [7.25]


def test_ingest_rounds_skips_rounds_already_on_tape(temp_db, clean_seen):
    """The dedup is a real DB check, not just scan bookkeeping."""
    db = temp_db
    db.insert_round(2.5, ts="2026-09-25T03:00:00+00:00")
    rounds = [{"multiplier": 2.5, "timestamp": "2026-09-25T03:00:00Z"}]
    n = asyncio.run(watcher._ingest_rounds("local", rounds))
    assert n == 0
    assert db.count_rounds() == 1
