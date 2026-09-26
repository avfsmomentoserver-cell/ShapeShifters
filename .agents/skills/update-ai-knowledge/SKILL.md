---
name: update-ai-knowledge
description: Refresh the AI knowledge base (docs/ai/, AGENTS.md, skills, agents) after a structural change — new module, route, page, table, formula or convention. Use whenever you learn something the base does not already say.
allowed-tools:
  - read
  - edit
  - grep
  - glob
  - exec
---

# Update the AI knowledge base

`docs/ai/` is how the next agent avoids re-deriving this repository. It is only
worth having if it is current. **The maintenance contract is: if a change taught
you something the base does not say, update the base in the same change.**

## What changed → what to edit

| Change | Edit |
| --- | --- |
| New/changed module, or the shape of the system | `docs/ai/architecture.md` |
| New/changed formula, estimator, default edge, threshold, scoring rule | `docs/ai/domain-math.md` |
| New/changed table, column, index, migration, route family, wire field | `docs/ai/data-model.md` |
| New backend module, helper or kernel entry point | `docs/ai/backend.md` |
| New route, page, component, design token, API function | `docs/ai/frontend.md` |
| A rule that is new, or one that turned out to be wrong | `docs/ai/conventions.md` **and** `AGENTS.md` |
| New test file, fixture, or command that changed | `docs/ai/testing.md` |
| A new footgun, or one that was fixed/removed | `docs/ai/runbook.md` |
| A new term, abbreviation or UI concept | `docs/ai/glossary.md` |
| A new skill or agent, or a changed roster/handoff | `docs/ai/agents.md` |

## How to write it

- **Terse and factual.** Bullets, tables, `path:line` references. No prose
  padding, no restating the code, no marketing.
- **Never invent a number, threshold or field name.** If you did not read it in
  the code, either read it now or omit the claim. A confidently wrong constant
  in the knowledge base is worse than a gap.
- **Say when something is a judgement** rather than a reading of the code, and
  say what evidence it is based on.
- **Correct, do not append.** If a page is wrong, fix the wrong line. Stale
  documentation that contradicts the code trains agents to distrust all of it.
- **Date nothing.** These pages describe the repository, not a moment.

## Keep the three layers consistent

The instructions live in three places by design, with different scopes:

1. `AGENTS.md` — always-on, cross-harness, short. Only the rules that must never
   be missed. Mirrored for Copilot in `.github/copilot-instructions.md`.
2. `.github/instructions/*.instructions.md` — path-scoped detail, auto-attached
   by glob.
3. `docs/ai/*.md` — the reference. Long-form, read on demand.

If you change a rule, check whether it appears in more than one layer and update
the others, or state explicitly that you deliberately left them alone. Do not
let them drift.

## Verification

- Every relative link you touched resolves (`docs/ai/README.md` is the index).
- The skills table in `AGENTS.md`, the roster in `docs/ai/agents.md`, and the
  actual directories `.agents/skills/`, `.github/agents/`, `.devin/agents/`
  agree with each other.
- Reported counts (route count, test count, module list) match reality at the
  commit you are on. If you cannot confirm one, remove it rather than guess.
- Nothing in the base now implies a predictive edge the maths does not support.
