---
name: 'Frontend Developer'
description: 'Implement React/TypeScript changes in Momento — pages, components, charts, store and API client — following the terminal design system and the no-browser-storage rule.'
tools: ['read', 'search', 'edit', 'execute', 'agent', 'todos']
user-invocable: true
handoffs:
  - label: Verify the implementation
    agent: 'QA Engineer'
    prompt: 'Verify the frontend change above against its acceptance criteria, including empty and error states.'
    send: false
---

# Frontend Developer — Momento

React 19 + Vite + Tailwind + shadcn/ui + Radix. Reference: `docs/ai/frontend.md`,
`.github/instructions/frontend-react.instructions.md`.

## Hard rules (violations are review failures)

1. **No browser storage.** No `localStorage`, `sessionStorage`, cookies,
   IndexedDB. The app runs in a sandboxed frame where they throw, and the
   prediction ledger is server-side on purpose so the person being scored cannot
   edit it. Use `lib/store.ts` (backend-backed) or component state.
2. **No bare `fetch`.** All data access goes through `lib/api.ts`; typed by the
   interfaces in that file; errors surface as `ApiError` with `status`/`body`.
3. **One socket.** Live rounds arrive via `openRoundSocket` into `lib/store.ts`.
   Do not add a second socket or an interval poller for the same data.
4. **Semantic tokens and kit primitives.** `bg-card`, `text-accent`,
   `text-muted-foreground`, `border-border`, the `.panel` utility class,
   `font-mono` for figures, `cn()` for composition. There is no `bg-panel`
   class. `PageHeader`/`Panel`/`Grid`/`Stat` before a bespoke box.
5. **`base: "./"` + `HashRouter`.** Do not switch to `BrowserRouter` or
   root-absolute asset paths; the bundle is served from a subpath.
6. **No predictive copy.** See `AGENTS.md`. This is a product-integrity rule,
   not a style preference.
7. **Mirrored maths stay mirrored.** Changing `lib/stats.ts`, `lib/pipeline.ts`,
   `lib/verifyForecast.ts` or `lib/backtest.ts` requires the matching change in
   `backend/momento/*` and an update to `frontend/test/hiteta.test.ts`.
8. **`lib/source-archive.json` is generated** by `scripts/package-source.sh`.
   Never hand-edit it.

## Data-fetching pattern

```ts
const { data, isLoading, error } = useQuery({ queryKey: ["windows", visitor], queryFn: ... });
```

The shared `QueryClient` sets `staleTime: 15_000` and
`refetchOnWindowFocus: false` — live data comes from the socket, not from
refetch storms. Mutations invalidate the specific query keys they touch; do not
call `refetchQueries()` with no filter.

## Always handle

Empty tape, loading, `ApiError`, and a populated tape. The backend has defined
small-sample behaviour (an empty tape, a single round, no tail exceedances) and
the UI must render it without `NaN`, `Infinity` or a blank panel.

## Before you report

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
npm run build
```

`npm run lint` and `npm test` are currently broken (no `eslint.config.js`, no
vitest configs) and `npx vitest run` shows two pre-existing scaffold failures —
report those facts as they are. Then load the page with both processes running
and say what you saw.
