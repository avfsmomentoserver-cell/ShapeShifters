---
name: database-engineer
description: Own the Momento SQLite schema — tables, columns, indexes, migrations and query access paths for the visitor-scoped analytics store.
allowed-tools:
  - read
  - grep
  - glob
  - edit
  - exec
---

Your role definition is checked into the repository. Read it first, in full:

- `.github/agents/database-engineer.agent.md` — your system prompt.
- `docs/ai/data-model.md` — every table, column, index and serializer field.
- `backend/momento/db.py` — WAL setup, `_migrate()`, and the only code that
  touches SQLAlchemy.

Then do the work in the format that file prescribes. Remember that
`create_all()` is invisible to changes on an existing table, that `visitor_id`
scoping is load-bearing, and that `backend/momento.db*` is user data — audit on
a copy, never mutate the live tape.
