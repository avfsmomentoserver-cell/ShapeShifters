---
name: math-change-guard
description: Change a formula, estimator, probability, expected-value figure or scoring rule safely in Momento — protects the closed-form identities, the mirrored TypeScript maths, and the lock-before-resolve forecast contract. Use before editing anything in the analytics kernel or frontend/lib/*.ts maths.
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Guard a mathematics change

This repository publishes numbers about a gambling game. A plausible change that
quietly makes a published probability wrong is the most damaging class of bug
here — worse than a crash, because nothing fails.

Read `docs/ai/domain-math.md` and `.github/instructions/math-and-stats.instructions.md`
before you touch a line.

## 1. Recognise the change class

You are in this skill if the diff touches any of:

- `backend/momento/{fairness,randomness,survival,ev,math_models,pipeline,strategies,windows,ingest,seed}.py`
- `frontend/lib/{stats,pipeline,verifyForecast,backtest,ledger}.ts`
- `backend/tests/test_reality_checks.py`, `frontend/test/hiteta.test.ts`
- Any copy on `Accuracy`, `Randomness`, `Fairness`, `Ev`, `Skill`, `Exceedance`,
  `Phases`, `Windows`, `Docs` that states a number or a claim.

## 2. State the identity before and after

Write down, in the change or in your working notes, the closed forms your edit
touches:

```
P(reach m) = (1 - h) / m
EV / unit  = -h            at every cash-out target
median     = 2 * (1 - h)
Hill index = 1.0           on a genuinely fair tape
E[wait to x] = x / (1 - h)
P(gap >= g)  = (1 - p)^g
P(no hit in T) = (1 - p)^(T / c)
Brier skill  = 1 - Brier_model / Brier_fair_price
```

If your change breaks one of these, stop. Either the change is wrong, or you
have found something real and it needs to be said out loud, not smoothed over by
editing the test.

## 3. Know the traps

| Trap | Why it matters |
| --- | --- |
| Exponential fit for survival | Returned `0.94` for `P(≥2×)` where the fair value is `0.485`. Use the empirical survival below the tail cut, Hill only in the tail. |
| Tail estimate on too few exceedances | Clamped and gated for a reason. Respect the minimum count and the clamp range. |
| Hardcoded house edge | It is a user setting. Read `db.get_settings(visitor)["houseEdge"]`. |
| Look-ahead | A component must be rebuilt from rounds `0…i-1` to predict round `i`. Anything else scores itself for free. |
| Mutating a locked forecast | Locked then resolved are separate writes. A forecast that can be edited after the fact is not a ledger. |
| Point estimates without intervals | Rates get a Wilson interval; waits come from the geometric distribution. |
| Positive skill on a fair tape | The expected result is `skill ≤ 0`. Do not tune until it looks good — that is the failure mode this whole app exists to expose. |
| Python and TypeScript drifting | `frontend/lib/` mirrors the kernel for display. Divergence means the UI lies about the backend. |

## 4. Mirror both sides in one change

If the change affects a number the UI shows, edit the Python **and** the
TypeScript in the same commit, and update `frontend/test/hiteta.test.ts`.

## 5. Prove it numerically

```bash
cd backend && python3 -m pytest tests -q
npx vitest run
```

Then compute the affected statistic on the live tape and quote the before/after
value at two consistent precision levels. "Tests pass" is not evidence the
number is right. A delta is.

## 6. Report

State: the identity you protected, the before/after measurement, the files
changed on both sides, and the exact commands run. If the honest result is that
the model has no skill, report that — it is the correct and expected finding.
