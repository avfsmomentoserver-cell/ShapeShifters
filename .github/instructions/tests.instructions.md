---
name: 'Tests'
description: 'Use when writing or changing tests under backend/tests or frontend/test, or when asked to verify a change.'
applyTo: ['backend/tests/**', 'frontend/test/**']
---
# Testing rules

Full guide: `docs/ai/testing.md`.

## Running

| Suite | Command | Working directory |
| --- | --- | --- |
| Backend | `python3 -m pytest tests -q` | `backend/` (imports are `from momento import …`, so the process must run from `backend/`) |
| Frontend | `npx vitest run` | repo root |

There is no `conftest.py` and no `pytest.ini`; the suite relies on running from
`backend/`. Do not add a `sys.path` hack to an individual test — fix the
invocation or add a proper `conftest.py` if you must.

## Current state (do not paper over)

- Backend: **176 passed** in ~17 s. Keep it green.
- Frontend: `npx vitest run` reports `2 failed | 1 passed` file-level, with 20
  passing tests. The two failures are `frontend/test/example.test.ts`
  (`describe is not defined` — no `globals: true`) and
  `frontend/test/calendar.browser.test.tsx` (browser project needs
  `vitest.browser.config.ts`, which does not exist, plus Playwright browsers).
  These are pre-existing scaffold failures. Fixing them is welcome and
  independent; ignoring them is not — never report `npm test` as passing.

## Rules for new tests

1. **Test behaviour, not implementation.** Assert the identity or the published
   number, not that a private helper was called.
2. **Pin closed-form truths.** Matching the backend suite's style: if a formula
   has a closed form (`EV = -h`, `median = 2(1-h)`, `E[wait] = x/(1-h)`), assert
   against that number, not against a snapshot of the current output.
3. **Name tests as a claim.** `test_ev_per_unit_staked_is_minus_the_edge_at_every_target`,
   `test_battery_rejects_an_obviously_rigged_tape`. A reader should know what
   broke from the failure alone.
4. **Prove both directions where it matters.** The fairness and randomness
   suites assert that a fair tape passes *and* that a rigged tape is rejected. A
   test that only checks the happy path would accept a detector that always says
   "fair".
5. **Determinism.** Seed every random draw. `Math.random()` and unseeded NumPy
   generators in a test are a flake waiting to fire.
6. **Fixtures over setup noise.** Backend tests use small pytest fixtures (e.g.
   a `tape` fixture generated with a fixed seed pair) rather than re-deriving
   data per test.
7. **A regression test per bug fix.** Quote the measured symptom in the
   docstring — the size of the error, the round where it froze, the value that
   was wrong — the way `frontend/test/hiteta.test.ts` does.
8. **Never weaken an assertion to make a change pass.** If the assertion is
   wrong, explain why in the change and update both suites.

## Do not

- Mock the analytics kernel to test a route; seed a small real tape instead.
- Add a network call or a wall-clock sleep to a test.
- Leave a test that only passes in a specific order.
