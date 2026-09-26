---
name: add-backend-route
description: Add or modify a FastAPI endpoint in backend/momento/api.py — including visitor scoping, Pydantic request model, db.py serializer, and a pytest that covers it. Use when the task is a new API capability.
allowed-tools:
  - read
  - edit
  - grep
  - glob
  - exec
---

# Add a backend route

Reference: `docs/ai/backend.md`, `docs/ai/data-model.md`, `.github/instructions/backend-python.instructions.md`.

## 1. Decide where the logic lives

A route is **validate → call kernel → serialize**. If you are writing a loop
over rounds, a probability, or a fit inside a route handler, stop: that belongs
in an analytics module (`fairness`, `randomness`, `survival`, `ev`,
`math_models`, `pipeline`, `strategies`, `windows`) and the route calls it. If
you are writing SQL, it belongs in `db.py`.

## 2. Write the handler

Copy the shape of an existing route — the newest ones are at the end of
`api.py` (`/annotations` is a good small example).

```python
@api.get("/your-thing")
def get_your_thing(
    limit: int = Query(default=200, ge=1, le=5000),
    x_visitor_id: Optional[str] = Header(default=None, alias="X-Visitor-Id"),
) -> Dict[str, Any]:
    v = visitor_of(x_visitor_id)
    ...  # call the kernel, then db helper
```

Non-negotiables:

- **`def`, not `async def`.** The analytic kernel is CPU-bound NumPy work;
  `async` here blocks the event loop and starves `/ws/rounds`. The git history
  contains this exact outage.
- **Visitor scoping.** `visitor_of(x_visitor_id)` and only `db.*` helpers that
  filter on `visitor_id`. There is no cross-visitor read in this system.
- **Pydantic `BaseModel`** for a JSON body, with `Field(...)` constraints.
  `UploadFile`/`File` for multipart.
- **`HTTPException(4xx, "lowercase, specific problem")`.**
- **House edge from settings**, never a literal.
- Any response that publishes a probability also publishes its sample size.

## 3. Serialize

Add or extend a serializer in `db.py` that emits the camelCase wire shape, and
add the matching `interface` to `frontend/lib/api.ts` in the same change. A
field that exists only on one side is a future `undefined` in the UI.

## 4. Migrate if you touched the schema

`Base.metadata.create_all()` cannot see a change to an *existing* table. Add the
column/index/backfill to `db._migrate()` and cover it in
`backend/tests/test_migrations.py`.

## 5. Test

Add to the appropriate file in `backend/tests/` (or a new `test_<area>.py`).
Follow `.github/instructions/tests.instructions.md`: assert a published number or
an identity, name the test as a claim, seed any randomness.

```bash
cd backend && python3 -m pytest tests -q
```

## 6. Report

List: the route, its request/response shape, the DB helper, whether a migration
was needed, and the test that proves it. Quote the pytest summary line.
