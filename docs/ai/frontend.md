# Frontend — editing the React

`frontend/`, React 19 + Vite + Tailwind + Radix. `architecture.md` has the
two-process picture; this is the practical guide: every route, every component
family, the design tokens, the data paths, and the traps.

Everything below was read from the code at the commit that introduced this file.
Line numbers are given as `path:line` so you can confirm a claim before relying
on it. Where a fact is a judgement rather than a reading, it says so.

## 1. Shape

```
frontend/
  App.tsx                 route table + QueryClient (HashRouter, base "./")
  index.css               the design tokens and the utility classes
  main.tsx                entry
  pages/                  21 files → 30 <Route> entries (EngineView backs 8)
  components/
    AppShell.tsx          sidebar nav (NAV_SECTIONS), status header, RG banner
    kit.tsx               page furniture: Panel/Stat/Table/Async/… + formatters
    charts.tsx            canvas + SVG visualisations (pure, prop-driven)
    chartlab/             the Chart Lab: engine.ts, views.ts, ChartLab.tsx
    ui/                   shadcn/Radix primitives (46 files) — do not restyle
    <Feature>.tsx         15 feature/shell panels (see §5)
  lib/
    api.ts                the ONLY fetch layer (REST + WebSocket)
    store.ts              backend-backed React context: the tape, settings, …
    stats.ts pipeline.ts verifyForecast.ts backtest.ts ledger.ts avfs.ts
                          mirrored maths + local analyses
    utils.ts              cn()
    create-context-hook.ts
    source-archive.json   generated — never hand-edit
  test/                   vitest (see testing.md)
```

## 2. Routes — `frontend/App.tsx`

`HashRouter` with `base: "./"` (`vite.config.ts`), so the bundle also works from
a sub-path. Add a route in two places: the `<Route>` table in `App.tsx` **and**
an entry in `NAV_SECTIONS` (`components/AppShell.tsx:20`).

| Path | Page | Notes |
| --- | --- | --- |
| `/` | `Dashboard.tsx` | renders `CommandCenter` first, then `/stats/summary` |
| `/feed` | `Feed.tsx` | live feed + simulator control (`/sim/status`) |
| `/charts` | `Charts.tsx` | the only page that mounts `ChartLab` |
| `/windows` | `Windows.tsx` | window odds |
| `/predictor` `/studio` `/radar` `/pressure` `/autopilot` `/dna` `/ladders` `/analytics` | `EngineView.tsx` | **one file, eight routes** — the `view` prop selects a `EngineId` (`EngineView.tsx:16`) |
| `/accuracy` | `Accuracy.tsx` | ledger + calibration |
| `/exceedance` `/skill` `/phases` | `Exceedance.tsx` `Skill.tsx` `Phases.tsx` | reality-check surfaces |
| `/randomness` `/fairness` | `Randomness.tsx` `Fairness.tsx` | battery + provably-fair |
| `/ev` `/strategy` `/bankroll` `/alerts` | `Ev.tsx` `Strategy.tsx` `Bankroll.tsx` `Alerts.tsx` | money |
| `/ingest` | `Ingest.tsx` | **three-step `.db` import** (inspect → dry-run → commit) |
| `/data` | `Data.tsx` | paste/upload multipliers, reseed, export, API reference |
| `/settings` `/docs` `/responsible` | `Settings.tsx` `Docs.tsx` `Responsible.tsx` | |
| `/index.html` | → redirect to `/` | `Navigate` |
| `*` | `NotFound.tsx` | |

`EngineView` deliberately wraps each engine with a `META` block naming what it
*reads* and what it *cannot* tell you (`EngineView.tsx:26`). Do not remove those
two sentences; they are the honesty contract for the engine pages.

## 3. Design system

Tokens are CSS custom properties in `frontend/index.css` (`@layer base`), mapped
to Tailwind names in `tailwind.config.ts`. **Use the semantic class, never a raw
hex or a `slate-*`/`gray-*`.**

| Token | Class | Role |
| --- | --- | --- |
| `--background` | `bg-background` | page |
| `--foreground` | `text-foreground` | body text |
| `--card` | `bg-card` | raised surface (`.panel` uses `bg-card/80`) |
| `--primary` | `text-primary` / `bg-primary` | phosphor green — the live/accent green |
| `--accent` | `text-accent` | amber — highlights, `new` badges |
| `--muted-foreground` | `text-muted-foreground` | secondary text |
| `--border` | `border-border` | hairlines |
| `--destructive` | `text-destructive` | red — failure/negative |

**There is no `bg-panel` class and no `--panel` token.** `AGENTS.md` §4 and
`frontend-react.instructions.md` name `bg-panel` among the semantic tokens; that
is a documentation bug — Tailwind silently emits nothing for an unknown class,
so a panel styled `bg-panel` renders unstyled rather than erroring. For a panel,
use the `.panel` utility class (`index.css:100`, which `@apply`s
`rounded-md border border-border bg-card/80 backdrop-blur-sm`), or `bg-card`
directly. The tokens that do exist are the ones listed above.

Canvas colours that are *not* tokens: `GREEN = "#2bd97c"`, `AMBER = "#ffb020"`,
`RED = "#ff4d5e"`, `CYAN = "#38c7e8"` (`charts.tsx:9-12`, mirrored in
`views.ts:19-22`). A CSS variable cannot reach a `<canvas>` 2D context, so these
exist as JS constants. Treat them as the drawing palette; do not copy them into
JSX where a token class works.

Utility classes defined in `index.css` (not Tailwind plugins):
`font-mono-num` (tabular figures), `panel` / `panel-header` / `panel-title`,
`stat-value` / `stat-label`, `scanline`, `glow-green` / `glow-amber`,
`ticker-in`, plus `live-dot` and `sweep::after` for the live indicator.

`cn()` from `@/lib/utils` (clsx + tailwind-merge) composes class names.

## 4. `components/kit.tsx` — the primitives

27 exports. Reuse these before writing a one-off panel.

**Layout/page:** `PageHeader` `:30`, `Panel` `:42` (optional `title` / `right` /
`note`), `Grid` `:71` (`cols` 1–4).

**Display:** `Stat` `:81`, `Verdict` `:118`, `Table` `:363` + `Row` `:382` +
`Cell` `:395`, `IntervalBar` `:405` (point estimate + 95% band + fair-model
tick — the pattern for any rate), `Source` `:474`.

**Interaction:** `Btn` `:139`, `Field` `:175`, `NumInput` `:198`, `TextInput`
`:227`, `Select` `:250`, `Toggle` `:270`.

**Async state:** `useApi` `:15` (react-query wrapper; `queryKey: ["api", path]`,
`staleTime: 15_000`, `retry: 1`; pass `options` to override — that is how
`refetchInterval` is added), `Async` `:344` (loading/error/data render prop),
`Skeleton` `:300`, `ErrorNote` `:310`, `Empty` `:335`.

**Formatters:** `pct` `:456`, `num` `:458`, `mult` `:460`, `money` `:461`,
`signed` `:463`, `ago` `:464`. Use them instead of `toFixed` so `null`/`NaN`
renders `—` consistently. Probabilities are rendered by `pct` (which multiplies
by 100) — never store or pass a percentage where the kernel means a probability.

## 5. Feature panels (`components/*.tsx`)

`Analytics.tsx` (`CurveShapes`, `DryZones`, `Regimes`, `Streaks`),
`Autopilot.tsx`, `DnaHunter.tsx`, `ForecastStudio.tsx`, `LadderDash.tsx`,
`MegaPressureTracker.tsx`, `MoonshotRadar.tsx`, `PredictorCard.tsx` — each backs
an `EngineId`. `BacktestLab.tsx` backs the Strategy page.
`CommandCenter.tsx` composes the dashboard head
(`useAnalysis()` at `:19`, `ScopeChart`, `PredictorCardLazy`, `FullForecast`).
`FullForecast.tsx` owns the full-range p01…p99 card and the walk-forward
verification memo (`:81-99`). `AiSummaryPanel.tsx` backs the dashboard's
"overall AI summary" panel: two `useApi` calls (`/stats/ai-summary` refetched
every 60 s, `/stats/ai-status` for the configured/model badge), renders the
`available: false` + `reason` state as a *state* not an error, and prints the
`guard` violations when the prose trips the copy audit. `ChartPrediction.tsx`
draws the projected shape (see §6). `CommandPalette.tsx`, `Logo.tsx`,
`NavLink.tsx`, `SourceDownload.tsx` are shell furniture.

## 6. Charts

`components/charts.tsx` — pure, prop-driven, no data fetching:
`colorFor` `:14` (red < 2× ≤ cyan < 10× ≤ amber), `AnimatedNumber` `:20`
(count-up, honours reduced motion), `ScopeChart` `:50` (canvas tape, glow trace,
pulsing head, moonshot blips), `ProbBar` `:171`, `SurvivalChart` `:186`,
`Histogram` `:214`.

`components/chartlab/` is the Chart Lab and is the one place with a real
architecture:

- **`engine.ts`** — coordinate/annotation maths only. `fwd`/`inv`, `makeScale`
  (data→pixel and pixel→data lambdas), `zoomAxis`/`panAxis`/`clampViewport`,
  `linearTicks`/`logTicks`/`ticksFor`, `fmtMult`/`fmtAxis`,
  `hitAnnotation`/`drawAnnotation`/`describeAnnotation`.
  **The load-bearing invariant** (`engine.ts:5-9`): everything a chart draws
  lives in DATA coordinates and is projected at paint time through a `Scale`. A
  level drawn at 3.2× is stored as `3.2`, so it stays welded through zoom, pan,
  resize and axis-mode changes, and survives a reload (the same number goes to
  the DB). Never store pixels.
- **`views.ts`** — `ChartId` `:17` is a closed union; `VIEWS` `:765` is the
  single registry. Six views: `tape` `:179`, `candles` `:302`, `dist` `:391`,
  `survival` `:481`, `returnmap` `:580`, `equity` `:677`. Each is a `ViewDef`
  (`:68`) with `build(ctx) → ViewData` (`:51`). **Adding a seventh view is one
  new object in `VIEWS` plus one member on `ChartId`** — that is the stated
  design (`views.ts:6-7`). The shared painting helpers (`clip` `:86`,
  `refLine` `:95`, `thin` `:144`, `nearestPoint` `:152`) are module-private, so
  a new view must live in this same file to reuse them.
  `survival` is the model-overlay view (empirical `P(M≥x)` against the dashed
  fair law `(1-h)/x`, log–log); `tape` is the round-indexed host (has
  `yExtent`, `xUnit: "round"`).
- **`ChartLab.tsx`** — receives `view`, `rounds`, `annotations`, … as props and
  does **not** own the selection or fetch anything. It resolves the `ViewDef`,
  calls `build()` in a `useMemo` (`:92`), re-arms axis defaults on view change
  (`:124`), paints `data.draw(c, scale)` (`:251`) and then the annotations
  (`:253`). Probe tooltip + canvas interaction live here.

Views never import from the store; the page supplies the data. `Charts.tsx`
mounts the only `ChartLab` and owns `view`/`bucket`/`target`/`bins`/`follow`
plus the annotations loaded from `/annotations` (`Charts.tsx:49`).

**`components/ChartPrediction.tsx`** is the "chart prediction" visual beneath
the lab. It plots three paths on one **hand-rolled SVG** (not recharts, because
the axes are log on magnitude and inverted on probability, which recharts does
not express cleanly): the *projected* shape from `GET /stats/shape`, the
*realized* path on the same axes, and the dashed fair law `(1−h)/m`. Below the
chart the shape is decomposed twice — into the individual round bands it implies
(chance, ETA in rounds, and the 90% wait) and into the curve-family weights. The
`useApi<ShapeForecast>` call lives in the component; the page just mounts it.

## 7. Data flow

**REST.** `lib/api.ts` is the only fetch layer; no bare `fetch` in a component.
`api.get/post/put/patch/del`, and `api.upload(path, file)` for multipart —
`upload` blanks `Content-Type` on purpose so the browser's multipart boundary
survives (`api.ts:59-67`). Every request sends `X-Visitor-Id: "local"`
(`VISITOR_ID`, `api.ts:15`). `API_BASE` resolves the `__PORT_8000__` placeholder
to `http://localhost:8000` locally (`api.ts:10`) — the literal string is what
makes the dev fallback work; do not "clean it up". Errors are thrown as
`ApiError` with `status` and parsed `body`.

**Live.** `openRoundSocket(onMessage, onStatus)` (`api.ts:76`) pushes
`round` / `bulk` / `hello` frames with exponential-backoff reconnect, and returns
an unsubscribe function. Do not open a second socket.

**Store.** `lib/store.ts` — `export const [RoundProvider, useRounds]` via
`createContextHook`. It holds `rounds`, `multipliers`, `total`, `settings`,
`context`, `openPrediction`, `alertFeed`, `conn`, `liveFeedActive`,
`simulatorRunning`, and the two signals components key off:

- `lastAddedAt` — "the tape moved". Set by a websocket push (`:97`) **and** by a
  refresh when the newest id changes (`:65-69`). Keying an effect or a
  `useMemo` on it is the established way to re-commit on a new round — see
  `ledger.ts:63-66` and `FullForecast.tsx:81-99`.
- `conn` — socket state; a `closed → open` transition triggers a catch-up
  refresh (`:114-119`) so frames lost during an outage do not leave a hole.

Store state is a cache of what the backend already committed, never the source
of truth. There is a permanent light `/meta` probe (`:146-156`) that escalates
to a full refresh when the server's round count diverges — this is the recovery
path when the proxy silently drops websocket frames, and it is why a panel must
never assume the socket alone will keep it current.

**Re-committing on a round.** Two established patterns, both in the tree:

1. *Event-driven refetch* — `usePredictionLedger` refetches on `lastAddedAt`
   (`ledger.ts:59-66`).
2. *Checkpoint-keyed memo* — `FullForecast` keys an O(n) walk-forward replay to
   `floor((n - warmup) / step)` so the expensive work runs on a block boundary,
   not on every tick (`FullForecast.tsx:81-99`). Copy this for any heavy
   client-side computation; do not recompute O(n) work per round.

Interval polling is used for endpoints with no push equivalent
(`refetchInterval`: `Dashboard.tsx:60` 20 s, `Alerts.tsx:43` 15 s,
`Bankroll.tsx:56` 30 s, `Feed.tsx:48` 5 s). Per `AGENTS.md` §4, prefer the
socket/store path where it exists.

## 8. Hard rules

1. **No browser storage.** No `localStorage`, `sessionStorage`,
   `document.cookie`, IndexedDB. The app runs in a sandboxed frame where they
   throw, and the prediction ledger is server-side so the person being scored
   cannot edit it. State lives in `store.ts` (backend-backed) or component state.
2. **`@/` alias** → `frontend/`. Use it across directories.
3. **Semantic tokens only**; compose with `cn()`.
4. **Reuse `kit.tsx`**; `ui/` is the shadcn layer — extend a primitive there
   rather than forking it in a page.
5. **`export default` for pages, named exports** for components and lib modules.
   Props typed inline or with a local `interface`. `strict` is off by design
   (`tsconfig.app.json`) — write new code as if it were strict anyway.
6. **Mirrored maths moves together.** `lib/stats.ts`, `pipeline.ts`,
   `verifyForecast.ts`, `backtest.ts`, `ledger.ts` duplicate backend formulas.
   Change the Python twin in the same commit and update
   `frontend/test/hiteta.test.ts` if a pinned value moved. See
   [`domain-math.md`](domain-math.md).
7. **Never imply predictive power.** No *signal*, *due*, *hot*, *guaranteed*,
   *next round will*. Descriptive language only, and any engine figure ships
   with its measured quality beside it. The responsible-gambling surface stays.
8. **`source-archive.json` is generated** by `scripts/package-source.sh`; never
   hand-edit, and expect `git status` to be noisy after `npm run build`.

## 9. `lib/` beyond the maths

| File | Key exports | Role |
| --- | --- | --- |
| `stats.ts` | `mean`, `stdev`, `quantile`, `paretoFit`/`paretoSurvival`, `exponentialFit`/`Survival`, `markovStreaks`, `clusterLog`, `detectRegimes`, `fitCurveShape`/`curveShapeDistribution`, `hillAlpha`/`tailSurvival`/`calibratedSurvival`, `hitEta` `:401`, `etaEstimate` | Mirrors the kernel for offline/live display |
| `pipeline.ts` | `STATES`, `analyze` `:294`, `candidates`, `calibratedQuantile` `:420`, `fullForecast` `:488`, `expectedValue` `:535`, `survivalCurve`/`Log`, `probabilityAbove`, `BIG_HIT_THRESHOLDS`/`BAND_HIT_THRESHOLDS`, `hitBandEtas` | Assembles the `Analysis` object the dashboard reads |
| `verifyForecast.ts` | `verifyForecast` `:134`, `DEFAULT_FORECAST_WINDOW`, `ForecastVerification` | Walk-forward self-scoring of the forecast |
| `backtest.ts` | `backtest` `:36`, `BacktestResult` (carries turnover) | Strategy replay |
| `ledger.ts` | `usePredictionLedger`, `walkForward`, `realizedState` | Reads `/ledger`; the scored commitment record |
| `avfs.ts` | ceilings, `megaPressure`, `megaEta`, `bankrollPlan`, `chasePlan`, `dnaSequences`/`Gaps`, `ladderAnalysis`, `scanMoonshot`, `autopilotBacktest` | The Aviatrix-flavoured feature engines |
| `utils.ts` | `cn` | clsx + tailwind-merge |

`Analysis` (`pipeline.ts:237`) is what most panels consume: `state`,
`percentiles`, `markov`, `stateMatrix`, `clusters`, `regimes`, `pareto`,
`exponential`, `ladder`, `dna`, `shapeDist`, `survivalAt(x)`, `target`,
`forecast`, `expectedValue`, `tailAlpha`, `hitEtas` (2×/5×/10×),
`bandHitEtas` (20/50/100/1000×). `useAnalysis()` in `CommandCenter.tsx:19`
memoises it off `multipliers`.

## 10. Before you finish

```bash
npx tsc -p tsconfig.app.json --noEmit
npx vitest run
npm run build
```

`npm run lint` and `npm test` are broken (missing `eslint.config.js`,
`vitest.config.ts`, `vitest.browser.config.ts`) — use the three commands above
and report the caveat rather than claiming a script passed. Full detail and the
current pass/fail state: [`testing.md`](testing.md) and
[`runbook.md`](runbook.md) §"Known broken".
