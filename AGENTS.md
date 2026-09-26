# AGENTS.md — Momento (crash-curve analytics terminal)

Single source of truth for every AI agent working in this repository. Read by
Devin CLI, GitHub Copilot in VS Code, Codex and other `AGENTS.md`-compatible
harnesses. Keep it short: detail lives in [`docs/ai/`](docs/ai/README.md).

> **Read [`docs/ai/README.md`](docs/ai/README.md) first for any non-trivial task**, then the
> one or two knowledge-base pages it points you at. Do not re-derive the
> architecture by grepping the tree.

---

## 1. What this project is

A full-stack analytics terminal for crash-curve games (Aviator, Stake Crash,
Bustabit, JetX, Spaceman).

- **Backend** — FastAPI + SQLAlchemy + SQLite (WAL), Python 3.11+. Pure
  measurement: HMAC-SHA256 provably-fair verification, an independence
  randomness battery, a two-part survival estimator, expected-value / Kelly /
  ruin mathematics, a GMM/HMM-flavoured pattern engine layer, and a
  lock-then-resolve forecast ledger scored with Brier.
- **Frontend** — React 19 + Vite + Tailwind, a phosphor-green terminal UI built
  on `shadcn/ui` primitives. 21+ routes. Talks to the backend over REST and a
  websocket. **No browser storage.**

### The one rule that overrides all others

**A correctly implemented crash game is unpredictable and every stake carries
negative expected value.** Analytics here describe the past tape and measure
their own predictive failure. Never add a feature, default, label, or piece of
copy that implies the software can predict the next round, find a profitable
time to play, or beat the house edge. Honest negative results are the product;
presenting them as signals is a bug of the highest severity.

Corollaries you must respect in code and copy:

- Every forecast is a *distribution over outcomes*, never a call to bet.
- Engine output always carries its own measured accuracy (Brier skill, log
  loss, reliability) next to it.
- Comparison of strategies must report turnover, because expected cost is
  `turnover × house_edge` and nothing else.
- The responsible-gambling surface (`/responsible`, `Responsible.tsx`,
  `showResponsibleBanner`) is not decoration and is not to be removed.

---

## 2. Repository map

```
backend/momento/        FastAPI service and the whole analytics kernel
  api.py                REST + /ws/rounds; ~73 routes; visitor scoping
  db.py                 SQLAlchemy models, WAL setup, migrations, serializers
  ingest.py             multiplier/timestamp/column recognition, DB import
  watcher.py            ~/Downloads file watcher feeding the live tape
  fairness.py           HMAC crash reproduction, 7 message conventions, solver
  randomness.py         chi-square, KS, runs, autocorrelation, conditional,
                        digit uniformity
  survival.py           empirical survival + Hill tail index
  math_models.py        Pareto, exponential, Markov, GMM, regime, curve fits,
                        ensemble + ETA
  pipeline.py           ladders, DNA analogues, forecast lock/resolve, Brier
  ev.py                 expected value, Kelly, ruin simulation, plans
  strategies.py         strategy backtester + parameter grid
  windows.py            Wilson intervals, exceedance, droughts, phases, skill
  realtime.py           two-tier live layer: cheap per-round projection composed
                        on a cached heavy scheduled pass
  ai_summary.py         Entrim write-up of every metric, server-side key only,
                        with a copy-integrity guard on the returned prose
  seed.py               demo tape seeding
backend/tests/          pytest suite (176 tests)
backend/scripts/        archive-tape rebuild tooling
frontend/pages/         one file per route (21 routes)
frontend/components/    AppShell, kit.tsx primitives, charts.tsx, chartlab/,
                        ui/ (shadcn), feature panels
frontend/lib/           api.ts (transport), store.ts (backend-backed state),
                        stats.ts / pipeline.ts / backtest.ts / ledger.ts /
                        verifyForecast.ts (mirrored math), avfs.ts, utils.ts
frontend/test/          vitest tests (node + browser projects)
docs/ai/                AI knowledge base — architecture, domain, conventions
.agents/skills/         shared agent skills (VS Code + Devin)
.github/agents/         VS Code custom agents (the dev team)
.github/instructions/   path-scoped Copilot instructions
.devin/                 Devin CLI config, rules and subagent profiles
.vscode/                committed workspace config (tasks, launch, settings)
```

---

## 3. Commands

| Task | Command | Notes |
| --- | --- | --- |
| Backend server | `cd backend && python -m uvicorn momento.api:app --host 0.0.0.0 --port 8000` | Writes `backend/momento.db`. Docs at `/docs`. |
| Backend tests | `cd backend && python3 -m pytest tests -q` | 176 tests, ~16 s. Run from `backend/`. |
| Frontend dev server | `npm run dev` | Vite on `:5173`, proxies nothing — calls `http://localhost:8000`. |
| Frontend build | `npm run build` | Runs `scripts/package-source.sh` first, then `vite build`. |
| Frontend typecheck | `npx tsc -p tsconfig.app.json --noEmit` | `strict` is **off** by choice; do not flip it. |
| Frontend tests | `npx vitest run` | See the caveat in §6. |

Both processes must be running for the app to work: the frontend is a static
bundle and every figure comes from the API.

---

## 4. Conventions

### Universal

- Match the file you are editing. This codebase favours **dense, explanatory
  comments that justify a decision** (why WAL, why AUTOINCREMENT, why no
  `localStorage`, why the sample was rejected) over narration of what a line
  does. Do not strip those comments; add one when you make a non-obvious call.
- Keep diffs minimal and scoped. Do not reformat unrelated code.
- No new dependency without a stated reason. The backend is deliberately
  stdlib + numpy/scipy/sklearn/sqlalchemy/fastapi; the frontend is deliberately
  React + Tailwind + Radix + recharts + react-query.
- Rounding is a correctness concern here, not cosmetics: multipliers are
  `floor(x * 100) / 100`, probabilities are probabilities (not percentages),
  and the UI decides display precision.
- Commit messages: a single imperative summary line, then a body that states
  the **measured** problem and the **measured** fix, then a `Verified:` line
  naming the exact checks that ran. See `git log` for the house style.

### Backend (Python)

- `from __future__ import annotations` at the top of every module.
- Module-level docstring explaining the module's role; private helpers prefixed
  `_`; public functions in `db.py` are the only place that touches SQLAlchemy.
- Type hints on signatures, `Optional[...]`/`Dict[...]` style (not `|`), no
  strict mypy gate.
- Pydantic `BaseModel` for request bodies, plain dicts for responses
  (serializers in `db.py` own the camelCase wire shape).
- **Every table and query is scoped by `visitor_id`.** New endpoints must take
  `x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")`
  and pass it through `visitor_of()`. Never add a cross-visitor query.
- House edge is a setting (`db.get_settings(visitor)["houseEdge"]`, default
  0.04 in most call sites, 3% presets available). Never hardcode it in new
  math; read it from settings.
- SQLite specifics are load-bearing: WAL + `synchronous=NORMAL`, one process
  owning the file, `sqlite_autoincrement` on the ledger. Schema changes to an
  existing table must be added to `db._migrate()`.
- The API is synchronous `def` handlers on purpose — the analytics kernel is
  CPU-bound NumPy work. Do not "fix" it to `async def`; block the event loop
  and the websocket feed dies (this exact bug is in the git history).

### Frontend (TypeScript/React)

- Function components, `export default` for pages, named exports for
  components and libs. Props typed inline or with a local `interface`.
- Import alias `@/` → `frontend/`. Always use it across directories.
- Class names via `cn()` from `@/lib/utils` (clsx + tailwind-merge). Style with
  the semantic tokens (`bg-card`, `text-accent`, `border-border`,
  `text-muted-foreground`) or the `.panel` utility class, never raw hex or
  `slate-*`. There is no `bg-panel` class — see `docs/ai/frontend.md` §3.
- Data fetching: `@tanstack/react-query` with the shared `QueryClient`
  (`staleTime: 15_000`, no refetch-on-focus). Live data arrives through
  `openRoundSocket`; do not poll in a `setInterval` where the store already
  pushes.
- Forms: `react-hook-form` + `@hookform/resolvers` + `zod`. Toasts: `sonner`.
  Icons: `lucide-react`. Charts: `recharts` via `components/charts.tsx`.
- **Never introduce `localStorage`, `sessionStorage`, `document.cookie` or any
  other origin-scoped storage.** The app runs in a sandboxed frame where those
  throw, and a self-scored prediction ledger must not be editable by the
  scoree. State belongs in `lib/store.ts` (backend-backed) or component state.
- There is a deliberate mirrored maths layer in `frontend/lib/` (`stats.ts`,
  `pipeline.ts`, `verifyForecast.ts`, `backtest.ts`) that duplicates backend
  formulas for offline/live display. If you change a formula on one side,
  change it on the other and update `frontend/test/hiteta.test.ts`.
- `frontend/lib/source-archive.json` is generated by
  `scripts/package-source.sh`; it is intentionally part of the source it
  describes. Do not hand-edit.

---

## 5. Definition of done

1. Backend change → `cd backend && python3 -m pytest tests -q` passes and you
   added or updated a test for the new behaviour.
2. Frontend change → `npx tsc -p tsconfig.app.json --noEmit` is clean,
   `npx vitest run` has no *new* failures, and `npm run build` succeeds.
3. Formula changed → the pinned identities in `backend/tests/test_reality_checks.py`
   still hold and the mirrored TS implementation was updated in the same change.
4. Copy changed → it still says what the mathematics says. No implied edge.
5. Report exactly which checks you ran and their output. Never claim a check
   passed that you did not execute.

---

## 6. Known broken / fragile (do not "fix" silently)

- **`npm run lint` and `npm test` are currently broken** for reasons unrelated
  to application code: `eslint.config.js` (ESLint 9 flat config) and
  `vitest.config.ts` / `vitest.browser.config.ts` (referenced by `package.json`)
  do not exist in the repository. Use `npx tsc --noEmit` and `npx vitest run`
  until they are restored, and say so in your report rather than pretending the
  script passed.
- `frontend/test/example.test.ts` fails with `describe is not defined` because
  no vitest config sets `globals: true`. Two of three test files are affected.
- `frontend/test/calendar.browser.test.tsx` needs Playwright browsers
  (`npx playwright install chromium`) which are not present on a fresh machine,
  plus the missing `vitest.browser.config.ts`. It cannot run today.
- **`npm run build` can stop at `package-source.sh: line 27: zip: command not
  found`** when the `zip` binary is absent (some Debian images ship `unzip`
  only). The `&&` then short-circuits and `vite build` never runs, which reads
  as a build failure but is a missing OS package. Verify the bundle with
  `npx vite build` and say which of the two you ran.
- `tsconfig` has `strict: false`, `noUnusedLocals: false`, `noImplicitAny:
  false`. That is deliberate — this codebase was written against it. Do not
  turn strictness on as a drive-by.
- **`.gitignore` ignores `.vscode/*`, not `.vscode/`** — a trailing-slash
  directory pattern cannot be re-included by a `!` rule, so the shared files
  negated at the bottom of that file are only actually tracked because the
  pattern is a glob. `venv/` and `.venv/` are ignored; the canonical backend
  interpreter is `backend/.venv`.
- `seed/` (prior-data SQLite corpora) is gitignored user data. Never commit it,
  never re-derive shipped numbers from it without saying so.

---

## 7. Where to look

| Question | File |
| --- | --- |
| How do the pieces fit together? | [`docs/ai/architecture.md`](docs/ai/architecture.md) |
| What does the maths actually compute, and why? | [`docs/ai/domain-math.md`](docs/ai/domain-math.md) |
| Which route, which table, which field? | [`docs/ai/data-model.md`](docs/ai/data-model.md) |
| Backend module/function reference | [`docs/ai/backend.md`](docs/ai/backend.md) |
| Frontend routes, components, design system | [`docs/ai/frontend.md`](docs/ai/frontend.md) |
| Coding rules in detail | [`docs/ai/conventions.md`](docs/ai/conventions.md) |
| How to run and write tests | [`docs/ai/testing.md`](docs/ai/testing.md) |
| Vocabulary | [`docs/ai/glossary.md`](docs/ai/glossary.md) |
| Day-two operations, debugging, gotchas | [`docs/ai/runbook.md`](docs/ai/runbook.md) |

Skills worth invoking instead of improvising:

| Situation | Skill |
| --- | --- |
| Orient in the repo before a change | `/repo-orientation` |
| Add or change a FastAPI route | `/add-backend-route` |
| Add or change a page/panel | `/add-frontend-page` |
| Touch any formula, estimator or scoring rule | `/math-change-guard` |
| Prove an operator's round was dealt as committed | `/verify-provably-fair` |
| Import a tape from a SQLite dump | `/ingest-tape` |
| Write the tests and prove the change | `/verify-change` |
| Write copy that describes model quality | `/copy-integrity-audit` |
| Refresh these docs after a structural change | `/update-ai-knowledge` |

Custom agents (VS Code `Agent` dropdown, and `.devin/agents/` for Devin CLI) are
listed in [`docs/ai/agents.md`](docs/ai/agents.md).
