---
description: 'Backend rules for the FastAPI service and analytics kernel.'
trigger: glob
globs: 'backend/momento/**,backend/tests/**,backend/scripts/**'
---

# Backend (Python)

Full detail: [`../../docs/ai/backend.md`](../../docs/ai/backend.md) and
[`../../docs/ai/conventions.md`](../../docs/ai/conventions.md).

- `from __future__ import annotations` at the top of every module; a module
  docstring that says what the module is for.
- Private helpers prefixed `_`. `db.py` is the only module that touches
  SQLAlchemy; routes call its helpers rather than raw queries.
- Type hints on signatures, `Optional[...]` / `Dict[...]` style.
- Pydantic `BaseModel` for request bodies; plain dicts for responses, shaped by
  the serializers in `db.py` (camelCase on the wire).
- New endpoint → `x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")`
  passed through `visitor_of()`, and a matching interface in
  `frontend/lib/api.ts`.
- Handlers stay synchronous `def`. Making them `async def` blocks the event loop
  and starves `/ws/rounds` — that outage is in the git history.
- House edge comes from `db.get_settings(visitor)["houseEdge"]`.
- SQLite specifics are load-bearing: WAL + `synchronous=NORMAL`, one writer,
  `sqlite_autoincrement` on the ledger, additive schema changes in
  `db._migrate()`.
- Rounding is correctness: multipliers are `floor(x * 100) / 100`, probabilities
  are probabilities.

Verify with `cd backend && python3 -m pytest tests -q`.
