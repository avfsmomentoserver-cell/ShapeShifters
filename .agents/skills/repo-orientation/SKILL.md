---
name: repo-orientation
description: Orient in the Momento repository before making a change — read the AI knowledge base, confirm the running state of both processes, and locate the exact files a task will touch. Use at the start of any task in this repo, or when you feel lost.
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Orient in Momento

Do this **before** grepping the tree or opening files at random. The knowledge
base exists so you do not have to reconstruct the architecture.

## 1. Read the rules (always)

1. `AGENTS.md` at the repo root — always-on rules, the overriding
   "no implied predictive edge" constraint, commands, and the list of things
   that are already broken.
2. `docs/ai/README.md` — the index, and the maintenance contract.

## 2. Read the one page your task needs

| Task | Page |
| --- | --- |
| Anything structural | `docs/ai/architecture.md` |
| A formula, estimator, or score | `docs/ai/domain-math.md` |
| A table, column, or endpoint | `docs/ai/data-model.md` |
| Python | `docs/ai/backend.md` |
| React/TS | `docs/ai/frontend.md` |
| Tests | `docs/ai/testing.md` |
| Debugging something | `docs/ai/runbook.md` |

## 3. Establish ground truth

```bash
git log --oneline -10          # what changed recently, in the house style
git status --short             # uncommitted work you must not clobber
git branch --show-current
```

Then check what actually runs, rather than assuming:

```bash
cd backend && python3 -m pytest tests -q        # expect 176 passed
npx vitest run                                  # expect 20 tests pass, 2 file-level failures (pre-existing)
npx tsc -p tsconfig.app.json --noEmit            # expect clean
```

Two processes are required for the app to work at all: the FastAPI backend
(`:8000`) and the Vite dev server (`:5173`). A frontend that shows zeros and a
"closed" socket almost always means the backend is not running — check that
before reading frontend code.

```bash
curl -s localhost:8000/api/health
curl -s localhost:8000/api/rounds?limit=3
```

## 4. Narrow the search

- Backend HTTP surface: `backend/momento/api.py` (~73 routes on an `APIRouter`
  with prefix `/api`). Search for `@api.get` / `@api.post`, not for `@app.` —
  only the websocket and `/` are on `app`.
- Persistence: `backend/momento/db.py` only.
- Analytics: one module per concern (`fairness`, `randomness`, `survival`, `ev`,
  `math_models`, `pipeline`, `strategies`, `windows`).
- Frontend routes: `frontend/App.tsx`. Nav: `frontend/components/AppShell.tsx`.
  Design primitives: `frontend/components/kit.tsx`. Transport: `frontend/lib/api.ts`.
  Live state: `frontend/lib/store.ts`.

`rg` is not available in this environment; use the editor's Grep/Glob tools.

## 5. Report the orientation back

State, in two or three lines: which files the task will touch, which checks
currently pass, and which known-broken item is relevant. If the task would
violate the overriding rule (implying the software can predict a round), say so
before writing any code.
