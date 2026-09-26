# Data model and wire contract

Source of truth: `backend/momento/db.py`. Every table carries `visitor_id` and
every query filters on it — that is the entire authorization model.

## Connection and storage

| Thing | Where |
| --- | --- |
| Database file | `DB_PATH = os.environ.get("MOMENTO_DB", "<repo>/backend/momento.db")` (`db.py:19`) |
| Visitor default | `DEFAULT_VISITOR = "local"` (`db.py:23`) |
| Journal mode | WAL, plus `synchronous=NORMAL`, set on connect (`db.py:176`) |
| Migrations | `init_db()` (`:186`) → `_migrate()` (`:191`) |
| Watcher cache | `watcher_seen.json`, written beside the DB |
| Timestamps | ISO strings via `_now()` (`:251`), stored in `String` columns |

`*.db*`, `watcher_seen.json` and `seed/` are gitignored user data. One process owns
the file; a second writer is a corruption risk, not a scaling win.

## Tables

### `rounds` — the tape (`db.py:28`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Integer PK autoincrement | |
| `visitor_id` | String, not null, indexed, default `"local"` | |
| `timestamp` | String, not null | ISO |
| `multiplier` | Float, not null | Two-decimal floor |
| `band` | String, nullable | Bucketed label |
| `nonce` | Integer, nullable | |
| `source` | String, not null, default `"api"` | `live` / `import` / `simulator` / `seed` / `api` |
| `created_at` | String, not null | |

Serializer `_round_dict` (`:259`) → `{id, ts, m, band, nonce, source}`. Note the
short wire names: **`ts` and `m`, not `timestamp` and `multiplier`.**

Helpers: `insert_round` (`:268`), `round_exists` (`:288`, the dedupe check on
`(multiplier, ts)`), `insert_rounds_bulk` (`:307`), `insert_rounds_stamped`
(`:333`, the timestamped variant the watcher and ingest use), `recent_rounds`
(`:366`), `multipliers_for` (`:373`), `count_rounds` (`:377`), `source_counts`
(`:382`), `delete_round` (`:391`), `update_round` (`:398`), `clear_rounds`
(`:410`), `delete_rounds_by_source` (`:418`).

### `predictions` — the forecast ledger (`db.py:40`)

The only table with `__table_args__ = {"sqlite_autoincrement": True}` (`:50`), and
the comment above it (`:43`) explains why: a plain `INTEGER PRIMARY KEY` reuses
ids, and a reused forecast id silently corrupts the lock-then-resolve scoring.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Integer PK autoincrement | |
| `visitor_id` | String, not null, indexed | |
| `target_round_id` | Integer, nullable | |
| `state` | String, not null | One of the 5 pipeline states |
| `band_lo`, `band_hi` | Float, not null | |
| `probability` | Float, not null | |
| `p_above_2`, `p_above_10` | Float, not null, default 0.0 | |
| `eta` | Float, nullable | |
| `distribution` | Text, nullable | JSON: full 5-state distribution |
| `drivers` | Text, nullable | JSON: explainability payload |
| `actual`, `actual_state`, `band_hit`, `hit_2`, `hit_10`, `brier` | | Filled at resolution |
| `locked_at` | String, not null | Lock time |
| `resolved_at` | String, nullable | Resolution time |

**Invariant:** `locked_at < resolved_at`, and a locked row's `distribution`,
`band_lo`/`band_hi` and `probability` are never mutated afterwards. Two writes,
two timestamps. A stored `distribution` that no longer agrees with the stored
`band` means something edited a locked forecast.

Serializer `_prediction_dict` (`:445`) → `{id, targetRoundId, state, band:
[lo, hi], probability, pAbove2, pAbove10, eta, distribution, drivers, actual,
actualState, bandHit, hit2, hit10, brier, lockedAt, resolvedAt}`.

Helpers: `open_prediction` (`:458`), `lock_prediction` (`:466`),
`resolve_open_predictions` (`:491`), `predictions` (`:516`).

### `alerts`, `alert_events` (`db.py:73`, `:87`)

`alerts`: `id`, `visitor_id`, `name`, `kind` (`multiplier` | `dry_streak` |
`regime` | `pressure` | `state`), `comparator` (default `gte`), `threshold`
(default 10.0), `active` (default true), `trigger_count`, `last_triggered_at`,
`created_at`. Serializer `_alert_dict` (`:527`).

`alert_events`: `id`, `visitor_id`, `alert_id`, `alert_name`, `message`, `value`,
`round_id`, `created_at`. Serializer inline at `:579`.

Helpers: `list_alerts` (`:533`), `create_alert` (`:539`), `toggle_alert`
(`:549`), `delete_alert` (`:560`), `record_alert_event` (`:567`),
`alert_events` (`:584`), `evaluate_alerts` (`:593`), `seed_default_alerts`
(`:621`).

### `annotations` (`db.py:99`)

`id`, `visitor_id`, `chart` (indexed; `tape`|`candles`|`dist`|`survival`|
`returnmap`|`equity`), `kind` (`level`|`trend`|`rect`|`pen`), `points` (Text,
JSON `[[x, y], …]`), `color` (default `#38c7e8`), `label`, `created_at`.
Serializer `_annotation_dict` (`:817`). Helpers from `:823`.

### `settings` (`db.py:118`)

`visitor_id` is the **primary key**; the payload is a JSON blob. `updated_at`.
`DEFAULT_SETTINGS` (`db.py:633`) is the merge base:

| Key | Default |
| --- | --- |
| `houseEdge` | `0.03` |
| `edgePreset` | `"aviator"` |
| `operator` | `"Aviator (Spribe)"` |
| `currency` | `"BWP"` |
| `defaultTarget` | `2.0` |
| `bankroll` | `1000.0` |
| `maxRiskPerRound` | `0.02` |
| `sessionLossLimit` | `0.15` |
| `liveFeedIntervalMs` | `2500` |
| `simulatorEnabled` | `false` |
| `showResponsibleBanner` | `true` |
| `theme` | `"phosphor"` |
| `confidenceFloor` | `0.45` |

`get_settings` (`:653`) merges the stored blob over the defaults; a corrupt blob
is swallowed and the defaults are used. `save_settings` (`:665`) patches and
upserts. **`houseEdge` is the key every maths call site must read; do not
hardcode an edge in a route.**

### `bet_sessions`, `bets` (`db.py:125`, `:140`)

`bet_sessions`: `id`, `visitor_id`, `name`, `bankroll_start`, `bankroll_current`,
`stake`, `target`, `loss_limit`, `status` (`open`|`closed`|`stopped_out`),
`started_at`, `ended_at`. Serializer `_session_dict` (`:683`) emits both
`endedAt` and `closedAt` for the same timestamp — a deliberate alias, because the
UI reads `closedAt` and the export reads `endedAt` (`db.py:687`). It also computes
`pnl`, `pnlPct`, `bets`, `wins`, `losses`, `hitRate`.

`bets`: `id`, `visitor_id`, `session_id` (indexed), `stake`, `target`,
`result_multiplier`, `won`, `pnl`, `bankroll_after`, `note`, `created_at`.
Serializer inline at `:761` (as `result`, not `resultMultiplier`) and `:770`.

Helpers: `create_session` (`:714`), `close_session` (`:726`), `log_bet`
(`:739`), `list_bets` (`:770`). `log_bet` returns `{bet, session, stoppedOut}`.
No negative bankroll, no multiplier below 1.00, ever.

### `seed_audits` (`db.py:155`)

`id`, `visitor_id`, `label`, `algorithm` (default `hmac_sha256`), `server_seed`,
`server_seed_hash`, `client_seed`, `nonce`, `expected`, `observed`, `matched`,
`commitment_valid`, `created_at`. Serializer `save_seed_audit` (`:784`) →
`{id, label, algorithm, clientSeed, nonce, expected, observed, matched,
commitmentValid, createdAt}` — note `server_seed` is **not** echoed back.
`list_seed_audits` (`:803`).

### `_migrate()` (`db.py:191`)

Additive schema changes go here; `create_all()` cannot alter an existing table.
The one migration implemented is `_migrate_predictions_to_autoincrement` (`:206`),
which rebuilds a legacy `predictions` table to gain `sqlite_autoincrement` while
preserving every row and id. `test_migrations.py` pins: rows and ids survive, no
scaffolding is left behind, ids are not reused afterwards, re-running is a no-op,
and a current database is untouched.

**If you drop or "simplify" that rebuild, ids become reusable and the ledger's
self-scoring claim fails silently.**

## Routes

All routes are mounted on an `APIRouter` named `api` plus two on `app`. 68
decorators in `backend/momento/api.py`. Handlers are synchronous `def` except the
websocket; see `architecture.md` for why.

### Health and metadata

| Method | Path | Line |
| --- | --- | --- |
| GET | `/health` | 300 |
| GET | `/meta` | 312 |
| GET | `/` (`app`) | 1349 |

### Rounds and the tape

| Method | Path | Line | Notes |
| --- | --- | --- | --- |
| GET | `/rounds` | 334 | Recent tape, visitor-scoped. |
| POST | `/rounds` | 441 | Single round. |
| POST | `/rounds/bulk` | 449 | Bulk insert; deduped on `(multiplier, ts)`. |
| PATCH | `/rounds/{round_id}` | 463 | |
| DELETE | `/rounds/{round_id}` | 473 | |
| DELETE | `/rounds` | 480 | Clear the tape. |
| POST | `/rounds/reseed` | 486 | Re-seed the demo tape. |
| POST | `/rounds/purge-simulator` | 1255 | Remove simulator contamination. |
| WS | `/ws/rounds` (`app`) | 1282 | Live feed. |

### Ingest, export, analysis

| Method | Path | Line | Notes |
| --- | --- | --- | --- |
| POST | `/ingest/db/inspect` | 507 | Scores candidate columns, previews. |
| POST | `/ingest/db` | 524 | Commits an import. |
| DELETE | `/ingest/db/{upload_id}` | 622 | |
| GET | `/export` | 627 | Whole-workspace export. |
| GET | `/analysis` | 649 | |
| GET | `/stats/summary` | 761 | |

### Models, engines, forecast

| Method | Path | Line |
| --- | --- | --- |
| GET | `/forecast` | 661 |
| GET | `/seed` | 677 |
| GET | `/eta` | 687 |
| GET | `/survival` | 706 |
| GET | `/curves` | 719 |
| GET | `/ladder` | 728 |
| GET | `/dna` | 738 |
| GET | `/context` | 755 |
| POST | `/predictions/arm` | 802 |
| GET | `/ledger` | 818 |
| GET | `/calibration` | 847 |

### Randomness and windows

| Method | Path | Line |
| --- | --- | --- |
| GET | `/randomness` | 860 |
| GET | `/randomness/{test}` | 867 |
| GET | `/windows` | 963 |
| GET | `/exceedance` | 977 |
| GET | `/droughts` | 987 |
| GET | `/phases` | 999 |
| GET | `/skill` | 1010 |

### Realtime and AI (two-tier layer, Entrim summary)

| Method | Path | Line | Notes |
| --- | --- | --- | --- |
| GET | `/stats/realtime` | 829 | Composed payload: `realtime` (cheap projection) + `baseline` (heavy, cached) + `delta` between them. |
| GET | `/stats/shape` | 840 | The projected curve for the chart-prediction visual; 422 below `MIN_ROUNDS`. |
| GET | `/stats/baseline` | 855 | The scheduled tier alone; also the cache-warm path. |
| GET | `/stats/ai-summary` | 868 | Entrim write-up of every metric; `available: false` + `reason` on any failure. |
| GET | `/stats/ai-status` | 885 | `configured`, `model`, `baseUrl`. Never returns the key. |

### Entrim AI summary wire shape

`GET /api/stats/ai-summary` always returns HTTP 200 so the panel never renders
an error state; the outcome lives in the body:

| Field | Meaning |
| --- | --- |
| `available` | `false` when unconfigured or the gateway failed — `reason` says which. |
| `reason`, `model` | Why it is unavailable; the model id in use. |
| `headline`, `text` | The one-line lead and the full paragraph. |
| `summary.body[]`, `summary.watch[]` | The breakdown lines and the "what to watch" list. |
| `guard.passed`, `guard.violations[]` | The copy-audit verdict against `FORBIDDEN_CLAIMS` (matched phrase + why). Published, never hidden. |
| `revision`, `rounds`, `cached`, `elapsedMs` | Which tape revision this describes, and the gateway cost. |

The realtime routes are described in [`backend.md`](backend.md) §`realtime.py`;
the AI routes in §`ai_summary.py`. A tape-replacing write must call
`realtime.invalidate(v)` — see that section for which routes do.

### Expected value and strategies

| Method | Path | Line |
| --- | --- | --- |
| GET | `/ev/table` | 891 |
| GET | `/ev/kelly` | 899 |
| POST | `/ev/ruin` | 913 |
| GET | `/ev/martingale` | 921 |
| GET | `/ev/plan` | 928 |
| POST | `/backtest` | 941 |
| GET | `/backtest/grid` | 950 |

### Provable fairness

| Method | Path | Line |
| --- | --- | --- |
| POST | `/fair/verify` | 1024 |
| POST | `/fair/verify-batch` | 1036 |
| POST | `/fair/solve` | 1042 |
| GET | `/fair/conventions` | 1048 |
| POST | `/fair/chain` | 1059 |
| GET | `/fair/hash` | 1067 |
| GET | `/fair/audits` | 1072 |
| GET | `/fair/tape` | 1081 |

### Alerts, sessions, settings, simulator, annotations

| Method | Path | Line |
| --- | --- | --- |
| GET | `/alerts` | 1096 |
| POST | `/alerts` | 1110 |
| PATCH | `/alerts/{alert_id}` | 1117 |
| DELETE | `/alerts/{alert_id}` | 1127 |
| GET | `/sessions` | 1138 |
| POST | `/sessions` | 1147 |
| POST | `/sessions/{session_id}/close` | 1154 |
| GET | `/sessions/{session_id}/bets` | 1164 |
| POST | `/sessions/{session_id}/bets` | 1171 |
| GET | `/settings` | 1185 |
| PUT | `/settings` | 1192 |
| POST | `/sim/start` | 1220 |
| POST | `/sim/stop` | 1246 |
| GET | `/sim/status` | 1270 |
| GET | `/annotations` | 1301 |
| POST | `/annotations` | 1308 |
| PATCH | `/annotations/{annotation_id}` | 1322 |
| DELETE | `/annotations/{annotation_id}` | 1332 |
| DELETE | `/annotations` | 1339 |

## The wire contract

Three files must agree, and a field missing from any one of them is a defect:

1. the `db.py` serializer (`camelCase` keys),
2. the TypeScript interface in `frontend/lib/api.ts`,
3. the component that consumes it.

Checklist for a new field: present in the serializer ⇔ present in `api.ts` ⇔
actually read by a component. Mocked-response tests in JS accept an over-story
(`toHaveBeenCalled` with `>= 1`) or silently ignore a missing field — assert on
values, and use `toHaveBeenCalledTimes(1)` where the count matters.

Known aliases to keep straight:

| Serializer key | Underlying column | Why |
| --- | --- | --- |
| `ts` | `rounds.timestamp` | Short wire name |
| `m` | `rounds.multiplier` | Short wire name |
| `endedAt` / `closedAt` | `bet_sessions.ended_at` | UI vs export, both emitted (`db.py:687`) |
| `result` | `bets.result_multiplier` | In the bet payload |

## Visitor scoping — the rule that is not negotiable

```python
def route(..., x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")):
    visitor = visitor_of(x_visitor_id)
```

- `visitor_id` comes **from the header**, never from a request body.
- Every query filters on it. `X-Visitor-Id` is client-supplied and is the only
  partition between users, deliberately: this is a local-first analytics
  sandbox, not multi-tenant auth. That makes a missing filter a complete
  tenant-isolation break.
- The frontend sends it from `lib/api.ts`; the value itself is not
  security-sensitive, but the *filter* is.
