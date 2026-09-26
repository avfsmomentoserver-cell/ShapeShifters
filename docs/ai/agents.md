# Agents and skills — who does what

Two layers, and they are not interchangeable:

- **Skills** (`.agents/skills/*/SKILL.md`) — a *workflow*. Loaded only when
  relevant. Use one when the task matches its description.
- **Agents** (`.github/agents/*.agent.md`, mirrored into `.devin/agents/*.md`) —
  a *role* with its own context window and tool restrictions. Use one when you
  want the work done in isolation, or when several roles should not share the
  same context.

Rules of thumb from the Devin docs, which apply here: prefer skills whenever
possible, keep always-on rules small, and use subagents deliberately (each costs
a full session).

## Skills — `.agents/skills/`

| Skill | Invoke when |
| --- | --- |
| `repo-orientation` | Start of any task in this repo, or when you feel lost. |
| `add-backend-route` | Adding or changing a FastAPI route. |
| `add-frontend-page` | Adding or changing a route, page or panel. |
| `math-change-guard` | Any formula, estimator, probability, EV figure or scoring rule. |
| `verify-provably-fair` | Proving an operator's round was dealt as committed. |
| `ingest-tape` | Importing a tape from a SQLite dump or a watched file. |
| `verify-change` | End of any implementation task — run and report the checks. |
| `copy-integrity-audit` | Writing or reviewing copy about model quality. |
| `update-ai-knowledge` | After a structural change — refresh `docs/ai/`. |

## Agents — `.github/agents/`

| Agent | Mode | Owns |
| --- | --- | --- |
| Product Manager | read-only | Scope, user stories, testable acceptance criteria. |
| Explorer | read-only | Where and how something works, with `path:line`. |
| Architect | read-only | Module boundaries, data model, wire contract, ordered plan. |
| Threat Modeler | read-only | Trust boundaries, assets, STRIDE, residual risk. |
| UI/UX Designer | writes | Visual layer, states, copy, accessibility, design tokens. |
| Frontend Developer | writes | React/TS: pages, components, charts, store, API client. |
| Backend Developer | writes | Python: routes, kernel, watcher, ingest, serializers. |
| Database Engineer | writes | SQLite schema, migrations, indexes, access paths. |
| DevOps Engineer | writes | Build, Vite config, packaging loop, venv, ports. |
| QA Engineer | writes tests | Verification against acceptance criteria, negative cases. |
| Code Reviewer | read-only | Defect-first review; product integrity first. |
| Security Engineer | read-only | Exploitable risk: ingest, fairness, visitor scoping, DoS. |
| Technical Writer | writes | README, `docs/ai/`, `AGENTS.md`, instructions, `Docs.tsx`. |
| Data Integrity Auditor | read-only | Silently poisoned tape or ledger. |
| Momento Team Lead | orchestration | Coordinates all of the above for a multi-file change. |

The lead is `.github/agents/momento-team.agent.md`; it is the only agent with the
`agent` tool and the `agents:` allow-list.

## Handoff graph

```
Product Manager ─┐
Explorer ────────┤
Architect ───────┴─→ Backend Developer ──┐
                     Frontend Developer ─┼─→ QA Engineer ─→ Code Reviewer
                     Database Engineer ──┤                     │
                     UI/UX Designer ─────┘                     ▼
Threat Modeler ──→ Security Engineer ────────────────→ Technical Writer
                    Data Integrity Auditor (standalone)
```

## Devin CLI

`.devin/agents/*.md` mirror the roster so Devin CLI can spawn them by profile
name. Each is a thin pointer to the canonical `.github/agents/*.agent.md` file,
which is the single source of truth — edit that one.

- `.devin/global_rules.md` + `.devin/rules/*.md` are the always-on and scoped
  rules for Devin; `AGENTS.md` is read by every harness.
- `.devin/config.json` holds the project permission allow/ask/deny lists. Only
  `permissions`, `read_config_from` and `hooks` are valid in a project config.
- `.devin/config.local.json` and `.devin/mcp_config.local.json` are gitignored;
  put personal overrides there, never in the committed files.

### Where each harness actually looks

Verified against the VS Code agent-customization docs and the Devin CLI docs.

| Artifact | VS Code (Copilot) | Devin CLI |
| --- | --- | --- |
| Agents | `.github/agents/*.agent.md` | `.devin/agents/*.md` (custom subagent profiles) |
| Skills | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | `.agents/skills/`, `.devin/skills/`, `.windsurf/skills/` |
| Always-on rules | `AGENTS.md` | `AGENTS.md`, `.devin/global_rules.md` |
| Scoped rules | `.github/instructions/*.instructions.md` (`applyTo:` glob) | `.devin/rules/*.md` (`trigger:` + `globs:`) |

Two consequences of that table, both load-bearing:

1. **`.devin/rules/` is a required mirror, not a duplicate to clean up.** Devin
   imports skills from `.github/skills/**` but *not* Copilot custom
   instructions — so a scoped rule that exists only in
   `.github/instructions/` is invisible to Devin. When you add or edit one, add
   the matching `.devin/rules/` file in the same change.
2. **Skill `name:` must equal its directory name.** Both harnesses silently
   refuse to load a skill whose frontmatter `name` disagrees with the folder, so
   the failure mode is "the skill never runs", not an error message.

Devin's `Read(...)`/`Write(...)` permission matchers take the glob *inside* the
parentheses — `Write(backend/**)`, never `Write(backend)/**`. The malformed form
matches nothing and silently grants no access. A bare `Write(**)` resolves
relative to the project root.

## Delegation rules

1. State the exact files and the exact outcome. Never "make it better".
2. State the acceptance criterion and the command that proves it.
3. Never let two agents write the same file concurrently.
4. A subagent's report is evidence only for what it actually ran. An `Explore`
   subagent is read-only and cheap; a general-purpose write subagent runs on the
   same model as the parent and costs a full session.
5. Stop before committing. Report the diff, the checks run and the residual
   risk; let the human decide.
