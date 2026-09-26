# Conventions — the long form

`AGENTS.md` §4 is the short version that is always in context. This page is the
reasoning behind it. `.github/instructions/*.instructions.md` are the path-scoped
variants; `.devin/rules/*.md` mirror them for Devin CLI. When they disagree with
this page, the code wins and the disagreement is a bug.

## 0. The rule that outranks every other rule here

Momento measures a game whose expected value is `-h` per unit staked, for every
cash-out target, by construction. Therefore:

- No feature, default, preset, label or string may imply the software can predict
  the next round, time an entry, or beat the house edge.
- Every model figure is shown with its own measured quality — Brier skill, log
  loss, reliability, sample size, interval.
- A strategy comparison reports turnover, because `expected cost = turnover × h`
  is the entire economics. A backtest that shows profit without turnover is
  broken, not lucky.
- Negative results are the product. `skill ≤ 0` on an independent tape is
  correct and is reported as correct.

Everything below is subordinate to that.

## 1. Comment density

This codebase deliberately carries **dense comments that justify a decision**, and
almost none that narrate a line. The comments exist because of real incidents:
why WAL, why `sqlite_autoincrement`, why no `localStorage`, why a sample was
rejected, why the walk-forward rebuild happens, why the tail estimate is clamped.

- Do not strip an existing decision comment, even if it looks verbose.
- Add one when you make a non-obvious call — a clamp, a fallback, a magic
  threshold, a deliberate `sync def`.
- Do not add `# increment i by one`.

## 2. Diff hygiene

- Minimal, scoped diffs. Never reformat an unrelated block, never re-order
  imports repo-wide, never run a formatter over a file you only changed one line
  in. There is no committed Prettier/Black config; the house style *is* the
  surrounding code.
- `tsconfig` has `strict: false`, `noUnusedLocals: false`, `noImplicitAny:
  false` by choice. Do not flip strictness as a drive-by.
- No new dependency without a stated reason. Backend is stdlib + numpy / scipy /
  sklearn / sqlalchemy / fastapi; frontend is React + Tailwind + Radix + recharts
  + react-query + zod + sonner.

## 3. Python

- `from __future__ import annotations` first line of every module (after the
  docstring).
- A module docstring saying what the module is *for*, not what it contains.
- Private helpers are `_prefixed`. `db.py` is the only module that touches
  SQLAlchemy; routes call its helpers.
- Type hints on signatures, `Optional[...]` / `Dict[...]` / `List[...]` style
  (not `X | None`). There is no mypy gate.
- Pydantic `BaseModel` for request bodies. Responses are plain dicts shaped by
  the serializers in `db.py`, which own the camelCase wire names.
- Everything is visitor-scoped:

  ```python
  def route(..., x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")):
      visitor = visitor_of(x_visitor_id)
  ```

  `visitor_id` comes from the header, never from a body. A missing filter is a
  full tenant-isolation break.
- Handlers are synchronous `def`. FastAPI runs them in a threadpool; `async def`
  on CPU-bound NumPy work blocks the event loop and starves `/ws/rounds` for
  every visitor. That outage is in the git history.
- The house edge is a setting: `db.get_settings(visitor)["houseEdge"]`. There is
  a module-level default in `ev.py`/`windows.py`/`survival.py` for standalone
  use — do not add another literal in a route.
- SQLite specifics are load-bearing: WAL + `synchronous=NORMAL`, one process
  owning the file, `sqlite_autoincrement` on the ledger. Additive schema changes
  go in `db._migrate()`; `create_all()` cannot alter an existing table.
- Rounding is correctness: multipliers are `math.floor(x * 100) / 100`,
  probabilities are probabilities (0–1), and display precision is the UI's job.

## 4. TypeScript / React

- Function components. `export default` for pages, named exports for components
  and lib modules. Props typed inline or with a local `interface`.
- `@/` → `frontend/`. Always use the alias across directories.
- Class names via `cn()` from `@/lib/utils` (clsx + tailwind-merge), using the
  semantic tokens (`bg-card`, `text-accent`, `border-border`,
  `text-muted-foreground`) and the `.panel` utility class. No raw hex, no
  `slate-*`, no second palette. There is no `bg-panel` class.
- Reuse `components/kit.tsx` primitives before writing a one-off panel.
- Data: `@tanstack/react-query` with the shared client (`staleTime: 15_000`, no
  refetch-on-focus). Live data arrives through `openRoundSocket` — do not add a
  second socket or a `setInterval` poll where the store already pushes.
- Forms: `react-hook-form` + `@hookform/resolvers` + `zod`. Toasts: `sonner`.
  Icons: `lucide-react`. Charts: `recharts` through `components/charts.tsx`.
- **No origin-scoped storage.** No `localStorage`, `sessionStorage`,
  `document.cookie`, no IndexedDB. The app runs in a sandboxed frame where they
  throw, and a self-scored prediction ledger must not be editable by the scoree.
  State lives in `lib/store.ts` (backend-backed) or component state.
- `lib/api.ts` is the only fetch layer. `frontend/lib/source-archive.json` is
  generated by `scripts/package-source.sh` — never hand-edit it.
- `__PORT_8000__` is a build-time placeholder substituted by the hosting
  environment; the literal string is what makes the local dev fallback work.

## 5. Mirrored mathematics

`frontend/lib/stats.ts`, `pipeline.ts`, `verifyForecast.ts`, `backtest.ts` and
`ledger.ts` intentionally duplicate backend formulas so the UI can compute
offline and live. The same input must produce the same number on both sides; a
divergence means the UI lies about the backend, which is worse than not showing
the figure.

Rule: change both sides in one commit, and update
`frontend/test/hiteta.test.ts` if a pinned value moved. See
[`domain-math.md`](domain-math.md) for which module mirrors which.

## 6. Commits

The house style, visible in `git log`:

```
<imperative summary line>

Problem: what was measurably wrong (with the measurement).
Fix: what changed, and why that is the right fix.

Verified: <exact commands and their summary lines>
```

A body that states a *measured* problem and a *measured* fix, and a `Verified:`
line naming the checks that actually ran. Never write `Verified:` for a command
you did not run — that rule is the reason this repository's history is usable as
evidence at all.

## 7. Definition of done

From `AGENTS.md` §5: backend change → pytest green plus a test for the new
behaviour; frontend change → `tsc --noEmit` clean, `npx vitest run` with no *new*
failures, `npm run build` succeeding; formula change → the pinned identities in
`backend/tests/test_reality_checks.py` still hold and the mirrored TS moved in the
same change; copy change → it still says what the mathematics says. Report exactly
which checks you ran.

## 8. Documentation

Docs live in five places and they are not interchangeable; the ownership table is
in `.github/agents/technical-writer.agent.md`. The maintenance contract is
[`README.md`](README.md) in this directory. A structural change that this base
does not describe must update it **in the same change**.

## 9. Committing and secrets

Never commit `dist/`, `*.db*`, `node_modules/`, `seed/`, `watcher_seen.json`,
`.env*`, or `.devin/config.local.json`. `.vscode/` is gitignored except the files
negated at the bottom of `.gitignore` — if you add a shared VS Code file, negate
it there too. `seed/` is prior-data corpora: user data, and never the source of a
number you do not disclose.
