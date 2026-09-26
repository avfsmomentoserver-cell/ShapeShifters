# Copilot instructions — Momento

The canonical, cross-agent rule set is [`AGENTS.md`](../AGENTS.md) at the repository
root. **Read it before acting.** This file adds only the Copilot-specific
pointers and the short version, so both harnesses stay consistent.

---

## Short version

Momento is a crash-curve analytics terminal: FastAPI + SQLAlchemy + SQLite on
the back, React 19 + Vite + Tailwind on the front. It verifies provably-fair
rounds, tests a tape for independence, calibrates survival probabilities,
scores its own forecasts honestly, and computes the real expected value of
every bet.

> **Overriding rule:** a correctly implemented crash game is unpredictable and
> every stake carries negative expected value. Never add code, defaults, labels
> or copy that implies the software can predict the next round or beat the
> house edge. Honest negative results are the product.

## Non-negotiables

1. **No browser storage.** No `localStorage` / `sessionStorage` / cookies
   anywhere in `frontend/`. The app runs in a sandboxed frame where they throw,
   and a self-scored ledger must not be editable by the scoree. Use
   `frontend/lib/store.ts` (backend-backed).
2. **Visitor scoping.** Every backend table and every new endpoint is scoped by
   `visitor_id` via the `X-Visitor-Id` header and `visitor_of()`. No
   cross-visitor queries.
3. **Read the house edge from settings.** `db.get_settings(visitor)["houseEdge"]`.
   Never hardcode it in new maths.
4. **Keep API handlers synchronous.** The analytics kernel is CPU-bound NumPy
   work; making handlers `async def` blocks the event loop and starves the
   `/ws/rounds` feed. That bug is in the git history — do not reintroduce it.
5. **Mirrored maths.** `frontend/lib/{stats,pipeline,verifyForecast,backtest}.ts`
   duplicate backend formulas on purpose. Change both sides in one commit.
6. **Schema changes go in `db._migrate()`.** `create_all()` is invisible to
   changes on an existing table.
7. **Minimal diffs.** Match the surrounding comment density (this codebase
   justifies decisions in comments; do not narrate the obvious, do not delete
   the existing justifications).
8. **Report the checks you ran.** Never claim a command passed if you did not
   run it.

## Commands

```bash
cd backend && python3 -m pytest tests -q          # 176 tests, ~17 s, run from backend/
npm run dev                                        # frontend on :5173
npx tsc -p tsconfig.app.json --noEmit              # typecheck (strict is off by design)
npx vitest run                                     # see caveat below
npm run build                                      # packages source zip, then vite build
```

`npm run lint` and `npm test` are **currently broken** — `eslint.config.js`,
`vitest.config.ts` and `vitest.browser.config.ts` are missing from the repo.
Use `tsc` and `npx vitest run`, and say so in your report.

## Scoped instructions

Path-specific rules live in `.github/instructions/` and load automatically:

| File | Applies to |
| --- | --- |
| `backend-python.instructions.md` | `backend/**` |
| `frontend-react.instructions.md` | `frontend/**` |
| `math-and-stats.instructions.md` | the analytics kernel and mirrored TS maths |
| `tests.instructions.md` | `backend/tests/**`, `frontend/test/**` |

## Skills and agents

Reusable workflows live in `.agents/skills/` (open standard, shared with Devin
CLI): `/repo-orientation`, `/add-backend-route`, `/add-frontend-page`,
`/math-change-guard`, `/verify-provably-fair`, `/ingest-tape`, `/verify-change`,
`/copy-integrity-audit`, `/update-ai-knowledge`.

Role agents live in `.github/agents/*.agent.md` and appear in the Agent
dropdown. The roster and handoff graph are documented in `docs/ai/agents.md`.

## Knowledge base

`docs/ai/` holds the architecture, domain maths, data model, backend and
frontend references, conventions, testing guide, glossary and runbook. Start at
`docs/ai/README.md`. Prefer reading those pages over grepping the tree; if you
learn something structural that they do not say, update them in the same change.
