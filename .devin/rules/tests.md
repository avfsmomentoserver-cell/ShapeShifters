---
description: 'Testing rules for the pytest and vitest suites.'
trigger: glob
globs: 'backend/tests/**,frontend/test/**'
---

# Tests

Full guide: [`../../docs/ai/testing.md`](../../docs/ai/testing.md).

Run pytest **from `backend/`** — imports are `from momento import …` and there is
no `conftest.py` or `pytest.ini` to fix the path. Do not add a `sys.path` hack to
an individual test.

| Suite | Command | Observed on a healthy tree |
| --- | --- | --- |
| Backend | `cd backend && python3 -m pytest tests -q` | `176 passed` in ~17 s |
| Frontend types | `npx tsc -p tsconfig.app.json --noEmit` | clean |
| Frontend unit | `npx vitest run` | 20 passed, 2 pre-existing failing *files* |

`npm run lint`, `npm test`, `npm run test:browser` and `npm run test:browser:run`
are known-broken (missing `eslint.config.js` and the vitest configs). Never
report them as passing, and never blame a real failure on them.

Rules for new tests:

1. **Test behaviour, not implementation** — assert the published number.
2. **Pin closed-form truths** (`EV = -h`, `median = 2(1-h)`, `E[wait] = x/(1-h)`),
   never a snapshot of current output.
3. **Name tests as a claim**, so a failure alone says what broke.
4. **Prove both directions** where a detector is involved — a fair tape passes
   *and* a rigged one is rejected.
5. **Seed every random draw.** Unseeded randomness in a test is a flake.
6. **Fixtures over setup noise**; regression tests quote the measured symptom in
   the docstring.
7. **Never weaken an assertion to reach green.** If the assertion is wrong,
   explain why and update both mirrored suites.
