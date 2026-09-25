"""Momento FastAPI — full REST + WebSocket surface."""
from __future__ import annotations

import asyncio
import csv
import io
import json
import random
import secrets
import threading
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import (APIRouter, Body, FastAPI, File, Header, HTTPException, Query, Response, UploadFile,
                     WebSocket, WebSocketDisconnect)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import (db, ev, fairness, ingest, math_models as mm, pipeline, randomness, seed as seed_evidence,
               strategies, survival, watcher, windows)

VERSION = "6.2.0"
SEED_SERVER = "momento-demo-server-seed-2f9c41a7b6e5"
SEED_CLIENT = "momento-demo-client"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    # ~/Downloads watcher: any .json/.jsonl dropped there feeds the live tape
    watch_task = asyncio.create_task(watcher.run_watcher())
    yield
    watch_task.cancel()


app = FastAPI(
    title="Momento Analytics API",
    version=VERSION,
    description=(
        "Crash-curve analytics, provably-fair verification and honest expected-value "
        "mathematics. Analytics only — no part of this API can predict a fair crash game."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    expose_headers=["*"],
)

api = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# visitor scoping
# ---------------------------------------------------------------------------

_SEED_LOCKS: Dict[str, threading.Lock] = {}
_SEED_LOCKS_GUARD = threading.Lock()
_SEEDED: set = set()


def _ensure_seeded(visitor: str) -> None:
    """First visit gets a reproducible, provably-fair demo tape and default alerts.

    Guarded by a per-visitor lock: a browser opening the app fires several
    requests at once, and without the lock each one passes the empty-tape check
    and seeds its own 900 rounds. Three concatenated copies of the same tape are
    not independent, so the randomness battery would correctly reject a tape that
    was only ever broken by this race.
    """
    if visitor in _SEEDED:
        return
    with _SEED_LOCKS_GUARD:
        lock = _SEED_LOCKS.setdefault(visitor, threading.Lock())
    with lock:
        if visitor in _SEEDED:
            return
        if db.count_rounds(visitor) == 0:
            tape = fairness.generate_provable_tape(SEED_SERVER, SEED_CLIENT, count=900,
                                                   house_edge=db.get_settings(visitor)["houseEdge"])
            db.insert_rounds_bulk(tape, visitor, source="provably-fair-seed")
        db.seed_default_alerts(visitor)
        _SEEDED.add(visitor)
    # A seeded tape is a complete tape, so the predictor should be armed on first
    # paint rather than waiting for a live round that a paused feed never sends.
    _arm_prediction(visitor)


def visitor_of(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> str:
    """Resolve the workspace and make sure it has a tape before anything reads it.

    Seeding here rather than per-endpoint is deliberate: the browser fires a dozen
    requests on first paint and any one of them may arrive first, so an endpoint
    that forgot to seed would be handed an empty tape and return an error shape
    the page could not render.
    """
    v = (x_visitor_id or db.DEFAULT_VISITOR).strip()[:120] or db.DEFAULT_VISITOR
    _ensure_seeded(v)
    return v


def _tape(visitor: str, limit: int = 4000) -> List[float]:
    return db.multipliers_for(visitor, limit)


def _parse_thresholds(raw: Optional[str], fallback) -> List[float]:
    """Parse a comma-separated threshold list, falling back to the default set."""
    if not raw:
        return list(fallback)
    out: List[float] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            value = float(part)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"not a multiplier: {part}")
        if not 1.0 < value <= 1_000_000:
            raise HTTPException(status_code=422, detail=f"threshold out of range: {part}")
        out.append(value)
    if not out:
        return list(fallback)
    return sorted(set(out))[:12]


# ---------------------------------------------------------------------------
# websocket hub
# ---------------------------------------------------------------------------

class Hub:
    def __init__(self) -> None:
        self._clients: Dict[str, List[WebSocket]] = {}

    async def connect(self, ws: WebSocket, visitor: str) -> None:
        await ws.accept()
        self._clients.setdefault(visitor, []).append(ws)

    def disconnect(self, ws: WebSocket, visitor: str) -> None:
        pool = self._clients.get(visitor, [])
        if ws in pool:
            pool.remove(ws)

    async def broadcast(self, visitor: str, message: Dict[str, Any]) -> None:
        dead: List[WebSocket] = []
        for ws in list(self._clients.get(visitor, [])):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, visitor)

    def client_count(self, visitor: str) -> int:
        return len(self._clients.get(visitor, []))


hub = Hub()


# ---------------------------------------------------------------------------
# models
# ---------------------------------------------------------------------------

class RoundIn(BaseModel):
    multiplier: float = Field(ge=1.0, le=1e6)
    source: str = "manual"


class BulkIn(BaseModel):
    multipliers: List[float] = Field(min_length=1)
    mode: str = "append"          # append | replace


class DbIngestIn(BaseModel):
    uploadId: str
    # Both optional: omit them and the server re-inspects the file and uses its own
    # recommendation, so a caller that does not know the schema can still ingest.
    table: Optional[str] = None
    column: Optional[str] = None
    timestampColumn: Optional[str] = None
    scale: Optional[float] = Field(default=None, gt=0)
    limit: int = Field(default=5000, ge=1, le=ingest.MAX_INGEST_ROWS)
    newestFirst: bool = True
    mode: str = "replace"          # replace | append
    dryRun: bool = False


class SettingsIn(BaseModel):
    houseEdge: Optional[float] = Field(default=None, ge=0.0, le=0.2)
    edgePreset: Optional[str] = None
    operator: Optional[str] = None
    currency: Optional[str] = None
    defaultTarget: Optional[float] = Field(default=None, ge=1.01, le=1000)
    bankroll: Optional[float] = Field(default=None, gt=0)
    maxRiskPerRound: Optional[float] = Field(default=None, gt=0, le=1)
    sessionLossLimit: Optional[float] = Field(default=None, gt=0, le=1)
    liveFeedIntervalMs: Optional[int] = Field(default=None, ge=400, le=60000)
    simulatorEnabled: Optional[bool] = None
    showResponsibleBanner: Optional[bool] = None
    theme: Optional[str] = None
    confidenceFloor: Optional[float] = Field(default=None, ge=0, le=1)


class AlertIn(BaseModel):
    name: str
    kind: str = "multiplier"
    comparator: str = "gte"
    threshold: float = 10.0


class AnnotationIn(BaseModel):
    chart: str
    kind: str
    points: List[List[float]]
    color: str = "#38c7e8"
    label: Optional[str] = None


class AnnotationPatch(BaseModel):
    points: Optional[List[List[float]]] = None
    color: Optional[str] = None
    label: Optional[str] = None


class VerifyIn(BaseModel):
    serverSeed: str
    clientSeed: str = ""
    nonce: int = 1
    observed: Optional[float] = None
    houseEdge: float = 0.01
    algorithm: str = "hmac_sha256"
    serverSeedHash: Optional[str] = None
    template: str = fairness.DEFAULT_TEMPLATE
    save: bool = False
    label: Optional[str] = None


class VerifyBatchIn(BaseModel):
    serverSeed: str
    clientSeed: str = ""
    startNonce: int = 1
    observed: List[float] = Field(min_length=1)
    houseEdge: float = 0.01
    algorithm: str = "hmac_sha256"
    template: str = fairness.DEFAULT_TEMPLATE


class SolveIn(BaseModel):
    serverSeed: str
    clientSeed: str = ""
    nonce: int = 1
    observed: float = Field(ge=1.0)


class ChainIn(BaseModel):
    revealedSeed: str
    committedHash: str
    iterations: int = 1
    search: bool = False


class SessionIn(BaseModel):
    name: str = "Session"
    bankroll: float = Field(gt=0)
    stake: float = Field(gt=0)
    target: float = Field(gt=1.0)
    lossLimit: float = Field(gt=0)


class BetIn(BaseModel):
    stake: float = Field(gt=0)
    target: float = Field(gt=1.0)
    result: float = Field(ge=1.0)
    note: Optional[str] = None


class BacktestIn(BaseModel):
    target: float = 2.0
    staking: str = "flat"
    stake: float = 10.0
    startBankroll: float = 1000.0
    kellyFraction: float = 0.25
    minEdge: float = 0.0
    warmup: int = 120


class RuinIn(BaseModel):
    bankroll: float = 1000.0
    stake: float = 20.0
    target: float = 2.0
    rounds: int = Field(default=500, ge=10, le=5000)
    trials: int = Field(default=4000, ge=200, le=20000)


# ---------------------------------------------------------------------------
# meta
# ---------------------------------------------------------------------------

@api.get("/health")
def health() -> Dict[str, Any]:
    db.init_db()
    return {
        "status": "ok",
        "version": VERSION,
        "engines": ["pareto", "exponential", "markov", "gmm", "regimes", "ensemble", "eta",
                    "ladder", "dna", "calibration", "randomness", "fairness", "ev", "backtest"],
        "routes": sum(1 for r in app.routes for _ in getattr(r, "methods", []) or []),
    }


@api.get("/meta")
def meta(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    _ensure_seeded(v)
    return {
        "version": VERSION,
        "visitor": v,
        "rounds": db.count_rounds(v),
        "sources": db.source_counts(v),
        "settings": db.get_settings(v),
        "edgePresets": ev.HOUSE_EDGE_PRESETS,
        "liveClients": hub.client_count(v),
        "seedSource": {"serverSeed": SEED_SERVER, "clientSeed": SEED_CLIENT,
                       "note": "the demo tape is generated by the provably-fair algorithm, so "
                               "every seeded round can be independently recomputed"},
    }


# ---------------------------------------------------------------------------
# rounds
# ---------------------------------------------------------------------------

@api.get("/rounds")
def get_rounds(limit: int = Query(default=2000, ge=1, le=5000),
               x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    _ensure_seeded(v)
    rounds = db.recent_rounds(limit, v)
    return {"rounds": rounds, "total": db.count_rounds(v)}


def _arm_prediction(visitor: str, force: bool = False,
                    analysis: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Lock a committed forecast for the next round from the current tape.

    This used to happen only when a single round arrived, which meant a tape that
    was seeded, imported, reseeded or ingested from a database never armed one and
    the predictor sat on "warming up" forever — the engine had everything it needed
    and simply had not been asked. Arming is idempotent: an open forecast is left
    alone unless `force` is set, because re-locking would reset the commit time and
    let the forecast be silently revised after the fact, which is the one thing the
    ledger exists to prevent.

    `analysis` is optional: when the caller (e.g. _ingest) just computed one for
    the same tape, passing it avoids a second ~1.4s analyze of the same data.
    """
    if not force and db.open_prediction(visitor):
        return db.open_prediction(visitor)
    tape = _tape(visitor)
    if len(tape) < 10:
        return None
    analysis = analysis if analysis is not None else pipeline.analyze(tape)
    cands = pipeline.candidates(tape, analysis)
    if not cands:
        return None
    top = cands[0]
    last = db.recent_rounds(1, visitor)
    return db.lock_prediction(visitor, {
        "targetRoundId": (last[0]["id"] + 1) if last else None,
        "state": top["state"],
        "band": [float(top["range"][0]),
                 float(top["range"][1]) if top["range"][1] is not None else 1e9],
        "probability": top["probability"],
        "pAbove2": pipeline.probability_above(tape, 2.0),
        "pAbove10": pipeline.probability_above(tape, 10.0),
        "eta": analysis["eta"]["estimated_crash_point"],
        "distribution": {c["state"]: c["probability"] for c in cands},
        "drivers": top.get("drivers") or [],
    })


# Serialises ingest compute across its worker threads. The event loop is
# otherwise blocked by the synchronous analyze + arm work done here, which
# starves the WebSocket push that hands the new round to the panels — the
# visible symptom was "forecast panels not updating on new rounds".
_ingest_lock = asyncio.Lock()


def _ingest_sync(visitor: str, multiplier: float, source: str,
                 ts: Optional[str] = None) -> Dict[str, Any]:
    """Synchronous ingest body — runs off the event loop (see _ingest).

    Every step here is CPU-bound or disk-bound with no awaits, so it must not
    run on the loop thread. The engine is check_same_thread=False and each
    call opens its own short-lived session, which is why this is thread-safe.
    """
    settings = db.get_settings(visitor)
    edge = settings["houseEdge"]

    # resolve the open committed forecast against reality BEFORE storing the round
    resolved = db.resolve_open_predictions(visitor, multiplier, strategies.realized_state(multiplier))
    row = db.insert_round(multiplier, visitor, source=source, ts=ts)

    tape = _tape(visitor)
    analysis = pipeline.analyze(tape) if len(tape) >= 10 else None
    context = strategies.live_context(tape, edge)
    fired = db.evaluate_alerts(visitor, multiplier, row["id"], {
        "dry_streak": context.get("dryStreak", 0),
        "pressure": context.get("pressure", 0),
        "p_above_2": pipeline.probability_above(tape, 2.0) if analysis else 0,
        "eta": analysis["eta"]["estimated_crash_point"] if analysis else 0,
    })

    # lock the next committed forecast (the open one was just resolved above).
    # Pass the analysis we just computed: _arm_prediction used to re-run
    # analyze on the same tape, doubling the per-round CPU cost.
    locked = _arm_prediction(visitor, force=True, analysis=analysis) if analysis else None

    return {"type": "round", "round": row, "resolved": resolved, "locked": locked,
            "context": context, "alerts": fired,
            "state": analysis["state"] if analysis else None}


async def _ingest(visitor: str, multiplier: float, source: str,
                  ts: Optional[str] = None) -> Dict[str, Any]:
    """Ingest one round through the live pipeline, without blocking the loop.

    The heavy synchronous body (analyze + candidates + arm) runs in a worker
    thread; the event loop only awaits the broadcast. Concurrency: a per-
    visitor lock keeps round ordering stable (a round must never resolve or
    arm ahead of the one before it), while unrelated visitors stay parallel.
    `ts` carries the round's own timestamp when one is known (file watcher).
    """
    async with _ingest_lock:
        payload = await asyncio.to_thread(_ingest_sync, visitor, multiplier, source, ts)
    await hub.broadcast(visitor, payload)
    return payload


@api.post("/rounds")
async def post_round(body: RoundIn,
                     x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    _ensure_seeded(v)
    return await _ingest(v, round(body.multiplier, 2), body.source)


@api.post("/rounds/bulk")
async def post_rounds_bulk(body: BulkIn,
                           x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    if body.mode == "replace":
        db.clear_rounds(v)
    values = [round(m, 2) for m in body.multipliers if m >= 1.0]
    n = db.insert_rounds_bulk(values, v, source="import")
    locked = _arm_prediction(v, force=True)
    await hub.broadcast(v, {"type": "bulk", "inserted": n, "total": db.count_rounds(v)})
    return {"inserted": n, "skipped": len(body.multipliers) - n, "total": db.count_rounds(v),
            "locked": locked}


@api.patch("/rounds/{round_id}")
def patch_round(round_id: int, multiplier: float = Body(embed=True, ge=1.0),
                x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    row = db.update_round(round_id, round(multiplier, 2), v)
    if not row:
        raise HTTPException(404, "round not found")
    return {"round": row}


@api.delete("/rounds/{round_id}")
def remove_round(round_id: int,
                 x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return {"deleted": db.delete_round(round_id, v)}


@api.delete("/rounds")
def clear_all_rounds(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return {"deleted": db.clear_rounds(v)}


@api.post("/rounds/reseed")
def reseed(count: int = Query(default=900, ge=50, le=5000),
           serverSeed: Optional[str] = None, clientSeed: Optional[str] = None,
           x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    """Regenerate the tape from a provably-fair seed pair — fully reproducible."""
    v = visitor_of(x_visitor_id)
    edge = db.get_settings(v)["houseEdge"]
    ss = serverSeed or secrets.token_hex(16)
    cs = clientSeed or SEED_CLIENT
    db.clear_rounds(v)
    tape = fairness.generate_provable_tape(ss, cs, count=count, house_edge=edge)
    db.insert_rounds_bulk(tape, v, source="provably-fair-seed")
    locked = _arm_prediction(v, force=True)
    return {"inserted": len(tape), "serverSeed": ss, "clientSeed": cs,
            "serverSeedHash": fairness.sha256_hex(ss), "houseEdge": edge, "locked": locked}


# ---------------------------------------------------------------------------
# SQLite ingest — seed the engines from a real tape
# ---------------------------------------------------------------------------

@api.post("/ingest/db/inspect")
async def ingest_db_inspect(file: UploadFile = File(...),
                           x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    """Stage an uploaded .db and report every table and candidate column in it."""
    v = visitor_of(x_visitor_id)
    data = await file.read()
    try:
        staged = ingest.stage_upload(data, file.filename or "upload.db", v)
        report = ingest.inspect_database(ingest.upload_path(staged["uploadId"], v)["path"])
    except ingest.IngestError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {**staged, **report, "limits": {
        "maxBytes": ingest.MAX_UPLOAD_BYTES, "maxRows": ingest.MAX_INGEST_ROWS,
        "expiresInSeconds": ingest.UPLOAD_TTL_SECONDS,
    }}


@api.post("/ingest/db")
async def ingest_db_commit(body: DbIngestIn,
                          x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    """Extract the chosen column and seed the tape with it.

    `dryRun` extracts and scores without writing, which is the step that catches a
    wrong column before it poisons every estimate downstream.
    """
    v = visitor_of(x_visitor_id)
    edge = db.get_settings(v)["houseEdge"]
    table, column = body.table, body.column
    timestamp_column, scale = body.timestampColumn, body.scale
    auto: Optional[Dict[str, Any]] = None
    try:
        entry = ingest.upload_path(body.uploadId, v)
        if not table or not column:
            # Auto mode: let the detector choose, and report exactly what it chose
            # and why, so an automatic pick is still an auditable one.
            rec = ingest.inspect_database(entry["path"]).get("recommendation")
            if not rec or not rec.get("trusted"):
                detail = (
                    "nothing in this database looks enough like a column of crash multipliers "
                    "to seed the engines from it unattended — inspect it and choose a table and "
                    "column manually"
                )
                if rec:
                    detail += (f" (best guess was {rec['table']}.{rec['column']} at "
                               f"{rec['confidence']:.2f} confidence, below the "
                               f"{rec['confidenceFloor']:.2f} floor: {rec['why']})")
                raise ingest.IngestError(detail)
            table = table or rec["table"]
            column = column or rec["column"]
            if timestamp_column is None:
                timestamp_column = rec.get("timestampColumn")
            if scale is None:
                scale = rec.get("scale")
            auto = {"table": table, "column": column, "timestampColumn": timestamp_column,
                    "scale": scale, "confidence": rec.get("confidence"), "why": rec.get("why")}
        extracted = ingest.extract_rounds(
            entry["path"], table, column,
            timestamp_column=timestamp_column, scale=scale,
            limit=body.limit, newest_first=body.newestFirst,
        )
    except ingest.IngestError as exc:
        raise HTTPException(400, str(exc)) from exc

    values = extracted.pop("values")
    stamps = extracted.pop("timestamps")
    preview = ingest.preview_stats(values, edge)
    result: Dict[str, Any] = {
        "file": entry["filename"],
        "table": table,
        "column": column,
        "timestampColumn": timestamp_column,
        "auto": auto,
        "extraction": extracted,
        "preview": preview,
        "dryRun": body.dryRun,
    }
    if body.dryRun:
        result["note"] = "Nothing was written. Review the preview, then ingest for real."
        return result
    if not values:
        raise HTTPException(400, "no rounds at or above 1.00x were found in that column")

    if body.mode == "replace":
        result["cleared"] = db.clear_rounds(v)
    inserted = db.insert_rounds_stamped(list(zip(values, stamps)), v,
                                        source=f"db:{table}.{column}")
    total = db.count_rounds(v)
    rounds = db.recent_rounds(4000, v)
    multipliers = [r["m"] for r in rounds]
    cadence = windows.median_interval_ms(rounds)
    phases = windows.hour_phases(rounds, 2.0)
    result.update({
        "inserted": inserted,
        "total": total,
        "cadence": cadence,
        "hoursCovered": phases["hoursCovered"],
        "phasesTestable": phases["testable"],
        "baseRates": {
            str(t): round(sum(1 for m in multipliers if m >= t) / len(multipliers), 5)
            for t in (2.0, 10.0) if multipliers
        },
        "note": (
            f"{inserted} rounds now seed every engine. "
            + (f"Cadence measured at {cadence['ms'] / 1000:.1f}s, so window odds are in real time. "
               if cadence["measured"] else "Cadence could not be measured from these timestamps. ")
            + (f"The tape spans {phases['hoursCovered']} clock hours, so the time-of-day test is live."
               if phases["testable"] else "The tape covers too few hours for the time-of-day test.")
        ),
    })
    result["locked"] = _arm_prediction(v, force=True)
    ingest.discard_upload(body.uploadId)
    await hub.broadcast(v, {"type": "bulk", "inserted": inserted, "total": total})
    return result


@api.delete("/ingest/db/{upload_id}")
def ingest_db_discard(upload_id: str) -> Dict[str, Any]:
    return {"discarded": ingest.discard_upload(upload_id)}


@api.get("/export")
def export(fmt: str = Query(default="json", pattern="^(json|csv)$"),
           visitor: Optional[str] = None,
           x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")):
    v = visitor_of(x_visitor_id or visitor)
    rounds = db.recent_rounds(5000, v)
    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["id", "timestamp", "multiplier", "band", "source"])
        for r in rounds:
            w.writerow([r["id"], r["ts"], r["m"], r["band"], r["source"]])
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": "attachment; filename=momento-rounds.csv"})
    return Response(json.dumps(rounds, indent=2), media_type="application/json",
                    headers={"Content-Disposition": "attachment; filename=momento-rounds.json"})


# ---------------------------------------------------------------------------
# analysis
# ---------------------------------------------------------------------------

@api.get("/analysis")
def get_analysis(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    _ensure_seeded(v)
    tape = _tape(v)
    if len(tape) < 10:
        return {"error": "insufficient data", "rounds": len(tape)}
    payload = pipeline.analyze(tape)
    payload["context"] = strategies.live_context(tape, db.get_settings(v)["houseEdge"])
    return payload


@api.get("/forecast")
def get_forecast(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    if len(tape) < 10:
        return {"candidates": [], "rounds": len(tape)}
    a = pipeline.analyze(tape)
    edge = db.get_settings(v)["houseEdge"]
    cands = pipeline.candidates(tape, a)
    for c in cands:
        lo = float(c["range"][0])
        c["fairProbability"] = ev.probability_above(lo, edge)
    return {"candidates": cands, "open": _arm_prediction(v),
            "fairPriceNote": "fairProbability is what an unbeatable game charges for that band"}


@api.get("/seed")
def get_seed_evidence() -> Dict[str, Any]:
    """Prior-data evidence from the repo seed/ folder (avfs.db, momento.db).

    Not the live tape: a large, stable reference distribution the forecast's
    estimated value is validated against and anchored to. Read-only + cached.
    """
    return seed_evidence.load_seed_evidence()


@api.get("/eta")
def get_eta(threshold: float = 2.0,
            x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    if len(tape) < 10:
        return {"error": "insufficient data"}
    a = pipeline.analyze(tape)
    edge = db.get_settings(v)["houseEdge"]
    return {
        "eta": a["eta"],
        "p_above_threshold": pipeline.probability_above(tape, threshold),
        "fair_probability": ev.probability_above(threshold, edge),
        "threshold": threshold,
        "survival_curve": pipeline.survival_curve(tape, house_edge=edge),
        "calibration": survival.diagnostics(tape[-600:], edge),
    }


@api.get("/survival")
def get_survival(maximum: float = Query(default=20.0, gt=1.0, le=500),
                 steps: int = Query(default=60, ge=10, le=200),
                 x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    _ensure_seeded(v)
    tape = _tape(v)
    edge = db.get_settings(v)["houseEdge"]
    return {"curve": survival.curve(tape[-600:], maximum, steps, edge),
            "diagnostics": survival.diagnostics(tape[-600:], edge),
            "rounds": len(tape)}


@api.get("/curves")
def get_curves(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    if len(tape) < 10:
        return {"error": "insufficient data"}
    return {"distribution": mm.curve_shape_distribution(tape)}


@api.get("/ladder")
def get_ladder(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    if len(tape) < 20:
        return {"error": "insufficient data"}
    return {"ladders": pipeline.detect_ladders(tape), "ceilings": pipeline.detect_ceilings(tape),
            "eta": pipeline.ladder_eta(tape)}


@api.get("/dna")
def get_dna(patternLen: int = Query(default=8, ge=3, le=24),
            topK: int = Query(default=6, ge=1, le=20),
            x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    if len(tape) < patternLen * 4:
        return {"error": "insufficient data"}
    result = pipeline.dna_match(tape, patternLen, topK)
    result["caveat"] = (
        "Nearest-neighbour matching on an i.i.d. tape always finds close analogues — the number of "
        "candidate windows grows with the corpus while genuine information stays at zero. Treat the "
        "vote as a description of the past, never a forecast."
    )
    return result


@api.get("/context")
def get_context(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return strategies.live_context(_tape(v), db.get_settings(v)["houseEdge"])


@api.get("/stats/summary")
def stats_summary(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    _ensure_seeded(v)
    tape = _tape(v)
    settings = db.get_settings(v)
    edge = settings["houseEdge"]
    _arm_prediction(v)   # arm before counting, so "forecasts locked" includes it
    preds = db.predictions(500, v)
    resolved = [p for p in preds if p["actual"] is not None]
    band_hits = sum(1 for p in resolved if p["bandHit"])
    hit2 = sum(1 for p in resolved if p["hit2"])
    briers = [p["brier"] for p in resolved if p["brier"] is not None]
    return {
        "rounds": len(tape),
        "houseEdge": edge,
        "rtp": 1 - edge,
        "operator": settings["operator"],
        "hitRate2x": sum(1 for m in tape if m >= 2) / len(tape) if tape else 0,
        "fairHitRate2x": ev.probability_above(2.0, edge),
        "hitRate10x": sum(1 for m in tape if m >= 10) / len(tape) if tape else 0,
        "fairHitRate10x": ev.probability_above(10.0, edge),
        "instantCrashRate": sum(1 for m in tape if m <= 1.001) / len(tape) if tape else 0,
        "medianObserved": sorted(tape)[len(tape) // 2] if tape else 0,
        "medianFair": ev.median_crash(edge),
        "maxObserved": max(tape) if tape else 0,
        "ledger": {
            "locked": len(preds), "resolved": len(resolved),
            "bandAccuracy": band_hits / len(resolved) if resolved else 0,
            "accuracy2x": hit2 / len(resolved) if resolved else 0,
            "avgBrier": sum(briers) / len(briers) if briers else None,
            "open": db.open_prediction(v),
        },
        "context": strategies.live_context(tape, edge),
    }


# ---------------------------------------------------------------------------
# ledger
# ---------------------------------------------------------------------------

@api.post("/predictions/arm")
def arm_prediction(force: bool = Query(default=False),
                   x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    """Commit a forecast for the next round from the tape as it stands.

    `force` re-locks even if one is open, which is what the Predictor's re-arm
    control uses after settings change. It is recorded as a fresh lock with a new
    timestamp, never as an edit of the previous one.
    """
    v = visitor_of(x_visitor_id)
    locked = _arm_prediction(v, force=force)
    if locked is None:
        raise HTTPException(400, "need at least 10 rounds on the tape before a forecast can be committed")
    return {"open": locked, "forced": force}


@api.get("/ledger")
def get_ledger(limit: int = Query(default=200, ge=1, le=500),
               x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    # Arm BEFORE listing: reading the list first meant a freshly committed forecast
    # was absent from `entries`, so a client deriving the open forecast from the
    # list saw none and reported the predictor as unarmed.
    _arm_prediction(v)
    entries = db.predictions(limit, v)
    resolved = [e for e in entries if e["actual"] is not None]
    briers = [e["brier"] for e in resolved if e["brier"] is not None]
    by_state: Dict[str, Dict[str, int]] = {}
    for e in resolved:
        s = by_state.setdefault(e["state"], {"n": 0, "hits": 0})
        s["n"] += 1
        s["hits"] += int(bool(e["bandHit"]))
    return {
        "open": db.open_prediction(v),
        "entries": entries,
        "resolvedCount": len(resolved),
        "bandAccuracy": sum(1 for e in resolved if e["bandHit"]) / len(resolved) if resolved else 0,
        "accuracy2x": sum(1 for e in resolved if e["hit2"]) / len(resolved) if resolved else 0,
        "accuracy10x": sum(1 for e in resolved if e["hit10"]) / len(resolved) if resolved else 0,
        "avgBrier": sum(briers) / len(briers) if briers else None,
        "byState": [{"state": k, "samples": x["n"], "bandAccuracy": x["hits"] / x["n"]}
                    for k, x in sorted(by_state.items())],
    }


@api.get("/calibration")
def get_calibration(threshold: float = Query(default=2.0, gt=1.0),
                    warmup: int = Query(default=120, ge=40, le=1000),
                    x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return strategies.calibration(_tape(v), threshold, warmup,
                                  house_edge=db.get_settings(v)["houseEdge"])


# ---------------------------------------------------------------------------
# randomness battery
# ---------------------------------------------------------------------------

@api.get("/randomness")
def get_randomness(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    _ensure_seeded(v)
    return randomness.full_battery(_tape(v), db.get_settings(v)["houseEdge"])


@api.get("/randomness/{test}")
def get_randomness_test(test: str, threshold: float = 2.0,
                        x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    edge = db.get_settings(v)["houseEdge"]
    table = {
        "house-edge": lambda: randomness.estimate_house_edge(tape),
        "chi-square": lambda: randomness.chi_square_fit(tape, edge),
        "ks": lambda: randomness.ks_test(tape, edge),
        "runs": lambda: randomness.runs_test(tape, threshold),
        "autocorrelation": lambda: randomness.autocorrelation(tape),
        "dependence": lambda: randomness.conditional_dependence(tape, threshold),
        "digits": lambda: randomness.digit_uniformity(tape),
    }
    if test not in table:
        raise HTTPException(404, f"unknown test — try one of {sorted(table)}")
    return table[test]()


# ---------------------------------------------------------------------------
# expected value / bankroll
# ---------------------------------------------------------------------------

@api.get("/ev/table")
def get_ev_table(stake: float = 10.0, targets: Optional[str] = None,
                 x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    parsed = [float(t) for t in targets.split(",")] if targets else None
    return ev.ev_table(parsed, stake, db.get_settings(v)["houseEdge"])


@api.get("/ev/kelly")
def get_kelly(target: float = 2.0, modelProbability: Optional[float] = None,
              x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    edge = db.get_settings(v)["houseEdge"]
    p = modelProbability
    if p is None and len(tape) >= 160:
        p = strategies._blended_survival(tape[-400:], target)
    result = ev.kelly(target, edge, p)
    result["source"] = "live engine estimate" if modelProbability is None else "user supplied"
    return result


@api.post("/ev/ruin")
def post_ruin(body: RuinIn,
              x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return ev.risk_of_ruin(body.bankroll, body.stake, body.target,
                           db.get_settings(v)["houseEdge"], body.rounds, body.trials)


@api.get("/ev/martingale")
def get_martingale(bankroll: float = 1000.0, baseStake: float = 10.0, target: float = 2.0,
                   x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return ev.martingale_analysis(bankroll, baseStake, target, db.get_settings(v)["houseEdge"])


@api.get("/ev/plan")
def get_plan(bankroll: Optional[float] = None, target: Optional[float] = None,
             x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    s = db.get_settings(v)
    return ev.bankroll_plan(bankroll or s["bankroll"], s["sessionLossLimit"],
                            s["maxRiskPerRound"], target or s["defaultTarget"], s["houseEdge"])


# ---------------------------------------------------------------------------
# backtesting
# ---------------------------------------------------------------------------

@api.post("/backtest")
def post_backtest(body: BacktestIn,
                  x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return strategies.backtest(
        _tape(v), body.target, body.startBankroll, body.staking, body.stake,
        body.kellyFraction, body.minEdge, body.warmup, db.get_settings(v)["houseEdge"])


@api.get("/backtest/grid")
def get_grid(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    out = strategies.strategy_grid(_tape(v), house_edge=db.get_settings(v)["houseEdge"])
    if "error" in out:
        raise HTTPException(status_code=422, detail=out["error"])
    return out


# ---------------------------------------------------------------------------
# exposure: window odds, exceedance grid, droughts, time-of-day
# ---------------------------------------------------------------------------

@api.get("/windows")
def get_windows(thresholds: Optional[str] = Query(default=None,
                                                 description="comma-separated multipliers"),
                x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    """P(at least one hit) per threshold over 15m / 1h / 4h / 1d / 7d."""
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    if len(tape) < 30:
        raise HTTPException(status_code=422, detail="need at least 30 rounds")
    ts = _parse_thresholds(thresholds, (2.0, 5.0, 10.0, 50.0, 100.0))
    rows = db.recent_rounds(400, v)
    return windows.window_odds(tape, rows, db.get_settings(v)["houseEdge"], ts)


@api.get("/exceedance")
def get_exceedance(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    """Observed vs fair exceedance at twelve thresholds, with Wilson intervals."""
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    if len(tape) < 20:
        raise HTTPException(status_code=422, detail="need at least 20 rounds")
    return windows.exceedance_grid(tape, db.get_settings(v)["houseEdge"])


@api.get("/droughts")
def get_droughts(thresholds: Optional[str] = Query(default=None),
                 x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    """Rounds since each threshold last printed, and how ordinary that gap is."""
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    if len(tape) < 20:
        raise HTTPException(status_code=422, detail="need at least 20 rounds")
    ts = _parse_thresholds(thresholds, windows.LIVE_THRESHOLDS)
    return windows.droughts(tape, ts)


@api.get("/phases")
def get_phases(threshold: float = Query(default=2.0, gt=1.0),
               x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    """Hour-of-day hit rates plus a chi-square test for a genuine time effect."""
    v = visitor_of(x_visitor_id)
    rows = db.recent_rounds(4000, v)
    if len(rows) < 30:
        raise HTTPException(status_code=422, detail="need at least 30 rounds")
    return windows.hour_phases(rows, threshold)


@api.get("/skill")
def get_skill(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    """Walk-forward Brier skill of every ensemble component at every threshold."""
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    if len(tape) < 150:
        raise HTTPException(status_code=422, detail="need at least 150 rounds to score walk-forward")
    return windows.leaderboard(tape)


# ---------------------------------------------------------------------------
# provably fair
# ---------------------------------------------------------------------------

@api.post("/fair/verify")
def fair_verify(body: VerifyIn,
                x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    result = fairness.verify_round(body.serverSeed, body.clientSeed, body.nonce, body.observed,
                                   body.houseEdge, body.algorithm, body.serverSeedHash,
                                   body.template)
    if body.save:
        result["saved"] = db.save_seed_audit(v, result, body.label)
    return result


@api.post("/fair/verify-batch")
def fair_verify_batch(body: VerifyBatchIn) -> Dict[str, Any]:
    return fairness.verify_batch(body.serverSeed, body.clientSeed, body.startNonce,
                                 body.observed, body.houseEdge, body.algorithm)


@api.post("/fair/solve")
def fair_solve(body: SolveIn) -> Dict[str, Any]:
    """Work out which provably-fair convention an operator uses from one known round."""
    return fairness.solve_convention(body.serverSeed, body.clientSeed, body.nonce, body.observed)


@api.get("/fair/conventions")
def fair_conventions() -> Dict[str, Any]:
    return {
        "templates": [{"id": k, "pattern": v} for k, v in fairness.MESSAGE_TEMPLATES.items()],
        "default": fairness.DEFAULT_TEMPLATE,
        "algorithms": ["hmac_sha256", "hmac_sha512", "bustabit"],
        "edgePresets": ev.HOUSE_EDGE_PRESETS,
        "reference": "https://provenlyfair.com/blog/verify-provably-fair-crash/",
    }


@api.post("/fair/chain")
def fair_chain(body: ChainIn) -> Dict[str, Any]:
    result = fairness.verify_seed_chain(body.revealedSeed, body.committedHash, body.iterations)
    if not result["valid"] and body.search:
        result["search"] = fairness.find_chain_depth(body.revealedSeed, body.committedHash)
    return result


@api.get("/fair/hash")
def fair_hash(value: str) -> Dict[str, Any]:
    return {"input": value, "sha256": fairness.sha256_hex(value)}


@api.get("/fair/audits")
def fair_audits(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    rows = db.list_seed_audits(v)
    return {"audits": rows,
            "verified": sum(1 for r in rows if r["matched"]),
            "failed": sum(1 for r in rows if r["matched"] is False)}


@api.get("/fair/tape")
def fair_tape(serverSeed: str, clientSeed: str = "", count: int = Query(default=50, ge=1, le=2000),
              startNonce: int = 1, houseEdge: float = 0.01) -> Dict[str, Any]:
    nonces = list(range(startNonce, startNonce + count))
    rows = [fairness.crash_point_stake(serverSeed, clientSeed, n, houseEdge) for n in nonces]
    return {"rounds": [{"nonce": n, "crashPoint": r["crash_point"], "integer": r["integer"]}
                       for n, r in zip(nonces, rows)],
            "multipliers": [r["crash_point"] for r in rows],
            "serverSeedHash": fairness.sha256_hex(serverSeed)}


# ---------------------------------------------------------------------------
# alerts
# ---------------------------------------------------------------------------

@api.get("/alerts")
def get_alerts(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    _ensure_seeded(v)
    return {"alerts": db.list_alerts(v), "events": db.alert_events(60, v),
            "kinds": [
                {"id": "multiplier", "label": "Round multiplier", "unit": "×"},
                {"id": "dry_streak", "label": "Dry streak under 2×", "unit": "rounds"},
                {"id": "pressure", "label": "Ladder pressure score", "unit": "0–1"},
                {"id": "p_above_2", "label": "Engine P(≥2×)", "unit": "0–1"},
                {"id": "eta", "label": "Crash-point ETA", "unit": "×"},
            ]}


@api.post("/alerts")
def post_alert(body: AlertIn,
               x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return db.create_alert(v, body.name, body.kind, body.comparator, body.threshold)


@api.patch("/alerts/{alert_id}")
def patch_alert(alert_id: int, active: bool = Body(embed=True),
                x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    row = db.toggle_alert(v, alert_id, active)
    if not row:
        raise HTTPException(404, "alert not found")
    return row


@api.delete("/alerts/{alert_id}")
def delete_alert(alert_id: int,
                 x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return {"deleted": db.delete_alert(v, alert_id)}


# ---------------------------------------------------------------------------
# bankroll sessions
# ---------------------------------------------------------------------------

@api.get("/sessions")
def get_sessions(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    sessions = db.list_sessions(v)
    return {"sessions": sessions,
            "totalPnl": sum(s["pnl"] for s in sessions),
            "openSession": next((s for s in sessions if s["status"] == "open"), None)}


@api.post("/sessions")
def post_session(body: SessionIn,
                 x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return db.create_session(v, body.name, body.bankroll, body.stake, body.target, body.lossLimit)


@api.post("/sessions/{session_id}/close")
def post_close_session(session_id: int,
                       x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    row = db.close_session(v, session_id)
    if not row:
        raise HTTPException(404, "session not found")
    return row


@api.get("/sessions/{session_id}/bets")
def get_bets(session_id: int,
             x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return {"bets": db.list_bets(v, session_id)}


@api.post("/sessions/{session_id}/bets")
def post_bet(session_id: int, body: BetIn,
             x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    result = db.log_bet(v, session_id, body.stake, body.target, body.result, body.note)
    if not result:
        raise HTTPException(404, "session not found")
    return result


# ---------------------------------------------------------------------------
# settings
# ---------------------------------------------------------------------------

@api.get("/settings")
def get_settings_route(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return {"settings": db.get_settings(v), "presets": ev.HOUSE_EDGE_PRESETS,
            "defaults": db.DEFAULT_SETTINGS}


@api.put("/settings")
def put_settings(body: SettingsIn,
                 x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return {"settings": db.save_settings(v, body.model_dump(exclude_none=True))}


# ---------------------------------------------------------------------------
# simulator — a provably-fair generator, not a fake one
# ---------------------------------------------------------------------------

_sim_tasks: Dict[str, asyncio.Task] = {}
_sim_state: Dict[str, Dict[str, Any]] = {}


async def _sim_loop(visitor: str, interval_ms: int, server_seed: str, client_seed: str,
                    house_edge: float) -> None:
    state = _sim_state[visitor]
    try:
        while True:
            await asyncio.sleep(max(0.4, interval_ms / 1000))
            state["nonce"] += 1
            m = fairness.crash_point_stake(server_seed, client_seed, state["nonce"], house_edge)["crash_point"]
            await _ingest(visitor, m, "simulator")
    except asyncio.CancelledError:
        return


@api.post("/sim/start")
async def sim_start(intervalMs: int = Query(default=2500, ge=400, le=60000),
                    x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    _ensure_seeded(v)
    settings = db.get_settings(v)
    if not settings.get("simulatorEnabled", False):
        raise HTTPException(409, (
            "the generator is disabled: the live tape is fed by the file watcher. "
            "Enable it in Settings (allow the generator to run) to mix generated "
            "rounds into the feed."
        ))
    if v in _sim_tasks and not _sim_tasks[v].done():
        return {"running": True, "already": True, **_sim_state[v]}
    edge = settings["houseEdge"]
    server_seed = secrets.token_hex(16)
    client_seed = f"momento-live-{random.randint(1000, 9999)}"
    _sim_state[v] = {"serverSeed": server_seed, "clientSeed": client_seed, "nonce": 0,
                     "serverSeedHash": fairness.sha256_hex(server_seed),
                     "intervalMs": intervalMs, "houseEdge": edge}
    _sim_tasks[v] = asyncio.create_task(_sim_loop(v, intervalMs, server_seed, client_seed, edge))
    return {"running": True, **_sim_state[v],
            "note": "every simulated round is derived from this seed pair, so the feed itself is "
                    "verifiable on the Fairness page"}


@api.post("/sim/stop")
async def sim_stop(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    task = _sim_tasks.pop(v, None)
    if task:
        task.cancel()
    return {"running": False, "state": _sim_state.get(v)}


@api.post("/rounds/purge-simulator")
def purge_simulator_rounds(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    """Strip generator-produced rounds out of the tape.

    The live tape is meant to carry only file-watched rounds; while the
    generator ran it mixed its (generated) rounds into the same sequence. This
    removes them and drops any open forecast that targeted a removed round.
    """
    v = visitor_of(x_visitor_id)
    removed = db.delete_rounds_by_source("simulator", v)
    # re-arm on the cleaned tape so the open forecast reflects file-watched data
    locked = _arm_prediction(v, force=True)
    return {"removed": removed, "total": db.count_rounds(v), "locked": locked}


@api.get("/sim/status")
def sim_status(x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    task = _sim_tasks.get(v)
    return {"running": bool(task and not task.done()), "state": _sim_state.get(v),
            "liveClients": hub.client_count(v)}


# ---------------------------------------------------------------------------
# websocket
# ---------------------------------------------------------------------------

@app.websocket("/ws/rounds")
async def ws_rounds(ws: WebSocket, visitor: Optional[str] = None) -> None:
    v = (visitor or ws.headers.get("x-visitor-id") or db.DEFAULT_VISITOR)[:120]
    await hub.connect(ws, v)
    try:
        await ws.send_json({"type": "hello", "visitor": v, "version": VERSION,
                            "rounds": db.count_rounds(v)})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(ws, v)
    except Exception:
        hub.disconnect(ws, v)


# ---------------------------------------------------------------------------
# chart annotations — drawings the user places on a chart, in data coordinates
# ---------------------------------------------------------------------------

@api.get("/annotations")
def get_annotations(chart: Optional[str] = None,
                    x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return {"annotations": db.list_annotations(v, chart)}


@api.post("/annotations")
def post_annotation(body: AnnotationIn,
                    x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    if body.kind not in {"level", "trend", "rect", "pen"}:
        raise HTTPException(422, "unknown annotation kind")
    if not body.points:
        raise HTTPException(422, "an annotation needs at least one point")
    # A freehand stroke can carry hundreds of samples; cap it so one drawing
    # cannot bloat the row past anything the chart will ever need to redraw.
    points = [[float(p[0]), float(p[1])] for p in body.points[:2000] if len(p) >= 2]
    return db.create_annotation(v, body.chart, body.kind, points, body.color, body.label)


@api.patch("/annotations/{annotation_id}")
def patch_annotation(annotation_id: int, body: AnnotationPatch,
                     x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    row = db.update_annotation(v, annotation_id, body.points, body.color, body.label)
    if not row:
        raise HTTPException(404, "annotation not found")
    return row


@api.delete("/annotations/{annotation_id}")
def remove_annotation(annotation_id: int,
                      x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return {"deleted": db.delete_annotation(v, annotation_id)}


@api.delete("/annotations")
def clear_annotations_route(chart: Optional[str] = None,
                           x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    return {"deleted": db.clear_annotations(v, chart)}


app.include_router(api)


@app.get("/")
def root() -> Dict[str, Any]:
    return {"service": "Momento Analytics API", "version": VERSION, "docs": "/docs",
            "disclaimer": "Analytics and verification only. A correctly implemented crash game "
                          "cannot be predicted; every expected value here is negative by design."}
