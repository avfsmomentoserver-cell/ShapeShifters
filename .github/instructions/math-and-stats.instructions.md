---
name: 'Math and statistics'
description: 'Use when editing the analytics kernel (fairness, randomness, survival, ev, math_models, pipeline, strategies, windows) or its mirrored TypeScript implementation.'
applyTo: 'backend/momento/{fairness,randomness,survival,ev,math_models,pipeline,strategies,windows,ingest,seed}.py'
---
# Mathematics rules

This is the part of the codebase where a plausible-looking change silently makes
every published number wrong. Read `docs/ai/domain-math.md` before editing.

## The identities that must keep holding

For house edge `h`, a fair crash point satisfies:

```
P(reach m)  = (1 - h) / m
EV / unit   = -h          (at every cash-out target, by construction)
median      = 2 * (1 - h)
tail index  = 1.0         (Hill estimator on a genuinely fair tape)
```

These are asserted in `backend/tests/test_reality_checks.py` and mirrored in
`frontend/test/hiteta.test.ts`. If your change breaks one, either the change is
wrong or you have found something important — in both cases stop and say so
explicitly rather than adjusting the test to fit.

## Rules

1. **Use the empirical survival function directly, not an exponential fit.**
   The original build fitted an exponential and reported `P(≥ 2×) ≈ 0.94` where
   the fair value is `0.485`. Heavy-tailed data must be described empirically
   below the tail cut, with the Hill index only in the tail — and only with
   enough exceedances to justify it (at least eight), clamped to a documented
   range, falling back to a blended empirical estimate otherwise.
2. **Never hardcode the house edge.** Read it from settings; the presets are user
   visible.
3. **Intervals, not point estimates.** Rates get a Wilson score interval. Waits
   come from the geometric distribution: `median = ln(0.5)/ln(1-p)`,
   `P(gap ≥ g) = (1-p)^g`, `P(no hit in window T) = (1-p)^(T/c)` with `c` the
   measured cadence.
4. **Look-ahead is a correctness bug.** Walk-forward scoring rebuilds the model
   from rounds `0…i-1` before it predicts round `i`. Any new scored component
   must do the same or it will look skilled for free. The skill ledger exists
   precisely to catch this.
5. **Forecasts are locked before the round and resolved after it.** Locking and
   resolution are separate writes; never mutate a locked forecast's
   distribution, band or probability. Scoring is Brier plus log loss, and the
   skill score is `1 - Brier_model / Brier_fair_price` — a value at or below
   zero is the expected outcome on an independent tape and is *not* a bug to be
   tuned away.
6. **Small samples must degrade gracefully.** Every estimator needs a defined
   behaviour for an empty tape, a single round, and a tape with no exceedances
   above the tail cut. `test_empirical_survival_handles_an_empty_window` and
   `test_battery_does_not_crash_on_a_short_tape` exist for this; keep them
   passing and add cases as you add estimators.
7. **A passing randomness battery does not prove fairness, and no finite test
   can.** Failing one is more informative than passing six, and the usual cause
   of a failure is a wrong edge setting or a small sample, not a rigged game.
   Never word an output as "the game is fair".
8. **Mirror, don't fork.** The TS versions in `frontend/lib/` must produce the
   same numbers as the Python for the same input. If they diverge, the UI lies
   about the backend, which is worse than not showing the number.
9. **Keep the seed/commitment split.** `sha256(server_seed)` is committed before
   play; the crash point is derived only after revelation. A mismatch between
   predicted and observed crash can mean a different message convention rather
   than misconduct — the solver (`/api/fair/solve`) exists so you do not have to
   guess, and only a revealed seed that fails to hash to its published
   commitment is unambiguous.

## Verification

```bash
cd backend && python3 -m pytest tests -q
npx vitest run
```

Recompute the affected statistic on the live tape and quote the before/after
value in your report. "Tests pass" is not evidence that the number is right;
a measured delta is.
