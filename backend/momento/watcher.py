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
re-read from the last byte offset, so appending never double-inserts.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import db

log = logging.getLogger("momento.watcher")

POLL_SECONDS = 1.0
DEFAULT_DIR = str(Path.home() / "Downloads")
SOURCE = "watcher"

# (path -> (size, mtime, byte_offset)) for files we have already read
_seen: Dict[str, Tuple[int, float, int]] = {}


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


def _scan(watch_dir: Path) -> List[Tuple[Path, List[Dict[str, Any]]]]:
    """Return (file, new_rounds) pairs for anything new or grown since last scan."""
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
        rounds = _parse_file(path)
        if prev and rounds and prev[2] > 0:
            # growing file: only take rounds appended after the last offset
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
            except OSError:
                rounds = []
        _seen[key] = (size, mtime, size)
        if rounds:
            out.append((path, rounds))
    return out


async def _ingest_rounds(visitor: str, rounds: List[Dict[str, Any]]) -> int:
    """Insert rounds through the live pipeline (resolves predictions, broadcasts)."""
    from .api import _ingest  # local import to avoid a circular import at module load

    inserted = 0
    for r in rounds:
        m = round(r["multiplier"], 2)
        if m < 1.0:
            continue
        await _ingest(visitor, m, SOURCE)
        inserted += 1
    return inserted


async def run_watcher(visitor: str = db.DEFAULT_VISITOR,
                      watch_dir: Optional[str] = None,
                      poll_seconds: float = POLL_SECONDS) -> None:
    """Background task: poll the watch directory and ingest new rounds."""
    directory = Path(watch_dir or os.environ.get("MOMENTO_WATCH_DIR") or DEFAULT_DIR).expanduser()
    log.info("watcher: watching %s for new rounds (visitor=%s)", directory, visitor)
    while True:
        try:
            for path, rounds in _scan(directory):
                n = await _ingest_rounds(visitor, rounds)
                if n:
                    log.info("watcher: ingested %d round(s) from %s", n, path.name)
        except Exception:
            log.exception("watcher: scan failed")
        await asyncio.sleep(poll_seconds)
