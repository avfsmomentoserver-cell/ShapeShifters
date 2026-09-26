# Backend — editing the Python

`backend/momento/`, twelve modules. `architecture.md` has the graph; this is the
practical guide: what each module does, what to copy, and what breaks.

Package `backend/momento/__init__.py` says `__version__ = "5.1.0"` while
`api.py:22` reports `VERSION = "6.2.0"`, and `package.json` says `6.0.0`. Three
numbers, none authoritative. Do not "fix" them as a drive-by; if you touch
versioning, decide which one is the truth first.

## Route anatomy

Every route is this shape (`api.py:963-975`, `/windows`, is the cleanest copy):

```python
@api.get("/windows")
def get_windows(
    thresholds: Optional[str] = Query(default=None),
    x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id"),
) -> Dict[str, Any]:
    """P(at least one hit) per threshold over 15m / 1h / 4h / 1d / 7d."""
    v = visitor_of(x_visitor_id)
    tape = _tape(v)
    if len(tape) < 30:
        raise HTTPException(status_code=422, detail="need at least 30 rounds")
    ts = _parse_thresholds(thresholds, (2.0, 5.0, 10.0, 50.0, 100.0))
    rows = db.recent_rounds(400, v)
    return windows.window_odds(tape, rows, db.get_settings(v)["houseEdge"], ts)
```

Rules, each with a reason from the code:

- **`def`, not `async def`.** The kernel is CPU-bound NumPy. FastAPI runs a sync
  handler in a threadpool; an `async def` handler blocks the event loop and
  starves `/ws/rounds` for every visitor. That outage is in the git history.
- **`visitor_of(x_visitor_id)`**, never a body field. The dependency also
  guarantees a tape exists.
- **Guard short tapes with 422** and a readable message. Equivalent checks exist
  at `/windows` (`<30`), `/exceedance` (`<20`), `/droughts` (`<20`), `/phases`
  (`<30`), `/skill` (`<150`), `/ladder` (`<20`). `/analysis` predates the
  convention and instead returns `{"error": "insufficient data", "rounds": n}`
  under 10 — an inconsistent shape the frontend has to special-case.
- **`raise HTTPException(status, "message")` positionally** (`api.py:469`).
- **`Body(embed=True)`** for a single scalar body (`PATCH /rounds/{id}`,
  `PATCH /alerts/{id}`). Request bodies are Pydantic models at
  `api.py:165-296`, `camelCase` fields, `model_dump(exclude_none=True)`.
- **Responses are hand-built dicts**, never response models. The camelCase names
  come from `db.py` serializers.
- **Read the house edge from settings**: `db.get_settings(visitor)["houseEdge"]`.
  Module-level `DEFAULT_EDGE`/`HOUSE_EDGE` exist for standalone calls only.
- Heavy work is fine synchronously (threadpool); if you must touch the event
  loop, wrap in `asyncio.to_thread` the way `_ingest` does (`api.py:435`).

## `api.py` — the surface (~1354 lines)

| Concern | Where |
| --- | --- |
| App, CORS `*`, lifespan starting the watcher | `api.py:27-48` |
| Router `prefix="/api"` | `api.py:50` |
| Visitor dependency + first-visit seeding | `api.py:89`, `api.py:62` |
| WebSocket hub: `connect`/`disconnect`/`broadcast`/`client_count`, singleton `hub` | `api.py:131-158` |
| Forecast arming (idempotent, `force=` re-locks) | `api.py:343-380` |
| The live ingest step and its lock | `api.py:390-438` (`_ingest_lock` at `:650`, `_ingest` at `:425`) |
| Simulator loop | `api.py:1203-1217` |
| Request models (`RoundIn`…`RuinIn`) | `api.py:165-296` |

Every route, grouped, with line numbers, is tabulated in
[`data-model.md`](data-model.md) §Routes — use that table rather than grepping.

## The kernel modules

Each entry: purpose, key exports, and the one thing that breaks if you are
careless. Line numbers verified.

### `fairness.py` — provable fairness

`sha256_hex` `:40`, `hmac_sha256_hex` `:44`, `hmac_sha512_hex` `:48`,
`_floor2` `:52`, `build_message` `:75`, `crash_point_stake` `:81`,
`crash_point_bustabit` `:115`, `verify_round` `:144`, `verify_batch` `:178`,
`verify_seed_chain` `:210`, `find_chain_depth` `:230`,
`generate_provable_tape` `:241`, `solve_convention` `:258`.
Data: `MESSAGE_TEMPLATES` `:63`, `DEFAULT_TEMPLATE = "client:nonce"` `:72`.

**The key is the server seed; the message is the client/nonce string**
(`hmac.new(key.encode(), message.encode(), …`). Get that backwards and every
verification fails while the code looks right. `verify_round` returns
`seed_commitment_valid = None` when no hash was supplied — `None` means
"unchecked", and `False` means "the commitment failed". Never collapse the two.

### `db.py` — storage

Models, serializers, migrations, and the only place SQLAlchemy appears. Full
schema, key lists and migration steps: [`data-model.md`](data-model.md).
`_migrate()` `:191`; `_migrate_predictions_to_autoincrement` `:206`.
`DEFAULT_SETTINGS` `:633`. `band_for` `:255`.

Round dedupe is **application-level only** — `round_exists` `:288` on
`(visitor_id, multiplier, timestamp)`, used by the watcher. There is **no unique
index anywhere in `db.py`**; `insert_rounds_bulk`/`insert_rounds_stamped` insert
whatever they are given. Import twice and the tape is duplicated, which the
randomness battery will then (correctly) reject.

### `watcher.py` — `~/Downloads` feed

`run_watcher` `:279`, `_scan` `:192`, `_extract_multipliers` `:129`,
`_normalize_ts` `:106`, `_ingest_rounds` `:250`, seen-cache `:46-101`.
Poll `POLL_SECONDS = 1.0` `:37`; directory from `MOMENTO_WATCH_DIR` or
`~/Downloads` `:283`; `SOURCE = "watcher"` `:39`.

Two incidents are frozen into this file and its docstring:

- The seen-cache used to be in memory, so **every restart re-ingested the whole
  directory** (~1,600 rounds) through the live pipeline, wedging the loop and
  duplicating the tape. It is now persisted beside the DB and written with a
  `.tmp` + `os.replace` dance. Do not make it in-memory again.
- A file is marked seen **after** a successful ingest, and dedupe is also
  round-by-round on `(m, ts)`, so a crash between ingest and marking duplicates
  nothing and loses nothing.

`_ingest_rounds` imports `api._ingest` locally (`:261`) to break the cycle, and
`await asyncio.sleep(0)` between rounds (`:275`) so a backlog cannot starve the
event loop.

### `ingest.py` — SQLite import

Staging `:92-167` (`stage_upload`, `upload_path`, `discard_upload`), column
scoring `_score_multiplier_column` `:441`, `_score_time_column` `:523`,
`detect_scale` `:368`, `coerce_number` `:340`, `parse_timestamp` `:392`,
`parse_column_ref` `:169`, `derive_columns` `:270`, `inspect_database` `:544`,
`extract_rounds` `:666`, `preview_stats` `:797`.

Limits: `MAX_UPLOAD_BYTES = 64 MiB` `:38`, `MAX_SCAN_ROWS = 200_000` `:39`,
`MAX_INGEST_ROWS = 20_000` `:40`, `SAMPLE_ROWS = 400` `:41`,
`UPLOAD_TTL_SECONDS = 30 min` `:42`, `AUTO_MIN_CONFIDENCE = 0.55` `:70`.

Non-negotiable safety, and there is a test for each:

- `mode=ro&immutable=1` URI `:147` — **the uploaded file is never written**.
- Every interpolated table/column goes through `_quote` `:157` after
  `_safe_name` `:161`. A column reference is `table.column`, but only the base
  segment ever reaches SQL (`parse_column_ref` `:169-186`).
- Uploads are staged as temp files keyed by a token, owned by a visitor
  (`:125`), swept on TTL.

Scoring shape (`:441-520`), for when you need to tune it:

```
score = 0.30*numericShare + 0.24*inRangeShare + 0.18*nearTwo
      + 0.10*min(tail/3, 1) + 0.30*hint
      + (0.08 if distinct > max(8, len*0.05) else -0.15)
penalties: -0.5 range unusable, -0.55 monotonic (a counter), -0.45 id-named
```

A descending-ordered real tape trips the `monotonic` penalty. That is the
documented intent, and it is also the most likely false negative — check
`why` in the response before blaming the user's file.

### `survival.py`, `math_models.py`, `windows.py`, `randomness.py`, `ev.py`, `pipeline.py`, `strategies.py`

Formulas, constants and traps: [`domain-math.md`](domain-math.md). Quick index
of the entry points you will call from a route or another module:

| Module | Call these | Notes |
| --- | --- | --- |
| `survival.py` | `survival`, `curve`, `band_probability`, `diagnostics` | `MIN_EXCEEDANCES = 8`, `TAIL_FRACTION = 0.15` |
| `math_models.py` | `analyze`-support: `pareto_fit`, `exponential_fit`, `markov_streaks`, `cluster_log`, `detect_regimes`, `eta_estimate` | `HOUSE_EDGE = 0.04` local default |
| `pipeline.py` | `analyze`, `candidates`, `probability_above`, `survival_curve` | `STATES` at `:15`; owns lock/resolve |
| `windows.py` | `wilson`, `exceedance_grid`, `droughts`, `hour_phases`, `earned_skill`, `per_round_probability`, `median_interval_ms`, `window_odds`, `leaderboard` | imports `_chi2_sf` from `randomness` |
| `randomness.py` | `full_battery`, `theoretical_survival`, `estimate_house_edge`, and the individual tests | scipy optional |
| `ev.py` | `ev_table`, `kelly`, `expected_loss`, `risk_of_ruin`, `martingale_analysis`, `bankroll_plan` | `DEFAULT_EDGE = 0.03` |
| `strategies.py` | `calibration`, `backtest`, `strategy_grid`, `live_context`, `realized_state` | feeds `evaluate_alerts` |
| `seed.py` | `load_seed_evidence` | memoised; read-only SQLite |

### `realtime.py` — the two-tier live layer

A cheap per-round projection composed on top of a heavy scheduled pass.
`project` `:258` (pure, per round), `shape_forecast` `:319` (the projected
curve), `heavy` `:404` (the expensive one), `run_baseline` `:434`,
`baseline_fresh` `:458`, `_delta` `:464`, `advance` `:485`, `summary` `:535`,
`invalidate` `:125`, `hit_eta` `:176`, `quantile_at` `:147`.

**`project` must stay pure** — it takes `(multipliers, house_edge, label)` and
reads no cached state, so the per-round cost cannot inherit the scheduled cost.
`advance` runs a baseline only when the cache is cold; a warm cache is read, not
recomputed (there is a test asserting exactly this).

**`invalidate(visitor)` is load-bearing after any tape replacement.** A cached
baseline describes the tape it measured. After a reseed, `DELETE /rounds`, a
`bulk` `replace` or a `.db` import the tape is gone, so the randomness verdict
would be republished against data that no longer exists — and because the heavy
tier is *longer* than the replacement, `delta.roundsApart` would go negative.
Every tape-replacing route calls `realtime.invalidate(v)` (`api.py` bulk
replace `:512`, bulk append `:517`, clear `:546`, reseed `:563`, db-ingest
`:686`). A bulk `append` does the same: it moves the tape by far more than one
round.

State is per-visitor (`Dict[str, VisitorState]`), so one tape cannot leak
figures into another.

### `ai_summary.py` — the Entrim write-up

`summarize` (the entry point), `_guard` (the copy audit), `FORBIDDEN_CLAIMS`
`:65`, `DEFAULT_BASE_URL` `:45`, `DEFAULT_MODEL` `:46`, `DEFAULT_TTL_S` `:51`.

**The API key is server-side only.** Entrim is an OpenAI-compatible gateway
reached from Python; the browser receives prose, never the credential. Config
comes from the environment with a repo-root `.env` fallback (real env vars win).
`ENTRIM_API_KEY`, `ENTRIM_BASE_URL` and `ENTRIM_MODEL` are read through
`config()`; `ENTRIM_TTL_S` sets the cache lifetime via `_ttl_seconds()`, and a
non-positive value disables reuse so every read re-bills the gateway.

**The prose is audited, not trusted.** `_guard` substring-matches the returned
text against `FORBIDDEN_CLAIMS` and the verdict ships beside the summary, so a
tripped check is *published* rather than the text being silently laundered. This
is the module-level form of the repo rule that every engine figure ships with
its own measured quality next to it.

**It degrades, never breaks.** No key, gateway down, timeout, malformed JSON:
all return `available: False` plus a readable `reason`, and the dashboard's own
numbers render either way. The route is synchronous `def` so the blocking HTTP
call runs in the threadpool and cannot starve `/ws/rounds`.

## Landmines

1. **`strategies.STATE_BOUNDS` duplicates `pipeline.STATE_BOUNDS`, and
   `strategies.realized_state` hard-codes the cuts a third time.** They are
   identical today (`pipeline.py:19-25`, `strategies.py:18-21`, `:24-33`).
   `realized_state` is called on the ingest path (`api.py:402`) to resolve
   forecasts, so changing one copy silently mis-scores the ledger.
2. **`_migrate()` repairs a legacy `rounds` table only partially** — it adds
   `visitor_id` and `nonce` (`db.py:200`) but not `created_at`, which
   `Round.created_at` declares `nullable=False`. A database predating
   `created_at` would fail on round reads.
3. **`DELETE /api/ingest/db/{upload_id}` has no visitor check** (`api.py:621-623`),
   while `ingest.upload_path` does (`ingest.py:125`). An inconsistency worth
   fixing, not exploiting.
4. **No DB-level uniqueness**: see `db.py` above.
5. **Process-global state** — `hub`, `_SEED_LOCKS`, `_SEEDED`, `_sim_tasks`,
   `_sim_state`, `_ingest_lock`, `ingest._UPLOADS`, `seed._CACHE`,
   `watcher._seen`. Single worker only. `_SEEDED` and `_SEED_LOCKS` also grow
   without bound per visitor id.
6. **`_arm_prediction(visitor)` is called outside the seeding lock**
   (`api.py:86`), so two concurrent first requests can both arm. The call is
   idempotent unless forced, so the blast radius is small, but it is not
   serialised.
7. **`evaluate_alerts` treats any comparator other than `"gte"` as `<=`**
   (`db.py:613`) and `AlertIn.comparator` is an unvalidated `str` (`api.py:208`).
8. **`_ingest_lock` is a single global `asyncio.Lock`** (`api.py:650`), not
   per-visitor, despite its docstring claiming unrelated visitors stay parallel
   (`api.py:430-437`). Ordering is preserved; parallelism is not.
9. **Unscoped/uncapped routes**: `/fair/verify-batch`, `/fair/solve`,
   `/fair/chain?search=true` (up to 2000 SHA-256 iterations), `/fair/tape`,
   `/seed`, `/ingest/db/{id}` delete, `/health`. No auth, no rate limit.
10. **`GET /api/export`** returns up to 5000 rounds as `indent=2` JSON
    (`api.py:632`) — unpaginated and large.
11. **`engines.py` is dead**, `pipeline.state_sequence` is documented as unused
    (`pipeline.py:95-98`), and `scikit-learn` is an undeclared-in-code
    dependency.

## Verification for a backend change

```bash
cd backend && python3 -m pytest tests -q     # observed: 176 passed
```

Run it **from `backend/`** — imports are `from momento import …` and there is no
`conftest.py` or `pytest.ini`. New API-level tests must repeat the pattern the
suite already uses: set `MOMENTO_DB` to a temp path and `importlib.reload` both
`db` and `api`, because `DB_PATH` is read once at import (`db.py:18`).

See [`testing.md`](testing.md) and the `/verify-change` skill.
