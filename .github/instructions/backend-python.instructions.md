---
name: 'Backend Python'
description: 'Use when editing anything under backend/ — FastAPI routes, SQLAlchemy models, analytics kernel modules, watcher and ingest code.'
applyTo: 'backend/**'
---
# Backend rules (Python 3.11+, FastAPI, SQLAlchemy, SQLite)

Read `AGENTS.md` §4 first. Module-level detail: `docs/ai/backend.md`.

## Structure

- `api.py` is the only HTTP surface. Analytics lives in its own module; a route
  should read as "validate, call kernel, serialize", not as maths.
- `db.py` is the only module that touches SQLAlchemy or SQL. Routes call
  `db.*` helpers.
- Every module starts with `from __future__ import annotations` and a docstring
  that says what the module is for.

## Hard rules

1. **Visitor scoping.** New endpoints take
   `x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id")`
   and resolve it with `visitor_of()`. Every DB helper takes `visitor` as its
   first argument and filters on `visitor_id`. There is no cross-visitor read.
2. **Synchronous handlers.** The kernel is CPU-bound NumPy/SciPy work. `async
   def` on an analytics route blocks the event loop and starves the websocket
   feed (see the git log entries about the frozen prediction panel). Only
   `@app.websocket` handlers and genuine `await` points are async.
3. **House edge from settings.** `db.get_settings(visitor)["houseEdge"]`. Never
   hardcode an edge in new maths.
4. **Schema changes go in `db._migrate()`.** `Base.metadata.create_all()` only
   creates missing tables, so an alteration to an existing table is invisible
   unless it is written there. `test_migrations.py` guards this.
5. **Ledger identity.** `predictions` uses `sqlite_autoincrement` on purpose —
   a freed rowid must never be handed to a new commitment. Do not remove it,
   and do not "simplify" the legacy-table rebuild in
   `_migrate_predictions_to_autoincrement`.
6. **Determinism where it is promised.** The demo tape is generated from a fixed
   seed pair (`SEED_SERVER` / `SEED_CLIENT`), and `_ensure_seeded` holds a
   per-visitor lock so two concurrent first requests cannot append two copies of
   the tape. Keep both properties.
7. **Errors.** Raise `HTTPException(4xx, "lowercase explanation of the actual
   problem")`. No bare `except:`; catch the specific exception and either handle
   it or re-raise. Never swallow an error that would silently poison a
   statistic.
8. **Serialization.** Wire types are camelCase and produced by serializers in
   `db.py`. Add a field to the serializer, not ad-hoc dicts in routes.

## Response shape

- Probabilities are probabilities in `[0, 1]`, never percentages.
- Multipliers are rounded `floor(x * 100) / 100`.
- Every analytic response that publishes a probability also publishes the
  sample size and, where the kernel computes one, an interval. A rate without
  an `n` is not reviewable.
- Driver/explainability payloads are JSON in a `Text` column and must survive a
  round-trip through the serializer.

## Before you finish

```bash
cd backend && python3 -m pytest tests -q
```

Add a test for new behaviour, and if you touched the maths, keep the closed-form
identities in `tests/test_reality_checks.py` green.
