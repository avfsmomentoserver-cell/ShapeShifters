# Architecture — how the pieces fit

Two processes and a static bundle. There is no database server, no message
queue, no auth service and no scheduler: an analytics terminal that has to be
readable in one sitting.

## 1. Shape

```
browser ──HTTP──▶ FastAPI (api.py) ──▶ kernel (pure functions, numpy)
   ▲                    │                        ▲
   └──WebSocket─────────┘                        │
                     db.py (SQLite, WAL) ────────┘
                        ▲        ▲
        watcher.py ─────┘        └───── seed.py (read-only prior corpora)
                        │
                   ingest.py (staged uploads)
```

| Process | Command | Port |
| --- | --- | --- |
| API | `python -m uvicorn momento.api:app --host 0.0.0.0 --port 8000` | 8000 |
| UI | `npm run dev` | 5173 |

Two hard facts that follow:

- **Only the API owns the database.** The frontend computes mirrors of some
  formulas for offline/live display, but the number that counts is the API's.
- **Exactly one API process.** WAL SQLite plus process-global state (`hub`,
  `_SEED_LOCKS`, `_sim_tasks`, `ingest._UPLOADS`, `watcher._seen`,
  `seed._CACHE`) means `uvicorn --workers > 1` breaks staging, broadcasting and
  seeding-for-once. Scale by moving state out, not by adding workers.

## 2. Backend module graph

Measured from the imports, not from intent:

```
                    ┌──────────────┐
   fairness ────────┤              │
   ingest ──────────┤              │
   windows ─────────┤   api.py     │──▶ db.py ──▶ SQLite
   strategies ──────┤  (routes)    │
   randomness ──────┤              │
   pipeline ────────┤              │
   ev, survival, mm ┘              │
                    └──────┬───────┘
                           ▼
                      watcher.py ──▶ db.py
                      seed.py   ──▶ (read-only sqlite3, no ORM)
```

Internal edges of the kernel (verified):

- `api.py:19` imports `db, ev, fairness, ingest, math_models as mm, pipeline,
  randomness, seed as seed_evidence, strategies, survival, watcher, windows` —
  the API is the only place that knows all of them.
- `db.py` imports nothing from the package. It is the floor: SQLAlchemy, WAL,
  serializers.
- `watcher.py:33` imports `db` only, and imports `api._ingest` **locally inside
  the function** (`watcher.py:261`) to break the circular import.
- `windows.py:25` imports `_chi2_sf, theoretical_survival` from `randomness`.
- `pipeline.py:12-13` imports `math_models` and `survival`.
- `strategies.py:14-15` imports `ev` and `survival`.
- `ev.py`, `survival.py`, `randomness.py`, `fairness.py`, `math_models.py`,
  `ingest.py`, `seed.py` import nothing from the package. They are leaf
  modules — a good place to put a pure function.
- `engines.py` is a three-line convenience re-export
  (`from . import math_models, pipeline`) that **nothing imports**. Dead surface.
  Do not treat it as the engine layer; the engines live in `pipeline.py` and
  `windows.py`.

**Consequence for placement:** a new statistic belongs in a leaf module
(`survival.py`, `math_models.py`, `windows.py`), a new piece of stored state in
`db.py` (+ `_migrate()`), and a new route in `api.py`. Only add an edge to the
graph when the dependency is real — the leaf modules are what make the kernel
testable without a database.

Dependency notes: `numpy` in `ev`, `math_models`, `randomness`, `strategies`;
`scipy` is **optional** (`randomness.py:23-26`, `try: from scipy import stats …
except: _st = None`) with a Wilson–Hilferty fallback; `scikit-learn` is declared
in `requirements.txt` and imported nowhere.

## 3. The two data flows

### A. A round arrives

```
watcher._scan (poll 1s, ~/Downloads)
  └─ seen by (path, size, mtime, byte offset); a grown file is read from its
     last offset; a file is marked seen only AFTER a successful ingest
      │
      ├─ round already on tape for (multiplier, timestamp)?  skip
      ▼
api._ingest(visitor, m, source, ts)           api.py:425
  └─ async with _ingest_lock: await asyncio.to_thread(_ingest_sync, …)
       │
       ▼  _ingest_sync                            api.py:390
      1. db.resolve_open_predictions(visitor, m, realized_state(m))
      2. db.insert_round(m, visitor, source, ts)
      3. pipeline.analyze(tape) + strategies.live_context(tape)
      4. db.evaluate_alerts(visitor, m, round_id, context)
      5. _arm_prediction(visitor)         ← locks the NEXT forecast
      6. realtime.advance(visitor, tape)  ← composes the live tier on the cache
       │
       ▼
hub.broadcast(visitor, {…})

REST equivalents: POST /rounds and POST /rounds/bulk call the same `_ingest`,
so a pasted round resolves predictions and arms exactly like a watched one.
```

Two properties that are load-bearing and easy to regress:

1. **Resolve before insert, then arm.** A forecast locked at round *n* is
   resolved by round *n+1* before the new one is armed. Inverting the order
   scores a forecast against the round it was fitted on.
2. **The round keeps its own timestamp.** Stamping a re-ingested backlog with
   the ingest clock made old rounds look freshly played and corrupted the
   cadence measurement. `ts` travels with the round from the file.

### A2. The realtime two-tier layer

The live stats do **not** recompute the expensive analyses per round. A heavy
pass (`realtime.heavy`, incl. the randomness battery) runs on a schedule and is
cached per visitor; each round composes a cheap projection on top of it:

```
round lands ──▶ realtime.advance(visitor, tape, edge)
                  ├─ cold cache? → run_baseline()  (heavy: battery, skill, droughts)
                  ├─ project(tape, edge)           (cheap, pure, per round)
                  └─ {revision, baseline, delta, projection}
                            │
                            ▼
                  GET /api/stats/realtime  →  frontend/lib/store.ts
```

`project` is pure by contract, so the per-round cost cannot inherit the
scheduled cost. The tape is the only input to both tiers, and a tape
*replacement* (reseed, clear, `bulk replace`, `.db` import) must call
`realtime.invalidate(visitor)` or the cached heavy tier keeps describing a tape
that no longer exists — `delta.roundsApart` would even go negative on a shorter
replacement. See [`backend.md`](backend.md) §`realtime.py`.

### B. A page loads

```
browser ──GET /api/* with X-Visitor-Id──▶ visitor_of() ──▶ _ensure_seeded()
                                                │            (once per visitor,
                                                │             900 fair rounds +
                                                ▼             default alerts)
                                          kernel over db.multipliers_for()
                                                │
                                          plain dict, camelCase keys
                                                (db.py serializers)
```

`visitor_of` (`api.py:89`) is a FastAPI dependency that **also seeds**: the
browser fires a dozen requests on first paint, any of which may arrive first, so
seeding cannot be left to one endpoint. The double-checked lock in
`_ensure_seeded` (`api.py:62`) exists because that race once produced three
concatenated copies of the same 900-round tape — and a tape that is three copies
of itself is not independent, so the randomness battery correctly rejected it.

`_tape(visitor, limit=4000)` is the standard read.

## 4. Trust boundaries

| Boundary | Reality |
| --- | --- |
| `X-Visitor-Id` | Client-supplied, and the **only** partition between workspaces. Deliberate: local-first analytics, not multi-tenant auth. Therefore a missing filter is a complete tenant-isolation break, not a hardening gap. |
| Uploaded SQLite | Untrusted. Opened `mode=ro&immutable=1` (`ingest.py:147`); every identifier validated (`_safe_name`, `ingest.py:161`) and quoted (`_quote`, `:157`). |
| Watched files | Untrusted shape, trusted enough to parse. Rounds below 1.00 are dropped. |
| Outbound | None. No telemetry, no external API, no CDN at runtime. |
| Fairness inputs | Seeds arrive in a **request body**, which is fine because they are the user's own evidence. They still must not be able to override `visitor_id`. |

## 5. Where a new piece belongs

| You are adding | Put it in | And |
| --- | --- | --- |
| A statistic over the tape | leaf module (`survival`/`math_models`/`windows`) | a `GET /api/…` route, a mirrored `frontend/lib/*.ts` function, a closed-form test |
| A stored record | `db.py` model + serializer | `_migrate()` if an existing table changes; `create_all()` handles new tables |
| A route | `api.py` | `visitor_of` header dep, sync `def`, `HTTPException` guards for short tapes |
| A live-ingest step | `_ingest_sync` | keep resolve → insert → analyze → alerts → arm order |
| A page | `frontend/pages/`, route in `App.tsx`, item in `AppShell` menu | `lib/api.ts` typing first |
| A file source | `watcher._extract_multipliers` | round-by-round dedupe on `(m, ts)`, mark seen after ingest |
| A prior-data corpus | `seed.py` `_SEED_DATA_DIRS` | read-only URI; never silently re-derive a shipped number |

## 6. Invariants

- A locked forecast is immutable: `locked_at` and `resolved_at` are separate
  writes and the stored distribution still matches the stored band.
- `EV/unit = -h` at every cash-out target; nothing in the UI may imply otherwise.
- Walk-forward only. Rebuilding a component from rounds `0…i−1` before scoring
  round `i` is the only honest evaluation.
- No origin-scoped storage (no `localStorage`) — the app runs in a sandboxed
  frame, and a self-scored ledger must not be editable by the scoree.
- Everything is visitor-scoped, from the header.
- One process owns the database.
- Rounding is `floor(x * 100) / 100`.
- The responsible-gambling surface (`/responsible`, the help-line links, the
  `showResponsibleBanner` setting) stays.
