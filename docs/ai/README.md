# Momento — AI knowledge base

This directory is the shared memory of every AI agent working on Momento. It is
written for agents, not for end users: dense, factual, referenced, and biased
towards the things that are easy to get wrong.

**Entry point order for a new session:**

1. [`../../AGENTS.md`](../../AGENTS.md) — the always-on rules. Non-negotiable.
2. [`architecture.md`](architecture.md) — how the two processes and the modules fit together.
3. The page below for your task.
4. [`runbook.md`](runbook.md) §"Known broken" before you believe any command works.

| Page | Read it when |
| --- | --- |
| [`architecture.md`](architecture.md) | You need the big picture, the data flow, or where a new piece belongs. |
| [`domain-math.md`](domain-math.md) | You touch any formula, estimator, scoring rule or probability. |
| [`data-model.md`](data-model.md) | You need a table, a column, a route, or the wire shape. |
| [`backend.md`](backend.md) | You edit Python: routes, kernel modules, watcher, ingest. |
| [`frontend.md`](frontend.md) | You edit React: routes, components, store, charts, design system. |
| [`conventions.md`](conventions.md) | You want the long-form version of the coding rules. |
| [`testing.md`](testing.md) | You write or run tests. |
| [`glossary.md`](glossary.md) | A term in the code or UI is unfamiliar. |
| [`runbook.md`](runbook.md) | You are debugging, running locally, or wondering what is already broken. |
| [`agents.md`](agents.md) | You want to know which agent or skill to use, and which one you are. |

## Maintenance contract

**If you learn something structural the base does not say, add it in the same
change that taught you.** Specifically:

- A new module, route family, page or table → update the matching page and, if
  the shape of the system changed, `architecture.md`.
- A new rule or a rule that turned out to be wrong → `conventions.md` **and**
  `../../AGENTS.md` if it is important enough to be always-on.
- A new footgun, or one that has been fixed → `runbook.md`.
- A new non-obvious term → `glossary.md`.

Keep edits terse. Bullets beat paragraphs; a table beats bullets when the
information is tabular. Never paste large code blocks — reference `path:line`.

## Provenance and honesty

- Everything here was derived by reading the repository at the commit that
  introduced this file. Where a claim is a *judgement about behaviour* rather
  than a reading of the code, it is stated as such.
- Numbers quoted in the maths page (default house edge, tail-index clamps, the
  0.94-vs-0.485 example) come from the code and from the in-app `Docs.tsx`
  method page, which is the project's own published explanation.
- **Do not invent a number, a threshold or a field name.** If it is not in the
  code and not in this base, go read the code or say you do not know. An agent
  that confidently states a wrong constant is worse than one that asks.
- The repository's own `/docs` route (`frontend/pages/Docs.tsx`) is the
  user-facing statement of the method. When copy and this base disagree, the
  code wins, then `Docs.tsx`, then this base — and the disagreement is a bug
  worth reporting.
