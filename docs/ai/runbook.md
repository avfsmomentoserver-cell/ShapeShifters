# Runbook — running, debugging, and what is already broken

Commands are also in `AGENTS.md` §3 and in `.vscode/tasks.json` (VS Code
`Ctrl+Shift+B`). Everything below was run on this repository; where a number is
quoted it is the observed output.

## Running it

Two processes; the frontend is a static bundle and every figure comes from the
API, so both must be up.

```bash
# terminal 1 — backend
cd backend
python3 -m venv .venv && source .venv/bin/activate   # canonical path — .vscode pins it
pip install -r requirements.txt
python -m uvicorn momento.api:app --host 0.0.0.0 --port 8000

# terminal 2 — frontend
npm install
npm run dev            # http://localhost:5173
```

- **`backend/.venv` is the canonical interpreter.** `.vscode/settings.json`
  (`python.defaultInterpreterPath`) and `.vscode/launch.json` both point at
  `${workspaceFolder}/backend/.venv/bin/python`, and `venv/`/`.venv/` are
  gitignored. A legacy `backend/venv` may exist; it is not what the debug config
  uses. The system `python3` also has the deps on this machine, which is why
  `python3 -m pytest` works without activating anything.
- API docs: `http://localhost:8000/docs`.
- Accessibility concerns: none; this is a local-first analytics terminal.
- **No proxy.** `npm run dev` calls `http://localhost:8000` directly. There is no
  Vite `server.proxy` block, and `base: "./"` means the bundle also works from a
  subpath.

## State, and how to reset it

| Thing | Where | Notes |
| --- | --- | --- |
| The tape | `backend/momento.db` (override with `MOMENTO_DB`) | SQLite, WAL. |
| Watcher dedupe cache | `watcher_seen.json`, beside the DB | Gitignored. Deleting it makes the watcher re-ingest the watch directory. |
| Demo tape | seeded into the DB on first visit per visitor | `seed.py`; a per-visitor lock prevents the duplicate-seed race. |
| Prior-data corpora | `seed/` | Gitignored user data. Never re-derive shipped numbers from it silently. |

**Full reset:** stop the backend, delete `backend/momento.db*` and, if you want
the watcher to re-read its directory, `watcher_seen.json`. Restart; the demo tape
reseeds on the next request.

**Never** point a mutation at the live DB while auditing. `MOMENTO_DB=/tmp/audit.db`
plus a copy of the file is the pattern.

## The `~/Downloads` watcher

Started by the FastAPI lifespan. Anything dropped into `~/Downloads` is parsed
and ingested, and the `(path, size, mtime)` triple is recorded in
`watcher_seen.json` **after** a successful ingest. Two consequences worth
remembering:

- Deleting `watcher_seen.json` re-ingests the whole directory → a duplicated
  tape → the independence battery correctly rejects it.
- The seen-cache used to be in-memory, so every restart duplicated the tape.
  That is fixed; do not regress it.

## Testing

```bash
cd backend && python3 -m pytest tests -q      # observed: 176 passed in ~17s
npx tsc -p tsconfig.app.json --noEmit          # typecheck; strict is off by design
npx vitest run                                 # observed: 20 passed, 2 failing FILES
npm run build                                  # packages the source zip, then vite build
```

Run pytest from `backend/`. Imports are `from momento import …` and there is no
`conftest.py` or `pytest.ini` to fix the path for you.

Full guide: [`testing.md`](testing.md).

## Known broken — do not mis-report these

| Symptom | Cause | Verdict |
| --- | --- | --- |
| `npm run lint` prints an ESLint 9 flat-config migration error | `eslint.config.js` does not exist in the repo | pre-existing, unrelated to application code |
| `npm test` fails | it chains `vitest run` with a `vitest.browser.config.ts` that does not exist | pre-existing |
| `frontend/test/example.test.ts`: `ReferenceError: describe is not defined` | no vitest config sets `globals: true` | pre-existing |
| `frontend/test/calendar.browser.test.tsx` fails on `vitest/browser/context.js` | needs the missing browser config **and** Playwright browsers (`npx playwright install chromium`) | pre-existing + environment |
| `npm run build` stops at `package-source.sh: line 27: zip: command not found` and **never reaches `vite build`** | the `zip` binary is absent from this image (only `unzip` is present) | environment |

`npm run build` runs `bash scripts/package-source.sh && vite build`; with no
`zip` the `&&` short-circuits and the bundle is never produced, which looks like
a build failure but is a missing OS package. To check the actual bundle on such
a machine, run `npx vite build` directly (verified working: 1861 modules, ~710 kB
JS, ~72 kB CSS). To make `npm run build` work end to end, install `zip` (or
replace the two `zip`/`unzip` calls in the script with `python3 -m zipfile`).

Observed run, for the record:

```
Test Files  2 failed | 1 passed (3)
     Tests  20 passed (20)
```

Fixing these is welcome and is owned by the DevOps Engineer. **Never** report
`npm test` or `npm run lint` as passing, and never use this table to explain away
a real failure — check which one you are looking at.

## Footguns

- **`npm run build` mutates the working tree.** It runs
  `scripts/package-source.sh` first, which re-packs `public/momento-source.zip`
  and rewrites `frontend/lib/source-archive.json` in a fixed-point loop (up to
  four passes) until size and file count stop changing. `source-archive.json` is
  generated — never hand-edit it, and expect `git status` to be noisy after a
  build.
- **Making a handler `async def` starves the websocket.** The kernel is
  CPU-bound NumPy work; a synchronous `def` handler runs in the threadpool, an
  `async def` handler blocks the event loop and `/ws/rounds` dies for every
  visitor. That outage is in the git history.
- **`create_all()` does not alter an existing table.** Additive schema changes
  go in `db._migrate()`.
- **A forecast is locked before it resolves.** Two writes, two timestamps. If a
  stored distribution no longer matches its stored band, something mutated a
  locked row — that is a ledger-integrity bug, not cosmetic.
- **A failing randomness battery is usually a settings problem.** A tape recorded
  at a different house edge to the one in `/api/settings` will fail chi-square
  and KS correctly but unhelpfully. Check the edge first; then the sample size.
  Conditioning on a subset or a sliding window can fail on a fair tape for
  ordinary statistical reasons.
- **The demo tape is not independent of itself.** Duplicated rounds are the
  classic self-inflicted failure here — see the triple-seed race and the
  in-memory seen-cache above.
- **Simulator output can contaminate a real tape.** Check the round `source`
  before quoting any statistic; `POST /api/rounds/purge-simulator` exists.
- **`tsconfig` strictness is deliberately off** (`strict: false`,
  `noUnusedLocals: false`, `noImplicitAny: false`). Do not turn it on as a
  drive-by.
- **`__PORT_8000__` is a build-time placeholder**, substituted by the hosting
  environment. The literal string is what makes the local dev fallback work. Do
  not "clean it up".
- **`.vscode/` is gitignored via `.vscode/*`, not `.vscode/`.** A trailing-slash
  pattern excludes the directory itself, and git will not re-include a file whose
  parent directory is excluded — so the `!` negations at the bottom of
  `.gitignore` silently did nothing and **none** of the shared VS Code config was
  ever tracked, despite this file and `AGENTS.md` claiming it was. The glob form
  excludes the contents and lets the negations work. If you add a shared VS Code
  file, negate it there and check with `git check-ignore -v <path>`.
- **`backend/.venv` is the canonical interpreter, and it is gitignored.** It did
  not exist on this machine even though `.vscode/settings.json` and
  `launch.json` both point at it — so F5 and the Python test explorer failed to
  resolve an interpreter even though `python3` on the system had the deps. Create
  it with `python3 -m venv .venv && .venv/bin/python -m pip install -r
  requirements.txt`. `venv/`/`.venv/` are ignored by `.gitignore`.

## Debugging the numbers

Order of checks when a published statistic looks wrong:

1. `/api/settings` — is the house edge the one the tape was dealt at?
2. `/api/rounds` — row count, timestamps monotonic, duplicated
   `(multiplier, timestamp)` pairs.
3. `/api/randomness` — the battery. A single failing test on a large sample is
   weak evidence; a consistently failing one is a finding.
4. The closed forms, by hand: `P(reach m) = (1-h)/m`, `EV/unit = -h`,
   `median = 2(1-h)`, Hill `≈ 1`, `E[wait to x] = x/(1-h)`.
5. Only then the code — `docs/ai/domain-math.md` names the module.

Skill: `/math-change-guard`. Agent: Data Integrity Auditor.

## Agent tooling

| Tool | Config | Notes |
| --- | --- | --- |
| Devin CLI | `.devin/config.json`, `.devin/global_rules.md`, `.devin/rules/`, `.devin/agents/` | Project configs accept only `permissions`, `read_config_from`, `hooks`. Personal overrides go in `.devin/config.local.json` (gitignored). |
| VS Code / Copilot | `.vscode/settings.json`, `.vscode/tasks.json`, `.vscode/launch.json`, `.vscode/extensions.json` | `AGENTS.md` at the root is read by Copilot; `.github/instructions/*` load for their `applyTo` globs. |
| Skills | `.agents/skills/` | Open standard ([agentskills.io](https://agentskills.io)), shared by both. VS Code discovers project skills from `.github/skills/`, `.claude/skills/` and `.agents/skills/` with **no setting required** — `chat.agentSkillsLocations` is deprecated, and `chat.promptFilesLocations` is for prompt files (`.github/prompts`), not skills. Devin reads `.agents/skills/`, `.devin/skills/` and `.windsurf/skills/`. A skill whose frontmatter `name:` differs from its directory name silently fails to load in both. |
| Every harness | `AGENTS.md` | Keep it short. Detail belongs in `docs/ai/`. |

Read [`agents.md`](agents.md) for the roster.

## Provisioning a fresh clone

The AI setup is committed, but two things are machine-local and must be created
once. Both have bitten this repo:

```bash
cd backend && python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
npm install
```

`.venv` is required because `.vscode/launch.json` and `settings.json` name that
exact path; without it the debugger prompts for an interpreter. `npm install` is
required because `.vscode/tasks.json` runs `npx tsc` and `npx vitest` from the
repo root.

## The Entrim AI summary

The dashboard's "overall AI summary" panel calls `GET /api/stats/ai-summary`,
which reaches the Entrim gateway **from the backend**, never from the browser.
Without configuration the route is not an error — it returns
`available: false` with a readable `reason`, and every other figure on the page
still renders.

```bash
# preferred: a real environment variable, which always wins
export ENTRIM_API_KEY=sk-…

# fallback: a repo-root .env, read once at first use, so a fresh clone works
echo 'ENTRIM_API_KEY=sk-…' >> .env
```

Optional overrides: `ENTRIM_BASE_URL` (default `https://api.entrim.ai/v1`),
`ENTRIM_MODEL` (default `deepseek-ai/DeepSeek-V4-Flash`), `ENTRIM_TTL_S`
(default 60 — how long a finished summary is reused before another call).

Two things to know when it misbehaves:

- **A summary that "looks off" may have failed the copy guard.** `_guard` scans
  the returned prose for claims the repo forbids (`FORBIDDEN_CLAIMS`,
  `ai_summary.py:65`) and the payload carries `guard.passed` plus the matching
  phrases. The panel prints them. That is the audit working, not a rendering
  bug — never suppress it.
- **`/stats/ai-status` is the cheap probe.** It reports `configured`, `model`
  and `baseUrl` and never echoes the key; use it to check whether the env var
  was picked up (a *new backend process* is needed after changing it, because
  the `.env` file is read once).

Never commit `.env` and never paste the key into a frontend file or a
`VITE_*` variable — a `VITE_` prefix would ship it to the browser.

