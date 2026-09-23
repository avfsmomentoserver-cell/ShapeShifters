"""SQLite ingest — seed the tape from a real .db file.

Every estimate in this terminal is only as good as the tape underneath it, and a
pasted list of multipliers loses the two things that matter most: the clock and
the round order. A dropped `.db` file keeps both, which is why this path exists —
it is what makes cadence measurable, the time-of-day test meaningful, and the
walk-forward skill ledger a statement about real rounds instead of a simulation.

Design constraints, all deliberate:

* The uploaded file is opened **read-only and immutable** through a `file:` URI,
  in a throwaway copy, and never written to. A scraper's database is the user's
  evidence; corrupting it would be unforgivable.
* Nothing is guessed silently. `inspect_database` reports every table and every
  candidate column with the evidence behind its score, and the caller picks. The
  recommendation is a starting point, not a decision.
* Integer storage is common (`234` meaning `2.34x`), so scale detection is
  explicit and always reported back, never applied invisibly.
* A file can be enormous. Row scanning is capped, and the cap is reported so a
  truncated ingest is never mistaken for a complete one.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import sqlite3
import tempfile
import time
import uuid
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

SQLITE_MAGIC = b"SQLite format 3\x00"

MAX_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_SCAN_ROWS = 200_000
MAX_INGEST_ROWS = 20_000
SAMPLE_ROWS = 400
UPLOAD_TTL_SECONDS = 30 * 60

# Column names that crash-game exports and community scrapers actually use.
MULTIPLIER_HINTS = (
    "multiplier", "crash_point", "crashpoint", "crash", "bust", "busted_at",
    "coefficient", "coef", "payout", "odds", "rate", "value", "result", "point",
    "final_multiplier", "cashout", "cash_out", "x", "m",
)
TIME_HINTS = (
    "timestamp", "ts", "time", "created_at", "createdat", "date", "datetime",
    "round_time", "started_at", "ended_at", "at",
)
ID_HINTS = ("id", "round_id", "roundid", "nonce", "index", "seq", "number", "game_id")

# Derived columns. Plenty of scrapers never give a multiplier its own column: the
# round is a JSON blob, or one row caches a whole page of history as a list. Both
# are readable without the user restructuring their database, so the detector
# looks inside text columns and offers what it finds as ordinary candidates.
LIST_SUFFIX = "[]"
JSON_PATH_SEP = "."
MAX_JSON_PATHS = 12          # per column, to keep a wide blob from flooding the UI
MIN_LIST_NUMBERS = 5         # below this a "list" is more likely a parse accident
MAX_LIST_VALUES = 4000       # sampled values per list column while scoring

# A recommendation below this is shown but never acted on automatically. A table
# of settings strings ("v0".."v49") coerces to clean numbers and still scores in
# the thirties, and silently seeding the engines from that would produce a
# terminal full of confident nonsense with no visible cause.
AUTO_MIN_CONFIDENCE = 0.55
_LIST_SPLIT_RE = re.compile(r"[,;|\s]+")

# ---------------------------------------------------------------------------
# upload staging
# ---------------------------------------------------------------------------

_UPLOADS: Dict[str, Dict[str, Any]] = {}


def _sweep() -> None:
    """Drop staged uploads past their TTL. Called on every stage/lookup."""
    now = time.time()
    for token in [k for k, v in _UPLOADS.items() if now - v["at"] > UPLOAD_TTL_SECONDS]:
        entry = _UPLOADS.pop(token, None)
        if entry:
            try:
                os.unlink(entry["path"])
            except OSError:
                pass


class IngestError(ValueError):
    """A problem with the uploaded file that the user can act on."""


def stage_upload(data: bytes, filename: str, visitor: str) -> Dict[str, Any]:
    """Write bytes to a temp file after checking they are really a SQLite database."""
    _sweep()
    if not data:
        raise IngestError("the uploaded file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise IngestError(
            f"file is {len(data) / 1e6:.1f} MB — the limit is {MAX_UPLOAD_BYTES // 1_000_000} MB. "
            "Export the rounds table on its own and upload that."
        )
    if not data.startswith(SQLITE_MAGIC):
        raise IngestError(
            "that is not a SQLite database — the file does not start with the SQLite header. "
            "For CSV, JSON or plain text use the paste box instead."
        )
    token = uuid.uuid4().hex
    fd, path = tempfile.mkstemp(prefix=f"momento-ingest-{token[:8]}-", suffix=".db")
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    _UPLOADS[token] = {"path": path, "at": time.time(), "visitor": visitor,
                       "filename": filename or "upload.db", "bytes": len(data)}
    return {"uploadId": token, "filename": filename or "upload.db", "bytes": len(data)}


def upload_path(token: str, visitor: str) -> Dict[str, Any]:
    _sweep()
    entry = _UPLOADS.get(token)
    if not entry:
        raise IngestError("that upload has expired — drop the file again")
    if entry["visitor"] != visitor:
        raise IngestError("that upload belongs to a different workspace")
    return entry


def discard_upload(token: str) -> bool:
    entry = _UPLOADS.pop(token, None)
    if not entry:
        return False
    try:
        os.unlink(entry["path"])
    except OSError:
        pass
    return True


# ---------------------------------------------------------------------------
# read-only access
# ---------------------------------------------------------------------------

def _connect(path: str) -> sqlite3.Connection:
    """Open the copy read-only and immutable, so ingest can never mutate evidence."""
    uri = f"file:{path}?mode=ro&immutable=1"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=5)
    except sqlite3.Error as exc:  # pragma: no cover - corrupt file path
        raise IngestError(f"could not open the database: {exc}") from exc
    conn.row_factory = sqlite3.Row
    conn.text_factory = lambda b: b.decode("utf-8", "replace")
    return conn


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _safe_name(name: str) -> bool:
    return bool(name) and len(name) < 200 and "\x00" not in name


# ---------------------------------------------------------------------------
# derived columns: JSON paths and list-valued columns
# ---------------------------------------------------------------------------

def parse_column_ref(ref: str) -> Tuple[str, Optional[str], bool]:
    """Split a column reference into (real column, JSON path, expand-as-list).

    ``crash`` -> plain column. ``payload.crash_point`` -> a path inside a JSON
    column. ``history[]`` -> a column whose single value is a list of rounds.
    ``payload.history[]`` -> a list nested inside a blob. Only the leading segment
    is ever interpolated into SQL; the rest is walked in Python.
    """
    if not ref:
        raise IngestError("no column selected")
    is_list = ref.endswith(LIST_SUFFIX)
    core = ref[: -len(LIST_SUFFIX)] if is_list else ref
    base, _, path = core.partition(JSON_PATH_SEP)
    if not _safe_name(base):
        raise IngestError(f"invalid column name '{ref}'")
    if path and not all(_safe_name(p) for p in path.split(JSON_PATH_SEP)):
        raise IngestError(f"invalid path inside '{ref}'")
    return base, (path or None), is_list


def _maybe_json(value: Any) -> Any:
    """Parse a text or blob value as JSON, or return None if it is not JSON."""
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8", "strict")
        except Exception:
            return None
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s or s[0] not in "{[":
        return None
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


def _flatten_json(obj: Any, prefix: str = "", depth: int = 2) -> Dict[str, Any]:
    """Scalar leaves of a JSON object, keyed by dotted path."""
    out: Dict[str, Any] = {}
    if not isinstance(obj, dict) or depth < 0:
        return out
    for k, v in obj.items():
        if not isinstance(k, str) or not _safe_name(k) or JSON_PATH_SEP in k:
            continue
        path = f"{prefix}{k}"
        if isinstance(v, (int, float, str)) and not isinstance(v, bool):
            out[path] = v
        elif isinstance(v, dict) and depth > 0:
            out.update(_flatten_json(v, f"{path}{JSON_PATH_SEP}", depth - 1))
    return out


def value_at_path(container: Any, path: Optional[str]) -> Any:
    """Walk a dotted path through nested dicts. Missing keys yield None."""
    if path is None:
        return container
    cur = container
    for key in path.split(JSON_PATH_SEP):
        if isinstance(cur, dict):
            cur = cur.get(key)
        else:
            return None
    return cur


def list_numbers(value: Any) -> Optional[List[float]]:
    """Read a value that holds many rounds at once, or return None.

    Accepts a JSON array of numbers (or of single-key objects flattened by the
    caller) and delimited text like ``1.24,3.05,1.00``. The floor on length and
    the requirement that *every* token parses are what stop a timestamp or an id
    string from being mistaken for a list of rounds.
    """
    parsed = _maybe_json(value)
    if isinstance(parsed, list):
        nums = [coerce_number(v) for v in parsed if not isinstance(v, (dict, list))]
        clean = [v for v in nums if v is not None]
        if len(clean) >= MIN_LIST_NUMBERS and len(clean) == len(nums):
            return clean
        return None
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8", "replace")
        except Exception:
            return None
    if not isinstance(value, str):
        return None
    tokens = [t for t in _LIST_SPLIT_RE.split(value.strip().strip("[]()")) if t]
    if len(tokens) < MIN_LIST_NUMBERS:
        return None
    nums = [coerce_number(t) for t in tokens]
    if any(n is None for n in nums):
        return None
    # A token must be *only* a number, or "2026-09-21" would split into three.
    if not all(re.fullmatch(r"-?\d+(?:[.,]\d+)?x?", t, re.I) for t in tokens):
        return None
    return [n for n in nums if n is not None]


def derive_columns(cols: Sequence[str], by_col: Dict[str, List[Any]]) -> List[Dict[str, Any]]:
    """Offer the contents of JSON and list columns as ordinary candidates."""
    derived: List[Dict[str, Any]] = []
    for col in cols:
        sample = [v for v in by_col.get(col, []) if v is not None]
        if not sample:
            continue
        texty = [v for v in sample if isinstance(v, (str, bytes))]
        if len(texty) < max(1, int(len(sample) * 0.6)):
            continue

        # whole-list column: one row, many rounds
        lists = [list_numbers(v) for v in texty[:SAMPLE_ROWS]]
        good = [l for l in lists if l]
        if len(good) >= max(1, int(len(texty) * 0.6)):
            flat: List[Any] = []
            for l in good:
                flat.extend(l)
                if len(flat) >= MAX_LIST_VALUES:
                    break
            per_row = round(sum(len(l) for l in good) / len(good), 1)
            derived.append({
                "name": f"{col}{LIST_SUFFIX}", "base": col, "kind": "list",
                "values": flat[:MAX_LIST_VALUES], "valuesPerRow": per_row,
                "note": f"each row of '{col}' holds ~{per_row} rounds — expanded in order",
            })
            continue

        # JSON object column: expose its scalar leaves
        objs = [_maybe_json(v) for v in texty[:SAMPLE_ROWS]]
        dicts = [o for o in objs if isinstance(o, dict)]
        if len(dicts) < max(1, int(len(texty) * 0.6)):
            continue
        paths: List[str] = []
        for o in dicts[:64]:
            for p in _flatten_json(o):
                if p not in paths:
                    paths.append(p)
            if len(paths) >= MAX_JSON_PATHS:
                break
        for p in paths[:MAX_JSON_PATHS]:
            vals = [value_at_path(o, p) if isinstance(o, dict) else None for o in objs]
            if all(v is None for v in vals):
                continue
            nested = [list_numbers(v) for v in vals]
            if len([n for n in nested if n]) >= max(1, int(len(vals) * 0.6)):
                flat2: List[Any] = []
                for n in nested:
                    if n:
                        flat2.extend(n)
                derived.append({
                    "name": f"{col}{JSON_PATH_SEP}{p}{LIST_SUFFIX}", "base": col, "kind": "list",
                    "values": flat2[:MAX_LIST_VALUES],
                    "note": f"'{p}' inside the JSON of '{col}' is a list of rounds",
                })
            else:
                derived.append({
                    "name": f"{col}{JSON_PATH_SEP}{p}", "base": col, "kind": "json",
                    "values": vals, "note": f"read from the JSON stored in '{col}'",
                })
    return derived


# ---------------------------------------------------------------------------
# value coercion
# ---------------------------------------------------------------------------

_NUM_RE = re.compile(r"-?\d+(?:[.,]\d+)?")


def coerce_number(value: Any) -> Optional[float]:
    """Pull a number out of whatever the column actually holds.

    Scrapers store multipliers as floats, as integers, and as strings like
    '2.34x' or '1,07'. All three are the same round.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        return v if math.isfinite(v) else None
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8", "replace")
        except Exception:  # pragma: no cover
            return None
    if isinstance(value, str):
        m = _NUM_RE.search(value.strip())
        if not m:
            return None
        try:
            v = float(m.group(0).replace(",", "."))
        except ValueError:
            return None
        return v if math.isfinite(v) else None
    return None


def detect_scale(values: Sequence[float]) -> Tuple[float, str]:
    """Infer the stored scale of a multiplier column.

    A crash multiplier is at least 1.00 and its median sits near 2. A column whose
    values are whole numbers with a median in the hundreds is almost certainly
    storing hundredths (234 -> 2.34x); thousandths (2340) show up too.
    """
    clean = [v for v in values if v is not None and math.isfinite(v) and v > 0]
    if not clean:
        return 1.0, "no usable numbers to judge the scale"
    ordered = sorted(clean)
    median = ordered[len(ordered) // 2]
    all_int = all(abs(v - round(v)) < 1e-9 for v in clean)
    if all_int and median >= 1_000:
        return 0.001, f"whole numbers with a median of {median:.0f} — read as thousandths (÷1000)"
    if all_int and median >= 100:
        return 0.01, f"whole numbers with a median of {median:.0f} — read as hundredths (÷100)"
    if median >= 1_000:
        return 0.001, f"median of {median:.0f} — read as thousandths (÷1000)"
    if median >= 100:
        return 0.01, f"median of {median:.0f} — read as hundredths (÷100)"
    return 1.0, f"median of {median:.2f} — already a multiplier"


def parse_timestamp(value: Any) -> Optional[str]:
    """Normalise a timestamp cell to an ISO-8601 UTC string, or None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    if isinstance(value, (int, float)):
        n = float(value)
        if not math.isfinite(n) or n <= 0:
            return None
        # seconds, milliseconds or microseconds since the epoch
        for div in (1.0, 1_000.0, 1_000_000.0):
            secs = n / div
            if 946_684_800 <= secs <= 4_102_444_800:  # 2000-01-01 .. 2100-01-01
                return dt.datetime.fromtimestamp(secs, dt.timezone.utc).isoformat()
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        # An all-digit string is an epoch, never a date. Left to fromisoformat,
        # '1789603200' parses as the year 1789 in basic format and silently
        # backdates the whole tape by two centuries.
        if text.isdigit():
            return parse_timestamp(int(text))
        candidate = text.replace("Z", "+00:00").replace("/", "-")
        try:
            parsed = dt.datetime.fromisoformat(candidate)
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d",
                        "%d-%m-%Y %H:%M:%S", "%m-%d-%Y %H:%M:%S", "%Y%m%d%H%M%S"):
                try:
                    parsed = dt.datetime.strptime(candidate, fmt)
                    break
                except ValueError:
                    continue
            else:
                num = coerce_number(text)
                return parse_timestamp(num) if num is not None else None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc).isoformat()
    return None


# ---------------------------------------------------------------------------
# inspection
# ---------------------------------------------------------------------------

def _score_multiplier_column(name: str, values: Sequence[Any],
                             derived: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """How much does this column look like a column of crash multipliers?

    `derived` marks a candidate that is not a real column but a JSON path or an
    expanded list. Those are scored on exactly the same evidence — nothing gets a
    free pass for being clever — except that the name hints read the leaf of the
    path, since `payload.crash_point` is as much a crash column as `crash_point`.
    """
    raw = [coerce_number(v) for v in values]
    nums = [v for v in raw if v is not None]
    considered = len(values) or 1
    numeric_share = len(nums) / considered
    scale, scale_note = detect_scale(nums)
    scaled = [v * scale for v in nums]
    in_range = [v for v in scaled if 1.0 <= v <= 1_000_000]
    range_share = len(in_range) / len(nums) if nums else 0.0

    ordered = sorted(in_range)
    median = ordered[len(ordered) // 2] if ordered else 0.0
    mean = sum(in_range) / len(in_range) if in_range else 0.0
    lo = ordered[0] if ordered else 0.0
    hi = ordered[-1] if ordered else 0.0
    # A crash tape is heavy-tailed: the mean sits well above the median and the
    # median lands near 2. Both are strong, cheap signals.
    tail = mean / median if median > 0 else 0.0
    near_two = max(0.0, 1.0 - abs(median - 2.0) / 2.0) if median else 0.0
    distinct = len({round(v, 4) for v in in_range})

    leaf = name.lower().rstrip("[]").rsplit(JSON_PATH_SEP, 1)[-1]
    lower = leaf
    hint = 0.0
    for i, h in enumerate(MULTIPLIER_HINTS):
        if lower == h:
            hint = max(hint, 1.0 - i * 0.01)
        elif h in lower:
            hint = max(hint, 0.75 - i * 0.01)

    # A counter is the most dangerous decoy: scaled by a hundredth, an id column
    # of 1..400 has a median near 2 and a plausible range, so the shape tests
    # alone would rank it as a tape. Two independent tells rule it out — the name,
    # and the fact that a real tape is never sorted.
    monotonic = len(nums) > 8 and (
        all(b >= a for a, b in zip(nums, nums[1:])) or all(b <= a for a, b in zip(nums, nums[1:]))
    )
    id_named = any(lower == h or lower.endswith("_" + h) or lower.endswith(h) for h in ID_HINTS)

    score = (
        0.30 * numeric_share
        + 0.24 * range_share
        + 0.18 * near_two
        + 0.10 * min(tail / 3.0, 1.0)
        + 0.30 * hint
        + (0.08 if distinct > max(8, len(in_range) * 0.05) else -0.15)
    )
    if range_share < 0.5 or len(in_range) < 5:
        score -= 0.5
    if monotonic:
        score -= 0.55
    if id_named and hint < 0.9:
        score -= 0.45

    return {
        "column": name,
        "derived": derived["kind"] if derived else None,
        "note": derived["note"] if derived else None,
        "valuesPerRow": derived.get("valuesPerRow") if derived else None,
        "score": round(max(0.0, min(1.0, score)), 3),
        "numericShare": round(numeric_share, 3),
        "inRangeShare": round(range_share, 3),
        "suggestedScale": scale,
        "scaleNote": scale_note,
        "min": round(lo, 4),
        "max": round(hi, 4),
        "median": round(median, 4),
        "mean": round(mean, 4),
        "distinct": distinct,
        "monotonic": monotonic,
        "sample": [round(v, 2) for v in scaled[:8]],
    }


def _score_time_column(name: str, values: Sequence[Any]) -> Dict[str, Any]:
    parsed = [parse_timestamp(v) for v in values]
    ok = [p for p in parsed if p]
    share = len(ok) / (len(values) or 1)
    lower = name.lower()
    hint = 1.0 if lower in TIME_HINTS else 0.6 if any(h in lower for h in TIME_HINTS) else 0.0
    span_hours: Optional[float] = None
    if len(ok) >= 2:
        stamps = sorted(dt.datetime.fromisoformat(p) for p in ok)
        span_hours = round((stamps[-1] - stamps[0]).total_seconds() / 3600, 2)
    return {
        "column": name,
        "score": round(min(1.0, 0.7 * share + 0.4 * hint), 3),
        "parsedShare": round(share, 3),
        "spanHours": span_hours,
        "first": ok[0] if ok else None,
        "last": ok[-1] if ok else None,
        "sample": [str(v)[:32] for v in values[:4]],
    }


def inspect_database(path: str) -> Dict[str, Any]:
    """Catalogue every table and rank the columns that could hold a tape."""
    conn = _connect(path)
    try:
        names = [
            r["name"] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table','view') "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
            if _safe_name(r["name"])
        ]
        if not names:
            raise IngestError("the database has no tables")

        tables: List[Dict[str, Any]] = []
        for name in names:
            try:
                rows = int(conn.execute(f"SELECT COUNT(*) FROM {_quote(name)}").fetchone()[0])
            except sqlite3.Error:
                continue
            try:
                cur = conn.execute(f"SELECT * FROM {_quote(name)} LIMIT {SAMPLE_ROWS}")
                sample = cur.fetchall()
                cols = [d[0] for d in cur.description or []]
            except sqlite3.Error:
                continue
            if not cols:
                continue
            by_col = {c: [r[i] for r in sample] for i, c in enumerate(cols)}
            # Look inside text columns too: a JSON blob or a cached list of rounds
            # is a perfectly readable tape and the user should not have to reshape
            # their database to use it.
            derived = derive_columns(cols, by_col)
            for d in derived:
                by_col[d["name"]] = d["values"]
            derived_meta = {d["name"]: d for d in derived}
            # If a column turned out to hold a whole list of rounds, scoring it as
            # a plain column is a trap: `coerce_number` reads only its first number,
            # so it looks like a decent tape and would silently ingest one round in
            # twenty-five. Offer the expansion instead of the misreading.
            expanded_bases = {d["base"] for d in derived if d["kind"] == "list"}
            scored = [c for c in cols if c not in expanded_bases] + [d["name"] for d in derived]
            m_cands = sorted(
                (_score_multiplier_column(c, by_col[c], derived_meta.get(c)) for c in scored),
                key=lambda d: d["score"], reverse=True,
            )
            t_cands = sorted(
                (_score_time_column(c, by_col[c]) for c in cols),
                key=lambda d: d["score"], reverse=True,
            )
            tables.append({
                "table": name,
                "rows": rows,
                "columns": (
                    [{"name": c, "sample": [str(v)[:24] for v in by_col[c][:3]]} for c in cols]
                    + [{"name": d["name"], "derived": d["kind"], "note": d["note"],
                        "sample": [str(v)[:24] for v in d["values"][:3]]} for d in derived]
                ),
                "multiplierCandidates": [c for c in m_cands if c["score"] > 0][:6],
                "timestampCandidates": [c for c in t_cands if c["parsedShare"] >= 0.5][:4],
                "sampled": len(sample),
                "derivedColumns": [
                    {"name": d["name"], "kind": d["kind"], "note": d["note"],
                     "valuesPerRow": d.get("valuesPerRow"),
                     "estimatedRounds": int(rows * d["valuesPerRow"]) if d.get("valuesPerRow") else None}
                    for d in derived
                ],
            })

        # rank tables by their best multiplier column, weighted a little by size
        def table_rank(t: Dict[str, Any]) -> float:
            best = t["multiplierCandidates"][0]["score"] if t["multiplierCandidates"] else 0.0
            return best + min(math.log10(t["rows"] + 1) / 12.0, 0.25)

        ranked = sorted(tables, key=table_rank, reverse=True)
        best = ranked[0] if ranked and ranked[0]["multiplierCandidates"] else None
        recommendation = None
        if best:
            m = best["multiplierCandidates"][0]
            t = best["timestampCandidates"][0] if best["timestampCandidates"] else None
            # A list column's rounds have no individual clock, so offering a
            # timestamp column there would attach the page's time to every round
            # inside it and fake a cadence.
            if m.get("derived") == "list":
                t = None
            trusted = (m["score"] >= AUTO_MIN_CONFIDENCE and not m["monotonic"]
                       and m["inRangeShare"] >= 0.8)
            recommendation = {
                "table": best["table"],
                "column": m["column"],
                "derived": m.get("derived"),
                # `trusted` is what separates "here is the best of a bad lot, look
                # at it yourself" from "this is safe to ingest unattended".
                "trusted": trusted,
                "confidenceFloor": AUTO_MIN_CONFIDENCE,
                "timestampColumn": t["column"] if t else None,
                "scale": m["suggestedScale"],
                "confidence": m["score"],
                "why": (
                    f"{int(m['inRangeShare'] * 100)}% of sampled values are valid multipliers, "
                    f"median {m['median']}, {m['scaleNote']}"
                    + (f", clock from '{t['column']}' spanning {t['spanHours']}h" if t and t["spanHours"] else "")
                    + (f" — {m['note']}" if m.get("note") else "")
                ),
            }
        return {
            "tables": sorted(tables, key=lambda t: -t["rows"]),
            "recommendation": recommendation,
            "note": (
                "Columns are ranked on how much they behave like crash multipliers: share of values at or "
                "above 1.00, a median near 2, a heavy right tail, and the column name. Check the recommendation "
                "against the samples before committing — a wrong column produces confident nonsense everywhere else."
            ),
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------

def extract_rounds(path: str, table: str, column: str, timestamp_column: Optional[str] = None,
                   scale: Optional[float] = None, order_column: Optional[str] = None,
                   limit: int = MAX_INGEST_ROWS, newest_first: bool = False) -> Dict[str, Any]:
    """Pull (multiplier, timestamp) pairs out of the chosen table.

    Rounds come back in chronological order, which the ensemble and every
    walk-forward score depend on. Rows that cannot be read as a multiplier at or
    above 1.00 are counted and reported rather than quietly dropped.
    """
    if not _safe_name(table):
        raise IngestError("invalid table name")
    base_column, json_path, expand_list = parse_column_ref(column)
    if timestamp_column and not _safe_name(timestamp_column):
        raise IngestError("invalid timestamp column name")
    limit = int(max(1, min(limit, MAX_INGEST_ROWS)))

    conn = _connect(path)
    try:
        cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({_quote(table)})")]
        if not cols:
            raise IngestError(f"table '{table}' does not exist in this database")
        if base_column not in cols:
            raise IngestError(f"column '{base_column}' is not in table '{table}'")
        if timestamp_column and timestamp_column not in cols:
            raise IngestError(f"column '{timestamp_column}' is not in table '{table}'")

        order = order_column if order_column in cols else (
            timestamp_column if timestamp_column else ("rowid" if "rowid" not in cols else cols[0])
        )
        select = [_quote(base_column)]
        if timestamp_column:
            select.append(_quote(timestamp_column))
        order_sql = _quote(order) if order in cols else "rowid"
        # Take the newest rows when the table is larger than the cap, then flip
        # back to chronological order, so a huge scrape seeds recent history.
        direction = "DESC" if newest_first else "ASC"
        sql = (
            f"SELECT {', '.join(select)} FROM {_quote(table)} "
            f"ORDER BY {order_sql} {direction} LIMIT {min(limit, MAX_SCAN_ROWS)}"
        )
        rows = conn.execute(sql).fetchall()
        available = int(conn.execute(f"SELECT COUNT(*) FROM {_quote(table)}").fetchone()[0])
    except sqlite3.Error as exc:
        raise IngestError(f"could not read that table: {exc}") from exc
    finally:
        conn.close()

    if newest_first:
        rows = list(reversed(rows))

    # One database row does not always mean one round. A JSON column needs the
    # path walked, and a cached-history column holds a whole page of rounds whose
    # order inside the row is the tape order.
    time_note: Optional[str] = None
    expanded: List[Tuple[Any, Optional[Any]]] = []
    for r in rows:
        cell = r[0]
        stamp_src = r[1] if timestamp_column else None
        if json_path is not None:
            cell = value_at_path(_maybe_json(cell), json_path)
        if expand_list:
            nums = list_numbers(cell)
            if nums is None:
                expanded.append((None, stamp_src))
                continue
            # The row's clock is the clock of the page, not of each round in it, so
            # claiming a timestamp per element would invent a cadence that was
            # never observed. They are backdated at the fallback cadence instead.
            expanded.extend((n, None) for n in nums)
        else:
            expanded.append((cell, stamp_src))
    if expand_list:
        time_note = ("rounds came from a list inside each row, so individual round times are "
                     "unknown — the tape is backdated at the fallback cadence and the "
                     "time-of-day test is not meaningful for it")
        if len(expanded) > MAX_INGEST_ROWS:
            expanded = expanded[-MAX_INGEST_ROWS:]   # keep the most recent rounds
            time_note += f"; capped at the newest {MAX_INGEST_ROWS:,} rounds"

    raw = [coerce_number(c) for c, _ in expanded]
    if scale is None or scale <= 0:
        scale, scale_note = detect_scale([v for v in raw if v is not None])
    else:
        scale_note = f"scale {scale} applied as requested"

    values: List[float] = []
    stamps: List[Optional[str]] = []
    below_one = 0
    unreadable = 0
    for i, (_cell, stamp_src) in enumerate(expanded):
        v = raw[i]
        if v is None:
            unreadable += 1
            continue
        v = round(v * scale, 2)
        if v < 1.0:
            below_one += 1
            continue
        values.append(v)
        stamps.append(parse_timestamp(stamp_src) if stamp_src is not None else None)

    stamped = sum(1 for s in stamps if s)
    span_hours: Optional[float] = None
    parsed_stamps = sorted(dt.datetime.fromisoformat(s) for s in stamps if s)
    if len(parsed_stamps) >= 2:
        span_hours = round((parsed_stamps[-1] - parsed_stamps[0]).total_seconds() / 3600, 2)
        hours = len({p.hour for p in parsed_stamps})
    else:
        hours = 0

    return {
        "values": values,
        "timestamps": stamps,
        "scale": scale,
        "scaleNote": scale_note,
        "rowsRead": len(rows),
        "column": column,
        "expandedFromList": expand_list,
        "jsonPath": json_path,
        "timeNote": time_note,
        "accepted": len(values),
        "belowOne": below_one,
        "unreadable": unreadable,
        "stamped": stamped,
        "spanHours": span_hours,
        "hoursCovered": hours,
        "tableRows": available,
        "truncated": available > len(rows),
    }


def preview_stats(values: Sequence[float], house_edge: float = 0.03,
                  thresholds: Sequence[float] = (1.5, 2.0, 5.0, 10.0, 50.0, 100.0)) -> Dict[str, Any]:
    """A sanity summary of an extracted tape, before anything is written.

    This is the check that catches a wrong column: if the observed exceedance is
    nowhere near the fair curve at any threshold, the numbers are not a crash
    tape, whatever the column is named.
    """
    n = len(values)
    if n == 0:
        return {"rounds": 0, "rows": [], "verdict": "no usable rounds in that column"}
    ordered = sorted(values)
    rows = []
    off = 0
    for t in thresholds:
        hits = sum(1 for v in values if v >= t)
        rate = hits / n
        fair = (1 - house_edge) / t
        ratio = rate / fair if fair > 0 else 0.0
        plausible = 0.5 <= ratio <= 2.0 or hits < 10
        if not plausible:
            off += 1
        rows.append({
            "threshold": t, "hits": hits, "rate": round(rate, 5),
            "fair": round(fair, 5), "ratio": round(ratio, 3), "plausible": plausible,
        })
    median = ordered[n // 2]
    return {
        "rounds": n,
        "median": round(median, 2),
        "mean": round(sum(values) / n, 3),
        "min": round(ordered[0], 2),
        "max": round(ordered[-1], 2),
        "instantCrashes": round(sum(1 for v in values if v < 1.05) / n, 5),
        "rows": rows,
        "looksLikeCrashTape": off == 0,
        "verdict": (
            f"Looks like a crash tape: median {median:.2f}x against a fair {2 * (1 - house_edge):.2f}x, "
            "and exceedance tracks the fair curve at every threshold."
            if off == 0 else
            f"{off} of {len(rows)} thresholds are far from the fair rate. Either this is not a multiplier "
            "column, the scale is wrong, or the house edge in Settings does not match this operator."
        ),
    }
