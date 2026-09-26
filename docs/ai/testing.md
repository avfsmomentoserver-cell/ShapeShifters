# Testing

Two suites, one npm script that does not work, and a house style that treats a
quoted measurement as the only acceptable evidence. `.github/instructions/tests.instructions.md`
is the always-loaded short version; this is the long form.

## Running

| Suite | Command | Working directory | Observed |
| --- | --- | --- | --- |
| Backend | `python3 -m pytest tests -q` | `backend/` | `176 passed in 16.83s` |
| Frontend types | `npx tsc -p tsconfig.app.json --noEmit` | repo root | clean |
| Frontend unit | `npx vitest run` | repo root | `Tests 20 passed (20)` / `Test Files 2 failed \| 1 passed (3)` |
| Frontend build | `npm run build` | repo root | runs `scripts/package-source.sh` first |

Run pytest **from `backend/`**. Imports are `from momento import …` and there is
no `conftest.py` or `pytest.ini` to fix the path. Do not add a `sys.path` hack to
an individual test.

`npm run lint`, `npm test`, `npm run test:browser` and `npm run test:browser:run`
are broken — see [`runbook.md`](runbook.md) §"Known broken". `npm test` chains
`vitest run` with a `vitest.browser.config.ts` that does not exist.

## Backend suite — `backend/tests/`

| File | Tests | Covers |
| --- | --- | --- |
| `test_reality_checks.py` | 21 | The closed-form identities: HMAC reproduction, `P(reach m) = (1-h)/m`, `median = 2(1-h)`, `EV/unit = -h` at every target, Hill ≈ 1, the battery passing a fair tape **and** rejecting a rigged one, Kelly declining a negative edge, ruin never negative. |
| `test_windows.py` | 34 | Wilson intervals, geometric waits, `P(gap ≥ g)`, exceedance grid vs the fair rate, hour phases detecting a planted time effect and finding nothing on a shuffled fair tape, per-component earned skill, window odds, leaderboard. |
| `test_ingest.py` | 34 | Column recognition (multiplier over `id`/stake, a monotonic counter scored below a real tape), scale detection, timestamp encodings, JSON columns and nested paths, list expansion, SQL-identifier smuggling, read-only guarantees. |
| `test_math_models.py` | 13 | Pareto MLE recovery, Markov row sums, cluster partition, regime sums, curve fitting, candidate normalisation and ranking, ETA bounds, empty inputs not crashing. |
| `test_predictor_arming.py` | 10 | A complete tape arms the predictor; reading twice does not re-lock; reseeding arms on the new tape; an armed forecast resolves against the next real round; a too-short tape says so. |
| `test_migrations.py` | 6 | A legacy predictions table gains `sqlite_autoincrement`; every row and id survives; ids are not reused; re-running is a no-op; a current database is untouched. |
| `test_ingest_api.py` | 5 | Auto-ingest picks a column and explains it, reads JSON, honours an explicit override, refuses a tape-shaped-less database, and arms a forecast. |
| `test_watcher.py` | 4 | A new file is ingested exactly once with real timestamps; a grown file takes only the tail; rounds already on the tape are skipped. |
| `test_realtime_layering.py` | 10 | `project` is pure and writes no state; `advance` runs a baseline when cold and *does not* recompute it when warm; the revision is monotonic and per visitor; `invalidate` drops a baseline measured against a replaced tape and a shorter tape never reports negative `roundsApart`; `delta` is zero right after a scheduled pass and non-zero once the live tier moves ahead; the shape forecast is a drawn curve with the projection and the empirical tape kept separate. |
| `test_realtime_api.py` | 10 | Route shapes for `/stats/realtime`, `/stats/baseline`, `/stats/shape`; the realtime route is visitor-scoped; a reseed and a `bulk replace` both re-measure the baseline; the shape route 422s on a tape it cannot fit; `/stats/ai-status` never leaks the key; the summary route degrades without spending a request. |
| `test_ai_summary.py` | 14 | `_guard` flags each claim this repo forbids (case-insensitively), accepts a measurement of the past tape, and does not flag an honest negative result; the digest carries every tier, is JSON-serialisable, and invents no number the engine did not measure; parsing handles fenced JSON and prose; `summarize` degrades on no key / gateway failure / no tape and reports the guard verdict on a violating answer; the cache reuses a successful answer; the status payload never exposes the key. |

`test_migrations.py` and `test_watcher.py` are the two suites that exist purely
because of a past incident. Read them before changing `db._migrate()` or the
watcher's seen-cache.

## Frontend suite — `frontend/test/`

| File | State | Covers |
| --- | --- | --- |
| `hiteta.test.ts` | passing (20 tests) | The "ETA to big hits" figures. Pins `P(reach x) = (1-h)/x` and `E[wait to x] = x/(1-h)` on a 40 000-round synthetic fair tape at `h = 0.04` (2× → 2.06 rounds, 5× → 5.16, 10× → 10.42), the Hill fallback below 8 exceedances, tail-extrapolation flagging, `calibratedQuantile` as a true inverse of the survival curve, `fullForecast` recovering p01…p99, `hitBandEtas`, and `verifyForecast`'s coverage accounting and Brier floor. |
| `example.test.ts` | **failing** | Scaffold. `ReferenceError: describe is not defined` — no vitest config sets `globals: true`. Either write `vitest.config.ts` or import from `vitest`. |
| `calendar.browser.test.tsx` | **failing** | Scaffold. Needs `vitest.browser.config.ts` (absent) and Playwright browsers (`npx playwright install chromium`). |

`hiteta.test.ts` is the model for a regression test in this repo: the docstring
names the measured symptom (the legacy exp/pareto blend claimed ~94 % for 2× where
the truth is ~48 %), and the assertions are against closed-form values rather than
recorded output.

## Rules for new tests

1. **Test behaviour, not implementation.** Assert the identity or the published
   number, not that a private helper was called.
2. **Pin closed-form truths.** If a formula has a closed form, assert against
   that number instead of a snapshot of current output.
3. **Name the test as a claim.**
   `test_ev_per_unit_staked_is_minus_the_edge_at_every_target`,
   `test_battery_rejects_an_obviously_rigged_tape`. A reader should know what
   broke from the failure alone.
4. **Prove both directions where it matters.** The fairness and randomness suites
   assert a fair tape passes *and* a rigged tape is rejected — a detector that
   always answers "fair" would satisfy a happy-path-only test. Same for
   martingale/ruin/EV guards: include the nonsense input.
5. **Determinism.** Seed every random draw. An unseeded NumPy generator or
   `Math.random()` in a test is a flake waiting to fire. The backend `tape`
   fixture is generated from a fixed seed pair for this reason, and the frontend
   uses a small LCG so the synthetic tape is reproducible.
6. **Fixtures over setup noise.** Small pytest fixtures (`tmp_db`, `tape`,
   `client`, `clean_seen`) rather than re-deriving data per test.
7. **A regression test per bug fix**, with the measured symptom in the docstring:
   the size of the error, the round where it froze, the value that was wrong.
8. **Degenerate inputs.** Empty tape, one round, no tail exceedances, all
   identical rounds, `h = 0`, a 1.00× floor, a round so large the tail estimate
   clamps.
9. **The wire contract.** A field in a `db.py` serializer ⇔ a field in the
   `frontend/lib/api.ts` interface ⇔ something a component consumes. Mocked-response
   tests in JS accept an over-story (`toHaveBeenCalled` with `>= 1`) or a missing
   field; assert on values and use `toHaveBeenCalledTimes(1)` where the count
   matters.
10. **Never weaken an assertion to reach green.** If the assertion is wrong,
    explain why in the change and update both mirrored suites.

## Do not

- Mock the analytics kernel to test a route. Seed a small real tape instead.
- Add a network call or a wall-clock sleep to a test.
- Leave a test that only passes in a specific order.
- Add `--no-verify`, `pytest.skip` or `it.skip` to get to green.
- Report `npm test` or `npm run lint` as passing, or blame a real failure on the
  known-broken table without checking which one it is.

## What "proving a change" looks like here

`npm run build` succeeding is not evidence a feature works, and a green suite is
not evidence a *number* is right. For anything that changes a published
statistic, recompute it on the live tape and quote the before/after value.
Skill: `/verify-change`. See also [`.agents/skills/verify-change/SKILL.md`](../../.agents/skills/verify-change/SKILL.md).
