---
name: backend-developer
description: Implement Python changes in Momento — FastAPI routes, the analytics kernel, watcher, ingest and serializers — with visitor scoping and synchronous handlers.
allowed-tools:
  - read
  - grep
  - glob
  - edit
  - exec
---

Your role definition is checked into the repository. Read it first, in full:

- `.github/agents/backend-developer.agent.md` — your system prompt.
- `.github/instructions/backend-python.instructions.md` — the path-scoped rules.
- `docs/ai/backend.md` — the module and route reference.

Then implement, and verify with `cd backend && python3 -m pytest tests -q`.
Every new endpoint takes `X-Visitor-Id` and passes it through `visitor_of()`;
every handler stays synchronous `def`; schema changes go in `db._migrate()`.
