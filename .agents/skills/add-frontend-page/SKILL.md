---
name: add-frontend-page
description: Add or modify a React route, page, panel or chart in frontend/ — using the kit primitives, design tokens, react-query and the backend-backed store, with no browser storage. Use for any UI work in this repo.
allowed-tools:
  - read
  - edit
  - grep
  - glob
  - exec
---

# Add a frontend page or panel

Reference: `docs/ai/frontend.md`, `.github/instructions/frontend-react.instructions.md`.

## 1. Decide the unit

- **New route** → a file in `frontend/pages/`, registered in `App.tsx`, plus a
  nav entry in `components/AppShell.tsx`. Routes are inside a `HashRouter`
  because `vite.config.ts` sets `base: "./"` and the bundle is served from a
  subpath — do not switch to `BrowserRouter`.
- **New panel inside an existing page** → a component in
  `frontend/components/`, or reuse `components/kit.tsx`.
- **New chart** → `components/charts.tsx` or `components/chartlab/`. Do not
  import `recharts` directly into a page.

## 2. Reuse before you build

`components/kit.tsx` exports the page furniture (`PageHeader`, `Panel`, `Grid`,
`Stat`, `Source`, …). `components/ui/` is the shadcn layer. Look at
`pages/Windows.tsx` or `pages/Exceedance.tsx` for the intended composition; a
new panel that hand-rolls a bordered box with `div`s is a review failure.

Style with **semantic tokens only**: `bg-panel`, `bg-background`,
`text-foreground`, `text-muted-foreground`, `text-accent`, `border-border`,
`font-mono` for figures. Compose with `cn()` from `@/lib/utils`. No raw hex, no
`slate-*`, no `style={{ color: … }}`.

## 3. Wire the data

- Reads go through `lib/api.ts` (`api.get/post/...`), typed by the interfaces in
  that file, fetched with `@tanstack/react-query` (`useQuery`/`useMutation`)
  against the shared `QueryClient` (`staleTime: 15_000`).
- Live rounds arrive from `openRoundSocket` into `lib/store.ts`. Consume the
  store hook; do not open a second socket or a `setInterval` poller for the
  same data.
- **Never** use `localStorage`, `sessionStorage`, `document.cookie` or
  IndexedDB. The app runs in a sandboxed frame where they throw, and the
  prediction ledger is intentionally server-side so the user being scored
  cannot edit it.
- Show the empty, loading and error states. A panel that renders `NaN` when the
  tape is empty is a bug — the backend has a defined small-sample behaviour and
  the UI must survive it.

## 4. Say only what the maths says

Every figure that comes from a model ships with its own measured quality next to
it (Brier skill, sample size, interval). No "signal", "due", "hot streak",
"guaranteed" or "next round will" copy — that is a product-integrity bug, not a
wording preference. If you are unsure whether a phrase crosses the line, run
`/copy-integrity-audit`.

## 5. Verify

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
npm run build
```

`npm run lint` is currently broken (no `eslint.config.js`); `npx vitest run`
shows two pre-existing scaffold failures. Report both facts as they are rather
than claiming the scripts passed.

Then run it: backend on `:8000`, `npm run dev`, and check the route in a
browser. A page that typechecks is not a page that works.
