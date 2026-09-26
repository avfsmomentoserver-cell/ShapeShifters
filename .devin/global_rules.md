# Momento — global rules

The canonical rule set is [`../AGENTS.md`](../AGENTS.md) at the repository root;
it is loaded automatically. This file exists so Devin also picks the rules up
from `.devin/`, and it deliberately repeats only what must never be missed.

1. **Never imply predictability.** Momento measures a past tape and scores its
   own failures. No feature, default, label or string may suggest the software
   can predict the next round, find a profitable time to play, or beat the house
   edge. Honest negative results are the product.
2. **No browser storage** anywhere in `frontend/` — no `localStorage`,
   `sessionStorage`, cookies or IndexedDB.
3. **Every table and endpoint is scoped by `visitor_id`** via the
   `X-Visitor-Id` header and `visitor_of()`. No cross-visitor query.
4. **API handlers stay synchronous `def`.** The kernel is CPU-bound NumPy work.
5. **Read the house edge from settings**, never a literal in new maths.
6. **Schema changes go in `db._migrate()`.**
7. **Mirrored maths moves together** — `backend/momento/*` and
   `frontend/lib/{stats,pipeline,verifyForecast,backtest}.ts`.
8. **Report only checks you actually ran.** `npm run lint` and `npm test` are
   known-broken (missing `eslint.config.js`, `vitest.config.ts`,
   `vitest.browser.config.ts`).

Read [`../docs/ai/README.md`](../docs/ai/README.md) before any non-trivial task
and follow it to the one or two pages it points at.
