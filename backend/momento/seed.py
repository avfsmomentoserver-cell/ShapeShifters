"""Seed evidence — prior aviator rounds from the repo's seed/ folder.

The `seed/` folder holds recorded crash data from earlier runs (avfs.db,
momento.db). It is not the live tape; it is *evidence*. The Full Forecast panel
uses it the same way a forecaster uses a climatology: a large, stable reference
distribution that (a) validates the live estimate and (b) anchors it when the
live tape is still thin.

Design constraints:
* Read-only. The seed databases are opened with a `file:...?mode=ro` URI and
  are never written to. They are the user's reference evidence.
* One game. avfs.db mixes several games (aviator / skyward / jetx / a literal
  '${src}' placeholder). Pooling them would contaminate the estimate, so only
  `source = 'aviator'` is counted (momento.db is all aviator).
* Cached. The corpus is ~91k rows; it is scanned once per process and cached.
  It never changes under us, so re-reading per request is pure waste.
"""
from __future__ import annotations

import glob
import os
import sqlite3
import statistics as st
from typing import Any, Dict, List, Optional

# seed/ lives at the project root; this file is backend/momento/seed.py.
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_SEED_DATA_DIRS = [os.path.join(_PROJECT_ROOT, "seed")]

_RO = "file:{}?mode=ro"


def _find_db(filename: str) -> Optional[str]:
    for base in _SEED_DATA_DIRS:
        hits = glob.glob(os.path.join(base, "**", filename), recursive=True)
        if hits:
            return sorted(hits)[0]
    return None


def _read_multipliers(path: str, table: str, source: Optional[str]) -> List[float]:
    con = sqlite3.connect(_RO.format(path), uri=True)
    try:
        q = f"SELECT multiplier FROM {table}"
        args: tuple = ()
        if source is not None:
            q += " WHERE source = ?"
            args = (source,)
        rows = con.execute(q, args).fetchall()
    except sqlite3.Error:
        return []
    finally:
        con.close()
    return [float(r[0]) for r in rows if r[0] is not None and float(r[0]) >= 1.0]


def _quantile(sorted_xs: List[float], q: float) -> float:
    if not sorted_xs:
        return 0.0
    pos = (len(sorted_xs) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(sorted_xs) - 1)
    return sorted_xs[lo] + (sorted_xs[hi] - sorted_xs[lo]) * (pos - lo)


def _stats(xs: List[float]) -> Dict[str, float]:
    if not xs:
        return {"count": 0, "mean": 0.0, "median": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}
    s = sorted(xs)
    return {
        "count": len(xs),
        "mean": round(st.mean(xs), 3),
        "median": round(st.median(xs), 3),
        "p95": round(_quantile(s, 0.95), 3),
        "p99": round(_quantile(s, 0.99), 3),
        "max": round(max(s), 2),
    }


_CACHE: Optional[Dict[str, Any]] = None


def load_seed_evidence(force: bool = False) -> Dict[str, Any]:
    """Compute (and cache) the prior-data evidence the forecast is validated against."""
    global _CACHE
    if _CACHE is not None and not force:
        return _CACHE

    corpora: List[str] = []
    corpus_stats: Dict[str, Any] = {}

    avfs = _find_db("avfs.db")
    if avfs:
        xs = _read_multipliers(avfs, "rounds", source="aviator")
        if xs:
            corpora.append("avfs.db (aviator)")
            corpus_stats["avfs"] = _stats(xs)

    momento = _find_db("momento.db")
    if momento:
        xs = _read_multipliers(momento, "rounds", source=None)
        if xs:
            corpora.append("momento.db")
            corpus_stats["momento"] = _stats(xs)

    combined = (
        _read_multipliers(avfs, "rounds", source="aviator") if avfs else []
    ) + (
        _read_multipliers(momento, "rounds", source=None) if momento else []
    )

    _CACHE = {
        "found": bool(combined),
        "corpora": corpora,
        "combined": _stats(combined),
        "byCorpus": corpus_stats,
        "note": (
            "prior aviator rounds from the repo seed/ folder - a reference "
            "distribution the live estimate is validated against, not live data"
        ) if combined else "no seed database found in seed/ - live-only estimate",
    }
    return _CACHE
