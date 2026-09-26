---
name: 'Frontend React'
description: 'Use when editing anything under frontend/ — pages, components, the API client, the backend-backed store, the design system, charts and mirrored maths.'
applyTo: 'frontend/**'
---
# Frontend rules (React 19, Vite, Tailwind, shadcn/ui, Radix)

Read `AGENTS.md` §4 first. Route/component inventory: `docs/ai/frontend.md`.

## Hard rules

1. **No browser storage.** Never use `localStorage`, `sessionStorage`,
   `document.cookie`, IndexedDB or any origin-scoped persistence. The app runs
   in a sandboxed frame where they throw, and the prediction ledger is
   deliberately server-side so the person being scored cannot edit it. State
   belongs in `lib/store.ts` (backend-backed) or in component state.
2. **Use the alias.** `@/` resolves to `frontend/`. Import across directories
   with `@/…`, not `../../`.
3. **Use the design tokens.** Phosphor-green terminal palette exposed as
   Tailwind semantic classes (`bg-card`, `bg-background`, `text-accent`,
   `text-muted-foreground`, `border-border`) and the `.panel` utility class. No
   raw hex, no `slate-*`/`gray-*`, no inline `style` for colour. Compose classes
   with `cn()`. (`bg-panel` does **not** exist — it is a documentation bug in
   older notes; Tailwind emits nothing for it.)
4. **Reuse the kit.** `components/kit.tsx` exports the page furniture
   (`PageHeader`, `Panel`, `Grid`, `Stat`, `Source`, …); `components/ui/` is the
   shadcn layer; `components/charts.tsx` and `components/chartlab/` own
   visualisation. Do not build a one-off panel when a kit primitive exists.
5. **Data access goes through `lib/api.ts`.** No bare `fetch` in a component.
   Errors surface `ApiError` with `status` and `body`.
6. **Live data comes from the socket.** `openRoundSocket` (in `lib/api.ts`)
   pushes `round` / `bulk` / `hello` frames into `lib/store.ts`. Do not add a
   competing polling loop for the same data.
7. **Forms** are `react-hook-form` + `zod` via `@hookform/resolvers`. **Toasts**
   are `sonner`. **Icons** are `lucide-react`. **Charts** are `recharts` wrapped
   by `components/charts.tsx` — do not import `recharts` directly in a page.
8. **Mirrored maths.** `lib/stats.ts`, `lib/pipeline.ts`, `lib/verifyForecast.ts`
   and `lib/backtest.ts` reimplement backend formulas for display. If you change
   a formula, change its backend twin in the same commit and update
   `frontend/test/hiteta.test.ts`.
9. **Never imply predictive power.** No "signal", "due", "hot", "guaranteed",
   "next round will" copy. Descriptive language only, and any engine figure
   ships with its measured accuracy next to it. The gamble-aware framing
   (`/responsible`, the banner, the warning copy in the UI) stays.
10. **`lib/source-archive.json` is generated** by `scripts/package-source.sh`.
    Never hand-edit it.

## Layout

- One file per route in `pages/`, lazily imported where the shell already does
  so. Routes are registered in `App.tsx` under a `HashRouter` (`base: "./"`
  means the bundle is served from a subpath, so hash routing is required).
- `AppShell.tsx` owns the sidebar/nav; add a nav entry when you add a route.
- Props are typed inline or by a local `interface` in the same file.

## TypeScript

`strict` is off, `noUnusedLocals`/`noImplicitAny` are off, and `allowJs` is not
used. That is deliberate — do not flip strictness on as a drive-by. Still write
new code as if it were strict: explicit return types on exported functions,
narrow unions instead of `any`, optional fields as `T | undefined`.

## Before you finish

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
npm run build
```

`npm run lint` and `npm test` are broken until `eslint.config.js` and the
vitest configs are restored; use the commands above and report the caveat.
