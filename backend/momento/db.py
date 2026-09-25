"""Momento storage layer — SQLite (WAL mode) via SQLAlchemy.

Every table is scoped by `visitor_id` so a deployed instance keeps each
browser's tape, ledger, alerts and bankroll sessions separate.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    Boolean, Column, Float, Integer, String, Text, create_engine, event, func,
)
from sqlalchemy.orm import Session, declarative_base, sessionmaker

DB_PATH = os.environ.get("MOMENTO_DB", os.path.join(os.path.dirname(os.path.dirname(__file__)), "momento.db"))
Base = declarative_base()

DEFAULT_VISITOR = "local"


# ---------------------------------------------------------------------------
# schema
# ---------------------------------------------------------------------------

class Round(Base):
    __tablename__ = "rounds"
    id = Column(Integer, primary_key=True, autoincrement=True)
    visitor_id = Column(String, nullable=False, default=DEFAULT_VISITOR, index=True)
    timestamp = Column(String, nullable=False)
    multiplier = Column(Float, nullable=False)
    band = Column(String, nullable=True)
    nonce = Column(Integer, nullable=True)
    source = Column(String, nullable=False, default="api")
    created_at = Column(String, nullable=False)


class Prediction(Base):
    """Committed forecast ledger — locked before a round, resolved after it.

    sqlite_autoincrement is not cosmetic here. A plain INTEGER PRIMARY KEY is the
    rowid, and SQLite hands a freed rowid back out, so replacing an unresolved
    forecast produced a new commitment carrying the dead one's id — two different
    claims sharing an identity in a ledger whose entire purpose is that a forecast
    cannot be quietly swapped after the fact. AUTOINCREMENT never reuses an id.
    """
    __tablename__ = "predictions"
    __table_args__ = {"sqlite_autoincrement": True}
    id = Column(Integer, primary_key=True, autoincrement=True)
    visitor_id = Column(String, nullable=False, default=DEFAULT_VISITOR, index=True)
    target_round_id = Column(Integer, nullable=True)
    state = Column(String, nullable=False)
    band_lo = Column(Float, nullable=False)
    band_hi = Column(Float, nullable=False)
    probability = Column(Float, nullable=False)
    p_above_2 = Column(Float, nullable=False, default=0.0)
    p_above_10 = Column(Float, nullable=False, default=0.0)
    eta = Column(Float, nullable=True)
    distribution = Column(Text, nullable=True)      # JSON: full 5-state distribution
    drivers = Column(Text, nullable=True)           # JSON: explainability payload
    actual = Column(Float, nullable=True)
    actual_state = Column(String, nullable=True)
    band_hit = Column(Boolean, nullable=True)
    hit_2 = Column(Boolean, nullable=True)
    hit_10 = Column(Boolean, nullable=True)
    brier = Column(Float, nullable=True)
    locked_at = Column(String, nullable=False)
    resolved_at = Column(String, nullable=True)


class Alert(Base):
    __tablename__ = "alerts"
    id = Column(Integer, primary_key=True, autoincrement=True)
    visitor_id = Column(String, nullable=False, default=DEFAULT_VISITOR, index=True)
    name = Column(String, nullable=False)
    kind = Column(String, nullable=False)           # multiplier | dry_streak | regime | pressure | state
    comparator = Column(String, nullable=False, default="gte")
    threshold = Column(Float, nullable=False, default=10.0)
    active = Column(Boolean, nullable=False, default=True)
    trigger_count = Column(Integer, nullable=False, default=0)
    last_triggered_at = Column(String, nullable=True)
    created_at = Column(String, nullable=False)


class AlertEvent(Base):
    __tablename__ = "alert_events"
    id = Column(Integer, primary_key=True, autoincrement=True)
    visitor_id = Column(String, nullable=False, default=DEFAULT_VISITOR, index=True)
    alert_id = Column(Integer, nullable=False)
    alert_name = Column(String, nullable=False)
    message = Column(String, nullable=False)
    value = Column(Float, nullable=True)
    round_id = Column(Integer, nullable=True)
    created_at = Column(String, nullable=False)


class Annotation(Base):
    """A drawing the user placed on a chart.

    Geometry is stored in DATA coordinates, never pixels, so a level drawn at
    3.2x stays at 3.2x through any zoom, resize or device change. What `x` means
    depends on the chart: for tape and candle views it is a round id (stable as
    new rounds append), for distribution views it is a multiplier.
    """
    __tablename__ = "annotations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    visitor_id = Column(String, nullable=False, default=DEFAULT_VISITOR, index=True)
    chart = Column(String, nullable=False, index=True)   # tape|candles|dist|survival|returnmap|equity
    kind = Column(String, nullable=False)                # level|trend|rect|pen
    points = Column(Text, nullable=False)                # JSON [[x, y], ...]
    color = Column(String, nullable=False, default="#38c7e8")
    label = Column(String, nullable=True)
    created_at = Column(String, nullable=False)


class Setting(Base):
    __tablename__ = "settings"
    visitor_id = Column(String, primary_key=True)
    payload = Column(Text, nullable=False)
    updated_at = Column(String, nullable=False)


class BetSession(Base):
    __tablename__ = "bet_sessions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    visitor_id = Column(String, nullable=False, default=DEFAULT_VISITOR, index=True)
    name = Column(String, nullable=False)
    bankroll_start = Column(Float, nullable=False)
    bankroll_current = Column(Float, nullable=False)
    stake = Column(Float, nullable=False)
    target = Column(Float, nullable=False)
    loss_limit = Column(Float, nullable=False)
    status = Column(String, nullable=False, default="open")   # open | closed | stopped_out
    started_at = Column(String, nullable=False)
    ended_at = Column(String, nullable=True)


class Bet(Base):
    __tablename__ = "bets"
    id = Column(Integer, primary_key=True, autoincrement=True)
    visitor_id = Column(String, nullable=False, default=DEFAULT_VISITOR, index=True)
    session_id = Column(Integer, nullable=False, index=True)
    stake = Column(Float, nullable=False)
    target = Column(Float, nullable=False)
    result_multiplier = Column(Float, nullable=False)
    won = Column(Boolean, nullable=False)
    pnl = Column(Float, nullable=False)
    bankroll_after = Column(Float, nullable=False)
    note = Column(String, nullable=True)
    created_at = Column(String, nullable=False)


class SeedAudit(Base):
    __tablename__ = "seed_audits"
    id = Column(Integer, primary_key=True, autoincrement=True)
    visitor_id = Column(String, nullable=False, default=DEFAULT_VISITOR, index=True)
    label = Column(String, nullable=True)
    algorithm = Column(String, nullable=False, default="hmac_sha256")
    server_seed = Column(String, nullable=False)
    server_seed_hash = Column(String, nullable=True)
    client_seed = Column(String, nullable=False)
    nonce = Column(Integer, nullable=False)
    expected = Column(Float, nullable=False)
    observed = Column(Float, nullable=True)
    matched = Column(Boolean, nullable=True)
    commitment_valid = Column(Boolean, nullable=True)
    created_at = Column(String, nullable=False)


_engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


@event.listens_for(_engine, "connect")
def _set_wal(dbapi_connection, _record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    Base.metadata.create_all(_engine)
    _migrate()


def _migrate() -> None:
    """Bring a database created by an earlier version up to the current schema.

    create_all() only creates tables that are absent, so a schema change to an
    existing table is invisible to it. Anything that alters an existing table has
    to be written here or it ships to nobody.
    """
    with _engine.begin() as conn:
        existing = {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(rounds)")}
        for col, ddl in (("visitor_id", "TEXT DEFAULT 'local'"), ("nonce", "INTEGER")):
            if col not in existing:
                conn.exec_driver_sql(f"ALTER TABLE rounds ADD COLUMN {col} {ddl}")
        _migrate_predictions_to_autoincrement(conn)


def _migrate_predictions_to_autoincrement(conn) -> bool:
    """Rebuild a legacy predictions table so its ids are never reused.

    A plain INTEGER PRIMARY KEY is the rowid, and SQLite hands a freed rowid back
    out. Replacing an unresolved forecast therefore produced a new commitment
    carrying the dead one's id — two different claims sharing an identity inside a
    ledger whose whole purpose is that a forecast cannot be quietly swapped after
    the fact. AUTOINCREMENT fixes that, but only for tables created after the
    change, so an existing database needs the table rebuilt.

    SQLite cannot alter a primary key in place, so this is the standard dance:
    rename, recreate, copy, drop. Ids are copied verbatim — the ledger's history
    keeps its identities — and SQLite seeds sqlite_sequence from the highest id
    copied, so new forecasts continue past it instead of reusing anything.
    """
    row = conn.exec_driver_sql(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='predictions'"
    ).fetchone()
    if not row or not row[0] or "AUTOINCREMENT" in row[0].upper():
        return False

    legacy = "predictions_pre_autoincrement"
    conn.exec_driver_sql(f'DROP TABLE IF EXISTS "{legacy}"')
    # Indexes follow the table through a rename and would collide with the ones
    # the new table declares, so they go first.
    for ix in [r[0] for r in conn.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='predictions' "
        "AND sql IS NOT NULL"
    )]:
        conn.exec_driver_sql(f'DROP INDEX IF EXISTS "{ix}"')

    conn.exec_driver_sql(f'ALTER TABLE predictions RENAME TO "{legacy}"')
    Prediction.__table__.create(bind=conn)

    old_cols = {r[1] for r in conn.exec_driver_sql(f'PRAGMA table_info("{legacy}")')}
    shared = [c.name for c in Prediction.__table__.columns if c.name in old_cols]
    if shared:
        cols_sql = ", ".join(f'"{c}"' for c in shared)
        conn.exec_driver_sql(
            f'INSERT INTO predictions ({cols_sql}) SELECT {cols_sql} FROM "{legacy}"'
        )
    conn.exec_driver_sql(f'DROP TABLE "{legacy}"')
    return True


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def band_for(m: float) -> str:
    return "floor" if m < 2 else "mid" if m < 10 else "moon"


def _round_dict(r: Round) -> Dict[str, Any]:
    return {"id": r.id, "ts": r.timestamp, "m": r.multiplier, "band": r.band,
            "nonce": r.nonce, "source": r.source}


# ---------------------------------------------------------------------------
# rounds
# ---------------------------------------------------------------------------

def insert_round(multiplier: float, visitor: str = DEFAULT_VISITOR,
                 source: str = "api", nonce: Optional[int] = None,
                 ts: Optional[str] = None) -> Dict[str, Any]:
    """Insert one round; `ts` (ISO-8601 UTC) carries the round's own timestamp.

    The watcher passes the timestamp the round actually happened so a re-read
    backlog cannot masquerade as fresh play; callers without a real timestamp
    (manual entry, the generator) omit it and get the ingest clock.
    """
    stamp = ts or _now()
    with SessionLocal() as s:  # type: Session
        row = Round(visitor_id=visitor, timestamp=stamp, multiplier=multiplier,
                    band=band_for(multiplier), source=source, nonce=nonce,
                    created_at=_now())
        s.add(row)
        s.commit()
        s.refresh(row)
        return _round_dict(row)


def round_exists(multiplier: float, ts: str,
                 visitor: str = DEFAULT_VISITOR) -> bool:
    """True when a round with this multiplier and timestamp is already stored.

    Cheap identity check for file-fed rounds: the archive writes one file per
    round with a millisecond timestamp, so (multiplier, timestamp) collides
    between distinct rounds only by extraordinary coincidence.
    """
    with SessionLocal() as s:
        return s.query(Round.id).filter(
            Round.visitor_id == visitor,
            Round.multiplier == multiplier,
            Round.timestamp == ts,
        ).first() is not None


CADENCE_SECONDS = 20.0


def insert_rounds_bulk(multipliers: List[float], visitor: str = DEFAULT_VISITOR,
                       source: str = "api", cadence_seconds: float = CADENCE_SECONDS) -> int:
    """Insert a tape, backdating it at a realistic cadence.

    Stamping every row with the same instant would be cheaper, but then the tape
    has no measurable round rate and no clock, so window odds could not convert
    rounds into minutes and the time-of-day test would see one giant hour. The
    last round lands on now and earlier rounds step back by the cadence, which is
    what a real import of recent history looks like.
    """
    if not multipliers:
        return 0
    with SessionLocal() as s:
        created = _now()
        end = dt.datetime.now(dt.timezone.utc)
        step = dt.timedelta(seconds=max(1.0, cadence_seconds))
        n = len(multipliers)
        s.add_all([
            Round(visitor_id=visitor, timestamp=(end - step * (n - 1 - i)).isoformat(),
                  multiplier=m, band=band_for(m), source=source, created_at=created)
            for i, m in enumerate(multipliers)
        ])
        s.commit()
    return len(multipliers)


def insert_rounds_stamped(pairs: List[tuple], visitor: str = DEFAULT_VISITOR,
                          source: str = "import-db",
                          cadence_seconds: float = CADENCE_SECONDS) -> int:
    """Insert (multiplier, timestamp) pairs, keeping the timestamps the tape came with.

    An ingested database usually carries a real clock, and that clock is the whole
    value of ingesting a database rather than pasting numbers: it makes cadence
    measurable and the time-of-day test meaningful. Rows with no usable timestamp
    are backdated around their neighbours at the fallback cadence so the ordering
    still holds.
    """
    if not pairs:
        return 0
    step = dt.timedelta(seconds=max(1.0, cadence_seconds))
    n = len(pairs)
    end = dt.datetime.now(dt.timezone.utc)
    stamps: List[str] = []
    for i, (_, ts) in enumerate(pairs):
        if ts:
            stamps.append(str(ts))
        else:
            stamps.append((end - step * (n - 1 - i)).isoformat())
    with SessionLocal() as s:
        created = _now()
        s.add_all([
            Round(visitor_id=visitor, timestamp=stamps[i], multiplier=float(m),
                  band=band_for(float(m)), source=source, created_at=created)
            for i, (m, _) in enumerate(pairs)
        ])
        s.commit()
    return n


def recent_rounds(limit: int = 1000, visitor: str = DEFAULT_VISITOR) -> List[Dict[str, Any]]:
    with SessionLocal() as s:
        rows = (s.query(Round).filter(Round.visitor_id == visitor)
                .order_by(Round.id.desc()).limit(limit).all())
        return [_round_dict(r) for r in reversed(rows)]


def multipliers_for(visitor: str = DEFAULT_VISITOR, limit: int = 4000) -> List[float]:
    return [r["m"] for r in recent_rounds(limit, visitor)]


def count_rounds(visitor: str = DEFAULT_VISITOR) -> int:
    with SessionLocal() as s:
        return int(s.query(func.count(Round.id)).filter(Round.visitor_id == visitor).scalar() or 0)


def source_counts(visitor: str = DEFAULT_VISITOR) -> Dict[str, int]:
    """Round count per source — lets the UI tell the file-watched feed from
    generator or import rounds on the same tape."""
    with SessionLocal() as s:
        rows = s.query(Round.source, func.count(Round.id)).filter(
            Round.visitor_id == visitor).group_by(Round.source).all()
        return {src: int(n) for src, n in rows}


def delete_round(round_id: int, visitor: str = DEFAULT_VISITOR) -> int:
    with SessionLocal() as s:
        n = s.query(Round).filter(Round.visitor_id == visitor, Round.id == round_id).delete()
        s.commit()
        return n


def update_round(round_id: int, multiplier: float, visitor: str = DEFAULT_VISITOR) -> Optional[Dict[str, Any]]:
    with SessionLocal() as s:
        row = s.query(Round).filter(Round.visitor_id == visitor, Round.id == round_id).first()
        if not row:
            return None
        row.multiplier = multiplier
        row.band = band_for(multiplier)
        s.commit()
        s.refresh(row)
        return _round_dict(row)


def clear_rounds(visitor: str = DEFAULT_VISITOR) -> int:
    with SessionLocal() as s:
        n = s.query(Round).filter(Round.visitor_id == visitor).delete()
        s.query(Prediction).filter(Prediction.visitor_id == visitor).delete()
        s.commit()
        return n


def delete_rounds_by_source(source: str, visitor: str = DEFAULT_VISITOR) -> int:
    """Remove every round with a given source.

    Used to strip the generator's rounds out of a tape that is meant to be fed
    only by the file watcher. Predictions are keyed to rounds by id, so any open
    (unresolved) forecast that was armed against a removed round is dropped too
    — it would otherwise target a hole in the tape. Resolved history is left
    intact: ledger entries keep their measured outcomes.
    """
    with SessionLocal() as s:
        removed_ids = [r.id for r in s.query(Round.id).filter(
            Round.visitor_id == visitor, Round.source == source).all()]
        s.query(Round).filter(Round.visitor_id == visitor, Round.source == source).delete()
        if removed_ids:
            s.query(Prediction).filter(
                Prediction.visitor_id == visitor,
                Prediction.actual.is_(None),
                Prediction.target_round_id.in_(removed_ids),
            ).delete()
        s.commit()
        return len(removed_ids)


# ---------------------------------------------------------------------------
# prediction ledger
# ---------------------------------------------------------------------------

def _prediction_dict(p: Prediction) -> Dict[str, Any]:
    return {
        "id": p.id, "targetRoundId": p.target_round_id, "state": p.state,
        "band": [p.band_lo, p.band_hi], "probability": p.probability,
        "pAbove2": p.p_above_2, "pAbove10": p.p_above_10, "eta": p.eta,
        "distribution": json.loads(p.distribution) if p.distribution else None,
        "drivers": json.loads(p.drivers) if p.drivers else None,
        "actual": p.actual, "actualState": p.actual_state, "bandHit": p.band_hit,
        "hit2": p.hit_2, "hit10": p.hit_10, "brier": p.brier,
        "lockedAt": p.locked_at, "resolvedAt": p.resolved_at,
    }


def open_prediction(visitor: str = DEFAULT_VISITOR) -> Optional[Dict[str, Any]]:
    with SessionLocal() as s:
        row = (s.query(Prediction)
               .filter(Prediction.visitor_id == visitor, Prediction.actual.is_(None))
               .order_by(Prediction.id.desc()).first())
        return _prediction_dict(row) if row else None


def lock_prediction(visitor: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    with SessionLocal() as s:
        # only one open prediction at a time
        s.query(Prediction).filter(
            Prediction.visitor_id == visitor, Prediction.actual.is_(None)
        ).delete()
        row = Prediction(
            visitor_id=visitor,
            target_round_id=payload.get("targetRoundId"),
            state=payload["state"],
            band_lo=payload["band"][0], band_hi=payload["band"][1],
            probability=payload["probability"],
            p_above_2=payload.get("pAbove2", 0.0),
            p_above_10=payload.get("pAbove10", 0.0),
            eta=payload.get("eta"),
            distribution=json.dumps(payload.get("distribution") or {}),
            drivers=json.dumps(payload.get("drivers") or {}),
            locked_at=_now(),
        )
        s.add(row)
        s.commit()
        s.refresh(row)
        return _prediction_dict(row)


def resolve_open_predictions(visitor: str, actual: float, actual_state: str,
                             brier: Optional[float] = None) -> int:
    with SessionLocal() as s:
        rows = (s.query(Prediction)
                .filter(Prediction.visitor_id == visitor, Prediction.actual.is_(None)).all())
        for row in rows:
            row.actual = actual
            row.actual_state = actual_state
            row.band_hit = bool(row.band_lo <= actual <= row.band_hi)
            row.hit_2 = bool(actual >= 2.0)
            row.hit_10 = bool(actual >= 10.0)
            if brier is not None:
                row.brier = brier
            else:
                dist = json.loads(row.distribution) if row.distribution else {}
                if dist:
                    row.brier = sum(
                        (prob - (1.0 if state == actual_state else 0.0)) ** 2
                        for state, prob in dist.items()
                    )
            row.resolved_at = _now()
        s.commit()
        return len(rows)


def predictions(limit: int = 300, visitor: str = DEFAULT_VISITOR) -> List[Dict[str, Any]]:
    with SessionLocal() as s:
        rows = (s.query(Prediction).filter(Prediction.visitor_id == visitor)
                .order_by(Prediction.id.desc()).limit(limit).all())
        return [_prediction_dict(r) for r in reversed(rows)]


# ---------------------------------------------------------------------------
# alerts
# ---------------------------------------------------------------------------

def _alert_dict(a: Alert) -> Dict[str, Any]:
    return {"id": a.id, "name": a.name, "kind": a.kind, "comparator": a.comparator,
            "threshold": a.threshold, "active": a.active, "triggerCount": a.trigger_count,
            "lastTriggeredAt": a.last_triggered_at, "createdAt": a.created_at}


def list_alerts(visitor: str = DEFAULT_VISITOR) -> List[Dict[str, Any]]:
    with SessionLocal() as s:
        rows = s.query(Alert).filter(Alert.visitor_id == visitor).order_by(Alert.id).all()
        return [_alert_dict(a) for a in rows]


def create_alert(visitor: str, name: str, kind: str, comparator: str, threshold: float) -> Dict[str, Any]:
    with SessionLocal() as s:
        row = Alert(visitor_id=visitor, name=name, kind=kind, comparator=comparator,
                    threshold=threshold, created_at=_now())
        s.add(row)
        s.commit()
        s.refresh(row)
        return _alert_dict(row)


def toggle_alert(visitor: str, alert_id: int, active: bool) -> Optional[Dict[str, Any]]:
    with SessionLocal() as s:
        row = s.query(Alert).filter(Alert.visitor_id == visitor, Alert.id == alert_id).first()
        if not row:
            return None
        row.active = active
        s.commit()
        s.refresh(row)
        return _alert_dict(row)


def delete_alert(visitor: str, alert_id: int) -> int:
    with SessionLocal() as s:
        n = s.query(Alert).filter(Alert.visitor_id == visitor, Alert.id == alert_id).delete()
        s.commit()
        return n


def record_alert_event(visitor: str, alert: Alert, message: str, value: Optional[float],
                       round_id: Optional[int]) -> Dict[str, Any]:
    with SessionLocal() as s:
        row = AlertEvent(visitor_id=visitor, alert_id=alert.id, alert_name=alert.name,
                         message=message, value=value, round_id=round_id, created_at=_now())
        s.add(row)
        live = s.query(Alert).filter(Alert.id == alert.id).first()
        if live:
            live.trigger_count += 1
            live.last_triggered_at = _now()
        s.commit()
        s.refresh(row)
        return {"id": row.id, "alertId": row.alert_id, "alertName": row.alert_name,
                "message": row.message, "value": row.value, "roundId": row.round_id,
                "createdAt": row.created_at}


def alert_events(limit: int = 60, visitor: str = DEFAULT_VISITOR) -> List[Dict[str, Any]]:
    with SessionLocal() as s:
        rows = (s.query(AlertEvent).filter(AlertEvent.visitor_id == visitor)
                .order_by(AlertEvent.id.desc()).limit(limit).all())
        return [{"id": r.id, "alertId": r.alert_id, "alertName": r.alert_name,
                 "message": r.message, "value": r.value, "roundId": r.round_id,
                 "createdAt": r.created_at} for r in rows]


def evaluate_alerts(visitor: str, multiplier: float, round_id: int,
                    context: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Check every active rule against the round that just landed."""
    fired: List[Dict[str, Any]] = []
    with SessionLocal() as s:
        rules = s.query(Alert).filter(Alert.visitor_id == visitor, Alert.active.is_(True)).all()
    for rule in rules:
        value: Optional[float] = None
        if rule.kind == "multiplier":
            value = multiplier
        elif rule.kind == "dry_streak":
            value = float(context.get("dry_streak", 0))
        elif rule.kind == "pressure":
            value = float(context.get("pressure", 0))
        elif rule.kind == "p_above_2":
            value = float(context.get("p_above_2", 0))
        elif rule.kind == "eta":
            value = float(context.get("eta", 0))
        if value is None:
            continue
        hit = value >= rule.threshold if rule.comparator == "gte" else value <= rule.threshold
        if hit:
            msg = (f"{rule.name}: {rule.kind.replace('_', ' ')} = {value:.2f} "
                   f"{'≥' if rule.comparator == 'gte' else '≤'} {rule.threshold:.2f}")
            fired.append(record_alert_event(visitor, rule, msg, value, round_id))
    return fired


def seed_default_alerts(visitor: str) -> None:
    if list_alerts(visitor):
        return
    create_alert(visitor, "Moonshot landed", "multiplier", "gte", 10.0)
    create_alert(visitor, "Dry spell ≥ 12 rounds under 2×", "dry_streak", "gte", 12.0)
    create_alert(visitor, "Ladder pressure critical", "pressure", "gte", 0.8)


# ---------------------------------------------------------------------------
# settings
# ---------------------------------------------------------------------------

DEFAULT_SETTINGS: Dict[str, Any] = {
    "houseEdge": 0.03,
    "edgePreset": "aviator",
    "operator": "Aviator (Spribe)",
    "currency": "BWP",
    "defaultTarget": 2.0,
    "bankroll": 1000.0,
    "maxRiskPerRound": 0.02,
    "sessionLossLimit": 0.15,
    "liveFeedIntervalMs": 2500,
    # Off by default: the live tape is fed by the ~/Downloads file watcher. The
    # provably-fair generator is an opt-in source, and while it runs its rounds
    # mix into the same tape as the file feed (see /sim/start).
    "simulatorEnabled": False,
    "showResponsibleBanner": True,
    "theme": "phosphor",
    "confidenceFloor": 0.45,
}


def get_settings(visitor: str = DEFAULT_VISITOR) -> Dict[str, Any]:
    with SessionLocal() as s:
        row = s.query(Setting).filter(Setting.visitor_id == visitor).first()
        merged = dict(DEFAULT_SETTINGS)
        if row:
            try:
                merged.update(json.loads(row.payload))
            except Exception:
                pass
        return merged


def save_settings(visitor: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    merged = get_settings(visitor)
    merged.update({k: v for k, v in patch.items() if v is not None})
    with SessionLocal() as s:
        row = s.query(Setting).filter(Setting.visitor_id == visitor).first()
        if row:
            row.payload = json.dumps(merged)
            row.updated_at = _now()
        else:
            s.add(Setting(visitor_id=visitor, payload=json.dumps(merged), updated_at=_now()))
        s.commit()
    return merged


# ---------------------------------------------------------------------------
# bankroll sessions
# ---------------------------------------------------------------------------

def _session_dict(x: BetSession, bets: int = 0, wins: int = 0) -> Dict[str, Any]:
    pnl = x.bankroll_current - x.bankroll_start
    return {"id": x.id, "name": x.name, "bankrollStart": x.bankroll_start,
            "bankrollCurrent": x.bankroll_current, "stake": x.stake, "target": x.target,
            "lossLimit": x.loss_limit, "status": x.status, "startedAt": x.started_at,
            # endedAt/closedAt are the same timestamp under both names: the UI reads
            # closedAt and the export reads endedAt.
            "endedAt": x.ended_at, "closedAt": x.ended_at, "pnl": pnl,
            "pnlPct": pnl / x.bankroll_start if x.bankroll_start else 0.0,
            "bets": bets, "wins": wins, "losses": max(0, bets - wins),
            "hitRate": (wins / bets) if bets else None}


def _bet_counts(s, session_id: int) -> tuple:
    n = int(s.query(func.count(Bet.id)).filter(Bet.session_id == session_id).scalar() or 0)
    w = int(s.query(func.count(Bet.id))
            .filter(Bet.session_id == session_id, Bet.won.is_(True)).scalar() or 0)
    return n, w


def list_sessions(visitor: str = DEFAULT_VISITOR) -> List[Dict[str, Any]]:
    with SessionLocal() as s:
        rows = (s.query(BetSession).filter(BetSession.visitor_id == visitor)
                .order_by(BetSession.id.desc()).all())
        out = []
        for r in rows:
            n, w = _bet_counts(s, r.id)
            out.append(_session_dict(r, n, w))
        return out


def create_session(visitor: str, name: str, bankroll: float, stake: float,
                   target: float, loss_limit: float) -> Dict[str, Any]:
    with SessionLocal() as s:
        row = BetSession(visitor_id=visitor, name=name, bankroll_start=bankroll,
                         bankroll_current=bankroll, stake=stake, target=target,
                         loss_limit=loss_limit, started_at=_now())
        s.add(row)
        s.commit()
        s.refresh(row)
        return _session_dict(row)


def close_session(visitor: str, session_id: int, status: str = "closed") -> Optional[Dict[str, Any]]:
    with SessionLocal() as s:
        row = s.query(BetSession).filter(BetSession.visitor_id == visitor,
                                         BetSession.id == session_id).first()
        if not row:
            return None
        row.status = status
        row.ended_at = _now()
        s.commit()
        s.refresh(row)
        return _session_dict(row, *_bet_counts(s, row.id))


def log_bet(visitor: str, session_id: int, stake: float, target: float,
            result: float, note: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with SessionLocal() as s:
        sess = s.query(BetSession).filter(BetSession.visitor_id == visitor,
                                          BetSession.id == session_id).first()
        if not sess:
            return None
        won = result >= target
        pnl = (target - 1.0) * stake if won else -stake
        sess.bankroll_current += pnl
        row = Bet(visitor_id=visitor, session_id=session_id, stake=stake, target=target,
                  result_multiplier=result, won=won, pnl=pnl,
                  bankroll_after=sess.bankroll_current, note=note, created_at=_now())
        s.add(row)
        drawdown = sess.bankroll_start - sess.bankroll_current
        stopped = drawdown >= sess.loss_limit
        if stopped:
            sess.status = "stopped_out"
            sess.ended_at = _now()
        s.commit()
        s.refresh(row)
        s.refresh(sess)
        return {
            "bet": {"id": row.id, "sessionId": session_id, "stake": stake, "target": target,
                    "result": result, "won": won, "pnl": pnl,
                    "bankrollAfter": row.bankroll_after, "createdAt": row.created_at},
            "session": _session_dict(sess, *_bet_counts(s, session_id)),
            "stoppedOut": stopped,
        }


def list_bets(visitor: str, session_id: int) -> List[Dict[str, Any]]:
    with SessionLocal() as s:
        rows = (s.query(Bet).filter(Bet.visitor_id == visitor, Bet.session_id == session_id)
                .order_by(Bet.id).all())
        return [{"id": r.id, "sessionId": r.session_id, "stake": r.stake, "target": r.target,
                 "result": r.result_multiplier, "won": r.won, "pnl": r.pnl,
                 "bankrollAfter": r.bankroll_after, "note": r.note,
                 "createdAt": r.created_at} for r in rows]


# ---------------------------------------------------------------------------
# seed audits
# ---------------------------------------------------------------------------

def save_seed_audit(visitor: str, payload: Dict[str, Any], label: Optional[str] = None) -> Dict[str, Any]:
    with SessionLocal() as s:
        row = SeedAudit(
            visitor_id=visitor, label=label, algorithm=payload.get("algorithm", "hmac_sha256"),
            server_seed=payload.get("server_seed", ""),
            server_seed_hash=payload.get("computed_server_seed_hash"),
            client_seed=payload.get("client_seed", ""), nonce=int(payload.get("nonce") or 0),
            expected=float(payload.get("crash_point") or 0.0),
            observed=payload.get("observed"), matched=payload.get("match"),
            commitment_valid=payload.get("seed_commitment_valid"), created_at=_now())
        s.add(row)
        s.commit()
        s.refresh(row)
        return {"id": row.id, "label": row.label, "algorithm": row.algorithm,
                "clientSeed": row.client_seed, "nonce": row.nonce, "expected": row.expected,
                "observed": row.observed, "matched": row.matched,
                "commitmentValid": row.commitment_valid, "createdAt": row.created_at}


def list_seed_audits(visitor: str = DEFAULT_VISITOR, limit: int = 100) -> List[Dict[str, Any]]:
    with SessionLocal() as s:
        rows = (s.query(SeedAudit).filter(SeedAudit.visitor_id == visitor)
                .order_by(SeedAudit.id.desc()).limit(limit).all())
        return [{"id": r.id, "label": r.label, "algorithm": r.algorithm,
                 "serverSeed": r.server_seed, "clientSeed": r.client_seed, "nonce": r.nonce,
                 "expected": r.expected, "observed": r.observed, "matched": r.matched,
                 "commitmentValid": r.commitment_valid, "createdAt": r.created_at} for r in rows]


# ---------------------------------------------------------------------------
# chart annotations
# ---------------------------------------------------------------------------

def _annotation_dict(a: Annotation) -> Dict[str, Any]:
    return {"id": a.id, "chart": a.chart, "kind": a.kind,
            "points": json.loads(a.points), "color": a.color,
            "label": a.label, "createdAt": a.created_at}


def list_annotations(visitor: str = DEFAULT_VISITOR, chart: Optional[str] = None) -> List[Dict[str, Any]]:
    with SessionLocal() as s:
        q = s.query(Annotation).filter(Annotation.visitor_id == visitor)
        if chart:
            q = q.filter(Annotation.chart == chart)
        return [_annotation_dict(a) for a in q.order_by(Annotation.id).all()]


def create_annotation(visitor: str, chart: str, kind: str, points: List[List[float]],
                      color: str = "#38c7e8", label: Optional[str] = None) -> Dict[str, Any]:
    with SessionLocal() as s:
        row = Annotation(visitor_id=visitor, chart=chart, kind=kind,
                         points=json.dumps(points), color=color,
                         label=label, created_at=_now())
        s.add(row)
        s.commit()
        s.refresh(row)
        return _annotation_dict(row)


def update_annotation(visitor: str, annotation_id: int,
                      points: Optional[List[List[float]]] = None,
                      color: Optional[str] = None,
                      label: Optional[str] = None) -> Optional[Dict[str, Any]]:
    with SessionLocal() as s:
        row = (s.query(Annotation)
               .filter(Annotation.visitor_id == visitor, Annotation.id == annotation_id).first())
        if not row:
            return None
        if points is not None:
            row.points = json.dumps(points)
        if color is not None:
            row.color = color
        if label is not None:
            row.label = label
        s.commit()
        s.refresh(row)
        return _annotation_dict(row)


def delete_annotation(visitor: str, annotation_id: int) -> int:
    with SessionLocal() as s:
        n = (s.query(Annotation)
             .filter(Annotation.visitor_id == visitor, Annotation.id == annotation_id).delete())
        s.commit()
        return n


def clear_annotations(visitor: str, chart: Optional[str] = None) -> int:
    with SessionLocal() as s:
        q = s.query(Annotation).filter(Annotation.visitor_id == visitor)
        if chart:
            q = q.filter(Annotation.chart == chart)
        n = q.delete()
        s.commit()
        return n
