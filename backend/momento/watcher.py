"""~/Downloads watcher — feed new crash rounds into the live tape.

Polls a watched directory (default: ~/Downloads) for JSON files containing
crash multipliers and funnels every new round through the same ingest
pipeline the REST API uses, so predictions resolve, alerts fire and the
Dashboard updates live over the WebSocket.

Supported file shapes (any of these, per file or per line):
  [1.23, 4.56, ...]                          — bare multiplier list
  [{"multiplier": 2.34, "timestamp": ...}]   — objects (keys: multiplier/m/x,
                                               optional timestamp/ts/time, nonce)
  {"rounds": [...]} / {"multipliers": [...]} — wrapped lists
  {"multiplier": 2.34}                       — single round
  JSON Lines (one JSON value per line)       — e.g. a live tail file

Dedup: each file is tracked by (path, size, mtime); a growing file is
re-read from the last byte offset, so appending never double-inserts. A file
is marked seen only AFTER its rounds are ingested, and every round carries
the timestamp it claims — a re-ingest of the same file is skipped round-by-
round on (multiplier, timestamp), so a crash between ingest and marking
cannot duplicate anything and nothing is lost either.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import db

log = logging.getLogger("momento.watcher")

POLL_SECONDS = 1.0
DEFAULT_DIR = str(Path.home() / "Downloads")
SOURCE = "watcher"

# (path -> (size, mtime, byte_offset)) for files we have already read.
# Persisted to disk next to the DB: the cache used to be in-memory, so every
# restart re-ingested the whole watch directory (~1,600 rounds of old history)
# through the live pipeline — wedging the event loop for minutes and filling
# the tape with duplicates. With a persistent cache a restart ingests nothing.
_seen: Dict[str, Tuple[int, float, int]] = {}
_seen_dirty = False


def _seen_path() -> Path:
    from . import db as _db
    return Path(_db.DB_PATH).with_name("watcher_seen.json")


def _save_seen() -> None:
    global _seen_dirty
    try:
        data = {k: [s, m, o] for k, (s, m, o) in _seen.items()}
        tmp = _seen_path().with_name("watcher_seen.json.tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        os.replace(tmp, _seen_path())
        _seen_dirty = False
    except OSError as exc:
        log.warning("watcher: could not persist seen-state: %s", exc)


def _load_seen() -> None:
    """Restore the seen-cache, or bootstrap it on the very first run.

    First-run bootstrap: record every existing file as already-seen WITHOUT
    ingesting it. Those files are prior history — the tape already carries
    them — and the watcher's job is to feed *new* rounds, not to replay the
    archive (replaying it inserts ~1,600 duplicates per restart).
    """
    global _seen_dirty
    try:
        raw = _seen_path().read_text(encoding="utf-8")
        data = json.loads(raw)
        for k, v in data.items():
            if isinstance(v, (list, tuple)) and len(v) == 3:
                _seen[k] = (int(v[0]), float(v[1]), int(v[2]))
        log.info("watcher: restored %d file(s) of seen-state from %s",
                 len(_seen), _seen_path().name)
        return
    except FileNotFoundError:
        pass
    except (json.JSONDecodeError, ValueError, TypeError, OSError) as exc:
        log.warning("watcher: seen-state unreadable (%s); bootstrapping", exc)
    try:
        watch_dir = Path(os.environ.get("MOMENTO_WATCH_DIR") or DEFAULT_DIR).expanduser()
        for path in watch_dir.iterdir():
            if path.suffix.lower() not in (".json", ".jsonl", ".ndjson"):
                continue
            try:
                st = path.stat()
            except OSError:
                continue
            _seen[str(path)] = (st.st_size, st.st_mtime, st.st_size)
        _save_seen()
        log.info("watcher: first run — marked %d existing file(s) as seen "
                 "(archive not re-ingested); only new files feed the tape", len(_seen))
    except OSError as exc:
        log.warning("watcher: could not bootstrap seen-state: %s", exc)


def _normalize_ts(value: Any) -> Optional[str]:
    """Normalize a round timestamp to an ISO-8601 UTC string, or None.

    The archive writes e.g. 2026-09-25T01:30:37.708Z; the tape stores ISO-8601
    with an explicit +00:00 offset (datetime.isoformat of an aware value). Both
    parse with datetime.fromisoformat after a Z→+00:00 swap, so store the
    explicit-offset form. Naive stamps are treated as UTC. Unparseable stamps
    return None and the caller falls back to ingest time.
    """
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _extract_multipliers(value: Any) -> List[Dict[str, Any]]:
    """Normalise any supported JSON shape into a list of round dicts."""
    rounds: List[Dict[str, Any]] = []

    def _round(obj: Any) -> Optional[Dict[str, Any]]:
        if isinstance(obj, (int, float)) and not isinstance(obj, bool):
            return {"multiplier": float(obj)}
        if isinstance(obj, dict):
            m = obj.get("multiplier", obj.get("m", obj.get("x")))
            if m is None:
                return None
            try:
                m = float(m)
            except (TypeError, ValueError):
                return None
            out = {"multiplier": m}
            ts = obj.get("timestamp", obj.get("ts", obj.get("time")))
            if ts:
                out["timestamp"] = ts
            if obj.get("nonce") is not None:
                out["nonce"] = obj.get("nonce")
            return out
        return None

    if isinstance(value, list):
        for item in value:
            r = _round(item)
            if r:
                rounds.append(r)
    elif isinstance(value, dict):
        if any(k in value for k in ("rounds", "multipliers", "data", "items")):
            for key in ("rounds", "multipliers", "data", "items"):
                if key in value:
                    rounds.extend(_extract_multipliers(value[key]))
        else:
            r = _round(value)
            if r:
                rounds.append(r)
    return rounds


def _parse_file(path: Path) -> List[Dict[str, Any]]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        log.warning("watcher: cannot read %s: %s", path, exc)
        return []
    rounds: List[Dict[str, Any]] = []
    try:
        rounds = _extract_multipliers(json.loads(text))
    except json.JSONDecodeError:
        # JSON Lines fallback — one value per line
        for line in text.splitlines():
            line = line.strip().rstrip(",")
            if not line:
                continue
            try:
                rounds.extend(_extract_multipliers(json.loads(line)))
            except json.JSONDecodeError:
                continue
    return rounds


def _scan(watch_dir: Path) -> List[Tuple[Path, List[Dict[str, Any]], Tuple[int, float, int]]]:
    """Return (file, new_rounds, seen_entry) for anything new or grown.

    The caller applies the seen_entry only after the rounds are ingested; the
    dedup in _ingest_rounds makes a re-scan of the same file a no-op, so a
    crash between ingest and marking neither duplicates nor loses rounds.
    """
    out: List[Tuple[Path, List[Dict[str, Any]]]] = []
    try:
        entries = sorted(watch_dir.iterdir())
    except OSError as exc:
        log.warning("watcher: cannot list %s: %s", watch_dir, exc)
        return out
    for path in entries:
        if path.suffix.lower() not in (".json", ".jsonl", ".ndjson"):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        key = str(path)
        size, mtime = stat.st_size, stat.st_mtime
        prev = _seen.get(key)
        if prev and prev[0] == size and prev[1] == mtime:
            continue  # unchanged
        if prev is None:
            # New file: parse it whole. The mark is applied by run_watcher only
            # after the rounds are ingested — marking here used to be the bug
            # in reverse (new files were never marked at all, so every archive
            # file was re-ingested on every poll), and marking before ingest
            # would lose a round if the process died in between.
            rounds = _parse_file(path)
        else:
            # Grown file: only the appended tail is new.
            rounds = []
            try:
                with path.open("r", encoding="utf-8", errors="replace") as fh:
                    fh.seek(prev[2])
                    tail = fh.read()
                appended: List[Dict[str, Any]] = []
                for line in tail.splitlines():
                    line = line.strip().rstrip(",")
                    if not line:
                        continue
                    try:
                        appended.extend(_extract_multipliers(json.loads(line)))
                    except json.JSONDecodeError:
                        continue
                if appended:
                    rounds = appended
            except OSError as exc:
                log.warning("watcher: cannot read tail of %s: %s", path, exc)
                rounds = []
        if rounds:
            out.append((path, rounds, (size, mtime, size)))
    return out


async def _ingest_rounds(visitor: str, rounds: List[Dict[str, Any]]) -> int:
    """Insert rounds through the live pipeline (resolves predictions, broadcasts).

    Yields to the event loop between rounds: _ingest is fully synchronous
    (analyze + predict + broadcast) and a backlog of hundreds of rounds would
    otherwise wedge the loop — no WS messages, no HTTP, no "Application
    startup complete" — for minutes.

    A round that already sits on the tape with the same (multiplier, timestamp)
    is skipped, so re-reading a file can never duplicate rounds. The round's
    own timestamp travels with it: stamping a re-ingested backlog with the
    ingest clock made old rounds look freshly played.
    """
    from .api import _ingest  # local import to avoid a circular import at module load

    inserted = 0
    for r in rounds:
        m = round(r["multiplier"], 2)
        if m < 1.0:
            continue
        ts = _normalize_ts(r.get("timestamp"))
        if ts and db.round_exists(m, ts, visitor):
            continue
        await _ingest(visitor, m, SOURCE, ts=ts)
        inserted += 1
        await asyncio.sleep(0)
    return inserted


async def run_watcher(visitor: str = db.DEFAULT_VISITOR,
                      watch_dir: Optional[str] = None,
                      poll_seconds: float = POLL_SECONDS) -> None:
    """Background task: poll the watch directory and ingest new rounds."""
    # `_seen_dirty` is assigned below; without this declaration Python treats it
    # as a loop-local and the read on the next line raises UnboundLocalError on
    # every poll that ingests nothing — which is every poll. The whole watcher
    # then sits inside its `except`, scanning and re-parsing forever.
    global _seen_dirty
    directory = Path(watch_dir or os.environ.get("MOMENTO_WATCH_DIR") or DEFAULT_DIR).expanduser()
    log.info("watcher: watching %s for new rounds (visitor=%s)", directory, visitor)
    _load_seen()
    while True:
        try:
            for path, rounds, seen in _scan(directory):
                n = await _ingest_rounds(visitor, rounds)
                if n:
                    log.info("watcher: ingested %d new round(s) from %s", n, path.name)
                # Mark only after ingest: an unmarked file is re-parsed next
                # poll and deduped round-by-round, so nothing is lost or doubled.
                _seen[str(path)] = seen
                _seen_dirty = True
            if _seen_dirty:
                _save_seen()
        except Exception:
            log.exception("watcher: scan failed")
        await asyncio.sleep(poll_seconds)
