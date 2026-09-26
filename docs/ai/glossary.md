# Glossary

Terms that appear in the code, the API or the UI and are not self-evident.
Where a term is a formula, the definition is the operative one.

## Game

**Crash / crash point** — the multiplier at which a round ends. A correctly
implemented round is drawn from `P(X ≥ m) = (1-h)/m`, so the distribution is
Pareto with tail index 1 and a two-decimal floor.

**House edge (`h`)** — the operator's margin. Read it from
`db.get_settings(visitor)["houseEdge"]`. Presets are listed in `ev.py:25`
(Aviator/Spribe 3 %, Stake 1 %, Bustabit 1/101, JetX 3 %, Spaceman 3.8 %,
generic 5 %). The frontend's `HOUSE_EDGE = 0.04` in `lib/stats.ts:15` is a
standalone-maths fallback, not the app's value.

**RTP** — `1 − h`.

**Round / tape** — one recorded multiplier; the ordered sequence of them. The
tape is the only input to every statistic in the app.

**Cash-out target** — the multiplier at which a player would take profit. EV is
`-h` per unit staked at *every* target, so only turnover changes expected cost.

**Turnover** — total amount staked. `expected cost = turnover × h`. A strategy
comparison that omits turnover is not a comparison.

## Provable fairness

**Provably fair** — the crash point is a deterministic function of
`(server_seed, client_seed, nonce)`, so a revealed seed makes any round
recomputable. Verification, not prediction.

**Commitment** — `sha256(server_seed)` published before play. The seed is
revealed after. Only a revealed seed that fails to hash to its commitment is
unambiguous evidence of misconduct.

**Message template / convention** — how the three seeds are concatenated before
HMAC. Seven templates in `fairness.py:62`; the default is `client:nonce`. A
wrong template is the most common cause of a "failed" verification.
`POST /api/fair/solve` picks the convention from an observed round.

**Instant crash / instant bust** — a round that ends at 1.00×.
`crash_point_stake` flags it; the Bustabit variant produces it with probability
`1/divisor` (1/101 by default).

## Statistics

**Survival `P(X ≥ x)`** — the probability the next round reaches `x`. Estimated
empirically when there are at least 8 exceedances (`survival.py:25`), by a Hill
tail above the top 15 % otherwise.

**Exceedance** — an observation at or above a threshold. Below 8 of them an
empirical rate is noise, and the code returns `None` rather than a number.

**Hill tail index / alpha** — the Pareto exponent estimated from the top of the
distribution. The fair value is exactly `1.0`; the estimator clamps to
`[0.55, 2.5]` and needs ≥ 40 rounds.

**Wilson interval** — the binomial confidence interval used for every published
rate, because the normal approximation misbehaves at the extremes.

**Walk-forward** — rebuilding a model from rounds `0…i−1` before predicting
round `i`. Anything else is look-ahead and scores itself for free.

**Look-ahead** — using data from round `i` or later to predict round `i`. A
correctness bug, not a tuning issue.

**Brier score / Brier skill** — mean squared error of a probability forecast, and
`1 − Brier_model / Brier_fair_price`. **Zero or below is the expected value on an
independent tape** and is reported as a correct result, never tuned away.

**Log loss** — the other proper scoring rule used alongside Brier.

**Reliability** — the calibration table (predicted band vs realised frequency)
attached to engine output.

**Cadence (`c`)** — the measured median interval between rounds, used to turn a
round-count rate into a time-based one: `P(no hit in T) = (1-p)^(T/c)`.

**Drought / gap** — rounds since a threshold was last cleared. `P(gap ≥ g) =
(1-p)^g` is geometric; a gap that looks long is usually not unusual.

**Phases** — the hour-of-day analysis (`windows.earned_skill` /`hour_phases`).
It must find nothing on a shuffled fair tape and must detect a planted effect.

**Earned skill** — how much weight a forecast component earns, walk-forward. On
a fair tape no component earns any, and the baseline keeps full weight.

## Engine vocabulary

**State** — one of `Collapse`, `Shelf`, `Normal`, `Ignition`, `Moonshot`
(`pipeline.py:15`), classified per round from a window of multipliers.

**Ladder** — a run of consecutive rounds above the state boundary
(`detect_ladders`).

**Ceiling** — a multiplier value that repeats suspiciously often
(`detect_ceilings`), which would be a real finding if it survived scrutiny.

**DNA analogue** — the historical window whose z-normalised shape is closest to
the current one (`dna_match`). A similarity search, not a prediction.

**Ladder ETA** — the expected number of rounds until the next ladder, derived
from the same geometric law as every other wait.

**Regime** — `low_vol` / `moderate` / `high_vol`, from a rolling volatility
window (`detect_regimes`), with a transition table.

**ETA** — expected rounds to a threshold, `1/p` with `p = P(reach x)`, plus a
±1.5σ interval and a p90. Flagged as *tail extrapolation* when fewer than ~8 hits
are on tape (`stats.ts:401`).

**Forecast ledger** — the record of forecasts **locked** before a round and
**resolved** after it. `locked_at` and `resolved_at` are separate writes. A
forecast whose stored distribution no longer matches its stored band was mutated
after locking — a ledger-integrity bug.

**Open / armed forecast** — a locked forecast not yet resolved. Arming is
idempotent unless forced.

## Data and plumbing

**Visitor** — the client-supplied `X-Visitor-Id` header. It is the *entire*
authorization model: every table and query is filtered by it. A missing filter is
a tenant-isolation break; a `visitor_id` taken from a request body is a trivial
override.

**Tape source** — where a round came from (`live`, `import`, `simulator`,
`seed`). Simulator output must be purged before quoting a statistic
(`POST /api/rounds/purge-simulator`).

**Watcher** — the background poller over `~/Downloads` that ingests files as
they appear, deduped by `(path, size, mtime)` recorded in `watcher_seen.json`
after a successful ingest.

**Stage / preview / ingest** — the three-step SQLite import: `POST
/api/ingest/db/inspect` scores candidate columns and previews the tape, then
`POST /api/ingest/db` commits. A guessed multiplier column that is really a row
id or a monotonic counter looks plausible, which is why the preview exists.

**Baseline (heavy tier)** — the expensive scheduled pass in `realtime.py`
(randomness battery, skill, droughts), cached per visitor. Something that
measured the tape is only reusable while that tape exists, hence
`realtime.invalidate()` on any tape replacement.

**Projection (realtime tier)** — the cheap, *pure* per-round figure in
`realtime.py` that composes on top of the baseline. Pure is the contract: it
reads no cached state, so per-round cost cannot inherit the scheduled cost.

**Revision** — the monotonic counter `realtime.advance` bumps on every round.
The store drops a poll or websocket frame whose `revision` is older than the
one it holds, so an out-of-order frame cannot walk the figures backwards.

**Entrim / AI summary** — the OpenAI-compatible gateway
(`https://api.entrim.ai/v1`, default model `deepseek-ai/DeepSeek-V4-Flash`)
reached **server-side only** from `ai_summary.py` to turn every metric into one
paragraph. The prose is audited by `_guard` against `FORBIDDEN_CLAIMS` and the
verdict ships beside it. The API key never reaches the browser.

**Column scoring** — the heuristic that ranks numeric columns by how tape-shaped
they are, including detecting a sorted column (a counter, not a tape).

**WAL** — SQLite write-ahead logging, plus `synchronous=NORMAL`. Load-bearing:
one process owns the file.

**`sqlite_autoincrement`** — prevents rowid reuse in the ledger. Dropping it is
a real bug class, which is why `_migrate()` rebuilds the legacy predictions
table.

**`_migrate()`** — `db.py`'s additive schema migration. `create_all()` cannot
alter an existing table, so every change to an existing table goes here.

**Mirrored maths** — `frontend/lib/{stats,pipeline,verifyForecast,backtest,ledger}.ts`
duplicating backend formulas for live/offline display. They must agree; a
divergence means the UI lies about the backend.

**Source archive** — `public/momento-source.zip` plus the generated
`frontend/lib/source-archive.json`, produced by `scripts/package-source.sh` in a
fixed-point loop because the manifest inside the zip describes the zip.

**`__PORT_8000__`** — a build-time placeholder in `frontend/lib/api.ts`
substituted by the hosting environment. The literal string is what makes the
local dev fallback to `http://localhost:8000` work.

**Kit** — `frontend/components/kit.tsx`, the design-system primitives. Reuse
before writing a one-off panel.

**Responsible surface** — `/responsible` (`frontend/pages/Responsible.tsx`),
`showResponsibleBanner`, and the help-line references in `README.md`. Not
decoration; not removable.
