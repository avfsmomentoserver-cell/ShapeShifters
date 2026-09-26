---
name: verify-change
description: Prove a change in Momento before reporting it — run the backend pytest suite, the frontend typecheck/tests/build, distinguish new failures from the known scaffold ones, and write a report with real command output. Use at the end of any implementation task.
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Verify a change

The house style is to quote measurements, not assurances. Commits in this repo
end with a `Verified:` line naming the exact checks that ran and what they
printed. Do the same.

## 1. Run the suites

```bash
cd backend && python3 -m pytest tests -q
```

Expected on a healthy tree: **176 passed** in roughly 17 seconds. Run it from
`backend/` — imports are `from momento import …` and there is no `conftest.py`
or `pytest.ini` to fix the path.

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
npm run build
```

Expected: typecheck clean; `npx vitest run` reports **20 tests passing** with
**2 failing test *files*** that are pre-existing scaffold problems; build
succeeds (it runs `scripts/package-source.sh` first, which re-packs
`public/momento-source.zip` until `frontend/lib/source-archive.json` converges —
that file is generated, do not commit a hand edit to it).

## 2. Know what is already broken, so you do not mis-report it

| Symptom | Cause | Verdict |
| --- | --- | --- |
| `npm run lint` prints an ESLint 9 migration message | `eslint.config.js` does not exist | pre-existing, unrelated |
| `npm test` fails | it chains `vitest run` with a missing `vitest.browser.config.ts` | pre-existing, unrelated |
| `frontend/test/example.test.ts`: `describe is not defined` | no vitest config sets `globals: true` | pre-existing |
| `frontend/test/calendar.browser.test.tsx` fails | needs the missing browser config and Playwright browsers (`npx playwright install chromium`) | pre-existing |
| Browser test cannot launch Chromium | no Playwright browser cache on this machine | environment |

Fixing these is welcome and independent. **Never** report `npm test` or
`npm run lint` as passing, and never silence a real failure by pointing at this
table — check which one you are looking at.

## 3. Add the check that proves *your* change

- Backend behaviour → a pytest that asserts the published number or the
  identity, plus the existing closed-form suite in
  `backend/tests/test_reality_checks.py` still green.
- Frontend behaviour → typecheck, plus a vitest covering the logic, plus a real
  look at the route with both processes running.
- **Formula or estimator → recompute the affected statistic on the live tape
  and quote before/after.** "Tests pass" is not evidence the number is right.
- **Route or page → exercise it.** `curl` the endpoint; load the route. A file
  that compiles is not a feature that works.

## 4. Prove the negative cases too

Where the code claims to detect something, show it also *rejects*. The fairness
and randomness suites assert both a fair tape passes and a rigged tape is
rejected; a detector that always answers "fair" would satisfy a happy-path-only
test. If your change adds a guard, a validation, or a threshold, add the input
that is supposed to trip it.

## 5. Report with evidence

State: the files changed and why; each command you ran **verbatim**; its exit
code or summary line; any failure you did not fix and whether it is
pre-existing. If you did not run something, say so. If you ran it and it failed,
paste the failure — a hidden failing check is worse than a reported one.

## 6. Do not

- Add `--no-verify`, skip markers, or `pytest.skip` to get to green.
- Weaken an assertion to make a change pass; if the assertion is wrong, explain
  why and update both mirrored suites.
- Claim browser or end-to-end validation you did not perform.
