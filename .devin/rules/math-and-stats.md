---
description: 'Maths rules for the analytics kernel and its mirrored TypeScript twin.'
trigger: glob
globs: 'backend/momento/fairness.py,backend/momento/randomness.py,backend/momento/survival.py,backend/momento/ev.py,backend/momento/math_models.py,backend/momento/pipeline.py,backend/momento/strategies.py,backend/momento/windows.py,backend/momento/realtime.py,backend/momento/ingest.py,backend/momento/seed.py,frontend/lib/stats.ts,frontend/lib/pipeline.ts,frontend/lib/backtest.ts,frontend/lib/verifyForecast.ts,frontend/lib/ledger.ts'
---

# Mathematics

Full detail: [`../../docs/ai/domain-math.md`](../../docs/ai/domain-math.md). This is the
part of the codebase where a plausible-looking change silently makes every
published number wrong.

The identities that must keep holding, for house edge `h`:

```
P(reach m)  = (1 - h) / m
EV / unit   = -h          at every cash-out target, by construction
median      = 2 * (1 - h)
tail index  = 1.0         Hill estimator on a genuinely fair tape
```

Pinned in `backend/tests/test_reality_checks.py` and `frontend/test/hiteta.test.ts`.
If a change breaks one, either the change is wrong or you found something
important — stop and say so; never adjust the test to fit.

- **Empirical survival, not an exponential fit.** The original build fitted an
  exponential and reported `P(≥ 2×) ≈ 0.94` where the fair value is `0.485`.
  Describe the body empirically, use the Hill index only in the tail, require at
  least eight exceedances, clamp to a documented range, and fall back to a
  blended estimate otherwise.
- **Never hardcode the house edge** — `db.get_settings(visitor)["houseEdge"]`.
- **Intervals, not point estimates.** Wilson for rates; waits from the geometric
  distribution with the measured cadence `c`.
- **Look-ahead is a correctness bug.** Walk-forward rebuilds the model from
  rounds `0…i-1` before predicting round `i`.
- **Forecasts lock before the round and resolve after it**, as two separate
  writes. Never mutate a locked forecast's distribution, band or probability.
- **Mirror, don't fork.** `frontend/lib/*.ts` must produce the same numbers as
  the Python for the same input.
- **Small samples degrade gracefully** — an empty tape, one round, no tail
  exceedances all have defined behaviour.
- **A passing battery does not prove fairness.** Never word an output as "the
  game is fair".

Verify with `cd backend && python3 -m pytest tests -q` and `npx vitest run`, and
quote the recomputed statistic before/after. "Tests pass" is not evidence the
number is right; a measured delta is.
