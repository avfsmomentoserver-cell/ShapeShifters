"""Tests for SQLite ingest.

The point of these is that a wrong column is worse than no data: it produces
confident nonsense on every other page. So the detector is tested against the
shapes real scraper databases take — floats, integer hundredths, strings with an
'x' suffix, unix-millisecond clocks — and against decoys (an autoincrement id, a
stake column) that look numeric but are not a tape.
"""
from __future__ import annotations

import datetime as dt
import math
import os
import sqlite3
import tempfile

import pytest

from momento import ingest


def fair_tape(n: int, edge: float = 0.03, seed: int = 7) -> list[float]:
    """Deterministic fair crash tape: 1/U scaled by the edge."""
    import random
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        u = rng.random()
        out.append(math.floor(max(1.0, (1 - edge) / max(u, 1e-12)) * 100) / 100)
    return out


def build_db(path: str, tape: list[float], *, scale: float = 1.0, as_text: bool = False,
             ts_mode: str = "iso", step_seconds: int = 18) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE rounds (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER, "
        "multiplier NUMERIC, stake REAL, timestamp TEXT)"
    )
    conn.execute("CREATE TABLE settings (key TEXT, value TEXT)")
    conn.execute("INSERT INTO settings VALUES ('operator', 'aviator')")
    end = dt.datetime(2026, 9, 20, 12, 0, 0, tzinfo=dt.timezone.utc)
    rows = []
    for i, m in enumerate(tape):
        when = end - dt.timedelta(seconds=step_seconds * (len(tape) - 1 - i))
        if ts_mode == "iso":
            ts: object = when.isoformat()
        elif ts_mode == "unix_ms":
            ts = int(when.timestamp() * 1000)
        elif ts_mode == "unix_s":
            ts = int(when.timestamp())
        else:
            ts = None
        value: object
        if as_text:
            value = f"{m:.2f}x"
        elif scale != 1.0:
            value = int(round(m / scale))
        else:
            value = m
        rows.append((1000 + i, value, 10.0, ts))
    conn.executemany("INSERT INTO rounds (game_id, multiplier, stake, timestamp) VALUES (?,?,?,?)", rows)
    conn.commit()
    conn.close()


@pytest.fixture()
def tmp_db(tmp_path):
    def make(**kwargs):
        path = str(tmp_path / f"scrape-{len(os.listdir(tmp_path))}.db")
        build_db(path, kwargs.pop("tape", fair_tape(600)), **kwargs)
        return path
    return make


# ------------------------------------------------------------------ staging

def test_stage_rejects_a_file_that_is_not_sqlite():
    with pytest.raises(ingest.IngestError, match="not a SQLite database"):
        ingest.stage_upload(b"multiplier,ts\n2.34,1\n", "rounds.csv", "v1")


def test_stage_rejects_an_empty_file():
    with pytest.raises(ingest.IngestError, match="empty"):
        ingest.stage_upload(b"", "rounds.db", "v1")


def test_staged_upload_is_scoped_to_its_workspace(tmp_db):
    with open(tmp_db(), "rb") as fh:
        staged = ingest.stage_upload(fh.read(), "rounds.db", "visitor-a")
    assert ingest.upload_path(staged["uploadId"], "visitor-a")["filename"] == "rounds.db"
    with pytest.raises(ingest.IngestError, match="different workspace"):
        ingest.upload_path(staged["uploadId"], "visitor-b")
    assert ingest.discard_upload(staged["uploadId"]) is True
    with pytest.raises(ingest.IngestError, match="expired"):
        ingest.upload_path(staged["uploadId"], "visitor-a")


def test_ingest_never_writes_to_the_uploaded_file(tmp_db):
    path = tmp_db()
    before = os.stat(path).st_mtime_ns
    ingest.inspect_database(path)
    ingest.extract_rounds(path, "rounds", "multiplier", "timestamp")
    assert os.stat(path).st_mtime_ns == before


# --------------------------------------------------------------- inspection

def test_inspection_recommends_the_multiplier_column_over_id_and_stake(tmp_db):
    report = ingest.inspect_database(tmp_db())
    rec = report["recommendation"]
    assert rec["table"] == "rounds"
    assert rec["column"] == "multiplier"
    assert rec["timestampColumn"] == "timestamp"
    assert rec["scale"] == 1.0
    best = next(t for t in report["tables"] if t["table"] == "rounds")["multiplierCandidates"][0]
    assert best["column"] == "multiplier"
    beaten = {c["column"]: c["score"] for c in
              next(t for t in report["tables"] if t["table"] == "rounds")["multiplierCandidates"]}
    assert beaten["multiplier"] > beaten.get("stake", 0)
    assert beaten["multiplier"] > beaten.get("id", 0)


def test_a_monotonic_counter_is_scored_below_a_real_tape(tmp_db):
    """Regression: scaled by a hundredth, an autoincrement id looks like a tape."""
    rounds = next(t for t in ingest.inspect_database(tmp_db())["tables"] if t["table"] == "rounds")
    by_col = {c["column"]: c for c in rounds["multiplierCandidates"]}
    assert by_col["multiplier"]["monotonic"] is False
    for decoy in ("id", "game_id"):
        if decoy in by_col:
            assert by_col[decoy]["monotonic"] is True
            assert by_col[decoy]["score"] < 0.4
            assert by_col[decoy]["score"] < by_col["multiplier"]["score"] - 0.3


def test_inspection_lists_every_table_with_row_counts(tmp_db):
    report = ingest.inspect_database(tmp_db())
    tables = {t["table"]: t["rows"] for t in report["tables"]}
    assert tables["rounds"] == 600
    assert tables["settings"] == 1


def test_inspection_raises_on_a_database_with_no_tables(tmp_path):
    path = str(tmp_path / "empty.db")
    sqlite3.connect(path).close()
    with pytest.raises(ingest.IngestError, match="no tables"):
        ingest.inspect_database(path)


# ------------------------------------------------------------------- scales

def test_integer_hundredths_are_detected_and_converted(tmp_db):
    path = tmp_db(tape=fair_tape(500), scale=0.01)
    out = ingest.extract_rounds(path, "rounds", "multiplier", "timestamp")
    assert out["scale"] == 0.01
    assert all(1.0 <= v < 100_000 for v in out["values"])
    assert 1.6 < sorted(out["values"])[len(out["values"]) // 2] < 2.4


def test_text_values_with_an_x_suffix_are_parsed(tmp_db):
    out = ingest.extract_rounds(tmp_db(as_text=True), "rounds", "multiplier", "timestamp")
    assert out["accepted"] > 400
    assert out["unreadable"] == 0


def test_explicit_scale_overrides_detection(tmp_db):
    out = ingest.extract_rounds(tmp_db(tape=fair_tape(500), scale=0.01), "rounds", "multiplier",
                                scale=1.0)
    assert out["scale"] == 1.0
    assert min(out["values"]) >= 100  # left as raw hundredths, as asked


@pytest.mark.parametrize("value,expected", [
    (2.34, 2.34), ("2.34x", 2.34), ("1,07", 1.07), (b"3.5", 3.5),
    (None, None), (True, None), ("", None), ("abc", None), (float("nan"), None),
])
def test_number_coercion_handles_the_shapes_scrapers_store(value, expected):
    got = ingest.coerce_number(value)
    assert (got is None and expected is None) or got == pytest.approx(expected)


# --------------------------------------------------------------- timestamps

@pytest.mark.parametrize("mode", ["iso", "unix_ms", "unix_s"])
def test_timestamps_are_parsed_from_every_common_encoding(tmp_db, mode):
    out = ingest.extract_rounds(tmp_db(ts_mode=mode), "rounds", "multiplier", "timestamp")
    assert out["stamped"] == out["accepted"]
    assert out["spanHours"] == pytest.approx(599 * 18 / 3600, abs=0.05)
    assert out["hoursCovered"] >= 3


def test_missing_timestamps_leave_the_clock_unset(tmp_db):
    out = ingest.extract_rounds(tmp_db(ts_mode="none"), "rounds", "multiplier", "timestamp")
    assert out["stamped"] == 0
    assert out["spanHours"] is None


def test_an_all_digit_epoch_string_is_not_read_as_the_year(tmp_db):
    """Regression: fromisoformat reads '1789603200' as the year 1789 in basic format."""
    stamp = ingest.parse_timestamp("1789603200")
    assert stamp is not None
    assert dt.datetime.fromisoformat(stamp).year == 2026


def test_a_bare_year_is_not_mistaken_for_a_clock():
    assert ingest.parse_timestamp(2026) is None
    assert ingest.parse_timestamp(-5) is None
    assert ingest.parse_timestamp("not a date") is None


# ---------------------------------------------------------------- ordering

def test_rounds_come_back_chronological_even_when_taking_the_newest(tmp_db):
    path = tmp_db(tape=fair_tape(600))
    out = ingest.extract_rounds(path, "rounds", "multiplier", "timestamp",
                                limit=100, newest_first=True)
    assert out["accepted"] == 100
    assert out["truncated"] is True
    assert out["tableRows"] == 600
    stamps = [dt.datetime.fromisoformat(s) for s in out["timestamps"]]
    assert stamps == sorted(stamps)
    # the newest row in the table is the last row we returned
    full = ingest.extract_rounds(path, "rounds", "multiplier", "timestamp")
    assert out["values"][-1] == full["values"][-1]


def test_rows_below_one_are_counted_not_silently_dropped(tmp_path):
    path = str(tmp_path / "dirty.db")
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE t (m NUMERIC)")
    conn.executemany("INSERT INTO t VALUES (?)", [(2.5,), (0.4,), ("junk",), (None,), (7.1,)])
    conn.commit()
    conn.close()
    out = ingest.extract_rounds(path, "t", "m", scale=1.0)
    assert out["accepted"] == 2
    assert out["belowOne"] == 1
    assert out["unreadable"] == 2


def test_unknown_table_and_column_are_reported_clearly(tmp_db):
    path = tmp_db()
    with pytest.raises(ingest.IngestError, match="does not exist"):
        ingest.extract_rounds(path, "nope", "multiplier")
    with pytest.raises(ingest.IngestError, match="not in table"):
        ingest.extract_rounds(path, "rounds", "nope")


# ------------------------------------------------------------------ preview

def test_preview_accepts_a_fair_tape():
    out = ingest.preview_stats(fair_tape(3000), 0.03)
    assert out["looksLikeCrashTape"] is True
    assert 1.8 <= out["median"] <= 2.1
    assert all(r["plausible"] for r in out["rows"])


def test_preview_rejects_a_column_that_is_not_a_tape():
    out = ingest.preview_stats([float(i) for i in range(1, 400)], 0.03)
    assert out["looksLikeCrashTape"] is False
    assert "not a multiplier" in out["verdict"]


def test_preview_handles_an_empty_column():
    assert ingest.preview_stats([])["rounds"] == 0


# --------------------------------------------------- schema auto-detection
#
# Not every scraper gives the multiplier its own column. Two shapes turn up
# constantly in the wild: the whole round stored as a JSON blob, and one row
# caching a page of history as a list. Both are readable tapes, and requiring the
# user to reshape their own database before the terminal will look at it would be
# the sort of gap that makes a feature technically present and practically
# useless. These tests pin down that the detector finds them on its own and, just
# as importantly, that it does not hallucinate a list where there is none.

def build_json_db(path: str, tape: list[float], *, key: str = "crash_point",
                  nest: bool = False) -> None:
    import json
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY, seen_at INTEGER, payload TEXT)")
    base = dt.datetime(2026, 9, 20, 12, 0, 0, tzinfo=dt.timezone.utc)
    for i, m in enumerate(tape):
        inner = {key: m, "bet_total": 100 + i}
        blob = {"round": inner} if nest else inner
        conn.execute("INSERT INTO events (seen_at, payload) VALUES (?,?)",
                     (int((base + dt.timedelta(seconds=20 * i)).timestamp() * 1000),
                      json.dumps(blob)))
    conn.commit()
    conn.close()


def build_list_db(path: str, tape: list[float], *, per_row: int = 25, as_json: bool = False) -> None:
    import json
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE snapshots (id INTEGER PRIMARY KEY, fetched_at TEXT, history TEXT)")
    for i in range(0, len(tape) - per_row + 1, per_row):
        chunk = tape[i:i + per_row]
        cell = json.dumps(chunk) if as_json else ",".join(f"{m:.2f}" for m in chunk)
        conn.execute("INSERT INTO snapshots (fetched_at, history) VALUES (?,?)",
                     (f"2026-09-20T12:{i // per_row:02d}:00+00:00", cell))
    conn.commit()
    conn.close()


def test_a_multiplier_inside_a_json_column_is_found_without_being_told(tmp_path):
    path = str(tmp_path / "json.db")
    build_json_db(path, fair_tape(400))
    rec = ingest.inspect_database(path)["recommendation"]
    assert rec["column"] == "payload.crash_point"
    assert rec["derived"] == "json"
    assert rec["timestampColumn"] == "seen_at"


def test_a_nested_json_path_is_walked(tmp_path):
    path = str(tmp_path / "nested.db")
    tape = fair_tape(300)
    build_json_db(path, tape, nest=True)
    rec = ingest.inspect_database(path)["recommendation"]
    assert rec["column"] == "payload.round.crash_point"
    out = ingest.extract_rounds(path, "events", rec["column"],
                               timestamp_column="seen_at", limit=1000)
    assert out["accepted"] == len(tape)
    assert out["values"][:3] == [round(m, 2) for m in tape[:3]]


def test_the_json_decoy_key_does_not_win(tmp_path):
    path = str(tmp_path / "decoy.db")
    build_json_db(path, fair_tape(400))
    cands = ingest.inspect_database(path)["tables"][0]["multiplierCandidates"]
    names = [c["column"] for c in cands]
    assert names[0] == "payload.crash_point"
    assert names.index("payload.crash_point") < names.index("payload.bet_total")


@pytest.mark.parametrize("as_json", [False, True])
def test_a_row_holding_many_rounds_is_expanded_in_order(tmp_path, as_json):
    path = str(tmp_path / f"list-{as_json}.db")
    tape = fair_tape(500)
    build_list_db(path, tape, per_row=25, as_json=as_json)
    rec = ingest.inspect_database(path)["recommendation"]
    assert rec["column"] == "history[]"
    assert rec["derived"] == "list"
    out = ingest.extract_rounds(path, "snapshots", "history[]", limit=1000)
    assert out["accepted"] == 500
    assert out["values"][:5] == [round(m, 2) for m in tape[:5]]
    assert out["expandedFromList"] is True


def test_expanded_rounds_do_not_claim_a_timestamp_they_cannot_know(tmp_path):
    # The row's clock times the page, not each round inside it. Stamping all 25
    # rounds with one time would invent a cadence of zero seconds and quietly
    # corrupt every window and time-of-day estimate downstream.
    path = str(tmp_path / "list-ts.db")
    build_list_db(path, fair_tape(250), per_row=25)
    rec = ingest.inspect_database(path)["recommendation"]
    assert rec["timestampColumn"] is None
    out = ingest.extract_rounds(path, "snapshots", "history[]",
                               timestamp_column="fetched_at", limit=1000)
    assert set(out["timestamps"]) == {None}
    assert "unknown" in out["timeNote"]


def test_inspection_reports_how_many_rounds_a_list_column_really_holds(tmp_path):
    path = str(tmp_path / "list-count.db")
    build_list_db(path, fair_tape(500), per_row=25)
    table = ingest.inspect_database(path)["tables"][0]
    derived = {d["name"]: d for d in table["derivedColumns"]}
    assert derived["history[]"]["valuesPerRow"] == 25.0
    # 20 rows x 25 rounds, so the true tape is far longer than the row count
    assert derived["history[]"]["estimatedRounds"] == 500
    assert table["rows"] == 20


def test_a_timestamp_is_not_mistaken_for_a_list_of_rounds(tmp_db):
    # "2026-09-20T12:00:00+00:00" splits into plenty of numbers. If that counted
    # as a list, every dated scrape would ingest its own clock as a tape.
    path = tmp_db(tape=fair_tape(300))
    table = ingest.inspect_database(path)["tables"][0]
    assert table["derivedColumns"] == []
    assert ingest.list_numbers("2026-09-20T12:00:00+00:00") is None
    assert ingest.list_numbers("1.24,3.05,1.00,2.50,9.10") == [1.24, 3.05, 1.0, 2.5, 9.1]
    assert ingest.list_numbers("1.24,3.05") is None          # too short to trust


def test_a_column_reference_cannot_smuggle_sql(tmp_path):
    path = str(tmp_path / "inject.db")
    build_json_db(path, fair_tape(120))
    with pytest.raises(ingest.IngestError):
        ingest.extract_rounds(path, "events", 'payload"; DROP TABLE events; --')
    with pytest.raises(ingest.IngestError):
        ingest.extract_rounds(path, "events", "")
    conn = sqlite3.connect(path)
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 120
    conn.close()


def test_parse_column_ref_reads_all_four_shapes():
    assert ingest.parse_column_ref("crash") == ("crash", None, False)
    assert ingest.parse_column_ref("payload.crash") == ("payload", "crash", False)
    assert ingest.parse_column_ref("history[]") == ("history", None, True)
    assert ingest.parse_column_ref("payload.history[]") == ("payload", "history", True)


def test_a_list_column_is_not_also_offered_as_a_single_value_column(tmp_path):
    # `coerce_number("2.61,2.65,...")` returns 2.61, so the raw column looks like a
    # perfectly reasonable tape while actually discarding 24 of every 25 rounds.
    # Offering it at all invites a quiet 96% data loss.
    path = str(tmp_path / "list-only.db")
    build_list_db(path, fair_tape(500), per_row=25)
    cands = [c["column"] for c in ingest.inspect_database(path)["tables"][0]["multiplierCandidates"]]
    assert "history[]" in cands
    assert "history" not in cands


def test_a_weak_best_guess_is_reported_but_not_marked_trusted(tmp_path):
    # A settings table of "v0".."v49" coerces to clean monotonic numbers. It must
    # never be auto-ingested, and the report must say why rather than going quiet.
    path = str(tmp_path / "config.db")
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE config (key TEXT, value TEXT)")
    conn.executemany("INSERT INTO config VALUES (?,?)", [(f"k{i}", f"v{i}") for i in range(60)])
    conn.commit()
    conn.close()
    rec = ingest.inspect_database(path)["recommendation"]
    assert rec is not None
    assert rec["trusted"] is False
    assert rec["confidenceFloor"] == ingest.AUTO_MIN_CONFIDENCE
    assert rec["why"]


def test_a_real_tape_is_marked_trusted(tmp_db):
    rec = ingest.inspect_database(tmp_db(tape=fair_tape(600)))["recommendation"]
    assert rec["trusted"] is True
    assert rec["column"] == "multiplier"
