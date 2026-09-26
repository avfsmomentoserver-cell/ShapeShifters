# HANDOFF — Dashboard "commercial forecaster" headline

Self-contained brief for a fresh chat. Everything below was verified against the
codebase on 2026-09-25 (branch `momento-terminal-replace`, HEAD `181bb5ee`).

---

## 1. The task (user's words)

> "i want the main dashboard to show user friendly and actual target derived
> from combined analysis of backend prediction intelligence to all users to
> have an idea of next round target multiplier, confidence and range and the
> eta of expected moonshots and megas like a commercial forecaster"

Follow-up from the user: **"ignore defensible try your best just to forecast
not defend"** — i.e. make it a confident, glanceable, commercial-forecaster
style card (think weather forecast: headline number, confidence, range, ETAs
for big events). Do not bury it in caveats.

**The one line that must survive** (this repo's overriding rule, `AGENTS.md`
§1): a correctly implemented crash game is unpredictable and every stake has
EV = `-h × stake`. The card may be styled like a commercial forecaster, but the
copy must not claim the next round is knowable or that the user has an edge.
Keep the honesty to **one short footer line** ("expected distribution of the
next round, not a call to bet — every stake costs the house edge"), not a
wall of caveats. That is the difference between a forecast and a bet, and it
is the single rule this codebase is built on.

## 2. Repo ground rules (non-negotiables)

- **No browser storage** anywhere in `frontend/` (sandboxed frame throws).
- **Visitor scoping**: every endpoint takes `X-Visitor-Id` via `visitor_of()`.
- **API handlers stay synchronous `def`** (CPU-bound kernel; `async def` kills
  the websocket feed — that bug is in git history).
- **Mirrored maths**: `frontend/lib/{stats,pipeline,verifyForecast,backtest}.ts`
  duplicate backend formulas. Change both sides in one commit. (This task is
  UI-only — no formula changes — so no mirror work needed.)
- **Semantic tokens only** in Tailwind (`bg-panel`, `text-accent`,
  `border-border`, `text-muted-foreground`, `font-mono-num`). No raw hex in
  class names (inline `style` hex is used by existing chart components and is
  acceptable where they already do it).
- **No new dependencies.**
- `npm run lint` and `npm test` are **broken** (missing `eslint.config.js`,
  `vitest.config.ts`). Use `npx tsc -p tsconfig.app.json --noEmit`,
  `npx vitest run`, `npm run build`.

## 3. What already exists (verified — do not rebuild)

The Dashboard (`frontend/pages/Dashboard.tsx`) already leads with
`<CommandCenter />` (`frontend/components/CommandCenter.tsx`), which renders:

1. **Status strip** — live feed state, last round, state, 2× hit rate.
2. **`PredictorCard`** (`components/PredictorCard.tsx`) — the committed
   forecast: confidence ring (the open forecast's band probability), band,
   state, measured ledger accuracy, re-arm button.
3. **`FullForecast`** (`components/FullForecast.tsx`) — the big panel:
   - headline = **live E[X]** (exponentially weighted mean, half-life 50)
     with per-round Δ
   - range stack: tight 50% (IQR), full 90%, extreme 98%, unlimited observed
   - quantile ladder + adaptive log-scale chart
   - **"time to each magnitude" ladder** (`HitLadder`): ETAs to 2×/5×/10×
     (big hits) and 20×/50×/100×/1000× (moonshot/mega/cosmic/jackpot) with
     p-reach, p90, and "tail extrapolation" flags
   - seed-evidence row (prior-data validation)
   - **walk-forward verification** (measured coverage, Brier vs fair, drift
     verdict) — computed by `verifyForecast` in `lib/verifyForecast.ts`
4. **Ensemble forecast** panel — top-3 state candidates with calibrated
   probabilities.
5. **Crash-point ETA** gauge — median + p25–p90 of the calibrated curve.
6. **Survival curve** chart.

**So all the data the user asked for already exists and is computed live.**
What's missing is a single **user-friendly, glanceable headline card** that
consolidates: one target number, one confidence figure, one range, and the
moonshot/mega ETAs — "like a commercial forecaster". The current surface
spreads this across three dense panels.

## 4. The data (exact shapes, verified)

`useAnalysis()` (exported from `CommandCenter.tsx`) returns
`Analysis | null` from `analyze(multipliers)` in `frontend/lib/pipeline.ts`
(≥10 rounds required). Key fields:

```ts
interface Analysis {
  state: State;                       // "Collapse"|"Shelf"|"Normal"|"Ignition"|"Moonshot"
  target: { median: number; p25: number; p90: number };   // calibrated curve
  forecast: {                         // p01..p99 + intervals, all calibrated
    p01..p99: number;
    tight: [number, number];          // 50% (IQR)
    full: [number, number];           // 90%
    extreme: [number, number];        // 98%
    iqr: number;
  };
  expectedValue: { full; recent; ema; deltaPerRound; halfLife; n; max };
  tailAlpha: number;                  // Hill index; fair tape = 1.0
  survivalAt: (x: number) => number;  // calibrated P(next >= x)
  hitEtas: Record<"2x"|"5x"|"10x", HitEta>;
  bandHitEtas: Record<"20x"|"50x"|"100x"|"1000x", BandEta>;
  // BandEta = { key, threshold, label, eta: HitEta }
}
interface HitEta {                    // lib/stats.ts
  threshold: number;
  pReach: number;   // P(next round >= threshold)
  eta: number;      // expected rounds to next hit (geometric, 1/p)
  ciLower: number;  // ±1.5σ
  ciUpper: number;
  p90: number;      // rounds by which 90% of hits land
  note: string | null;  // "tail extrapolation — fewer than ~8 hits on tape"
}
```

Band naming (repo convention, `lingBand` in `pipeline.ts`): **20× = moonshot,
50× = mega, 100× = cosmic, 1000× = jackpot**.

Measured accuracy (for the "confidence" figure) comes from:
- `verifyForecast(multipliers, { warmup: 300, step: 15 })` in
  `lib/verifyForecast.ts` → `ForecastVerification` with `coverage.tight/full/
  extreme` (hit/near/miss shares vs expected 0.5/0.9/0.98), `medianBrier`,
  `fairBrier`, `wait[]` (predicted vs realized waits per threshold), and
  `verdict: { grade: "calibrated"|"drift"|"miscalibrated"|"noise", headline,
  notes }`. `FullForecast.tsx` already computes this keyed to checkpoint
  boundaries (WARMUP=300, VSTEP=15) — **reuse that pattern** (it's O(n) and
  must not run every tick).
- `usePredictionLedger()` in `lib/ledger.ts` → server-side ledger with
  `open` (the committed forecast: `state`, `band`, `probability`, `eta`),
  `bandAccuracy`, `accuracy2`, `avgBrier`, `resolvedCount`.

## 5. Design decision (made autonomously — user was unavailable)

- **Headline target = `analysis.target.median`** (median of the calibrated
  next-round survival curve, last-600-round window). It is the honest
  "typical next round" and re-commits every round. Show
  `analysis.expectedValue.ema` as a secondary "expected value (incl. tail)"
  line, since the mean carries the whole tail.
- **Confidence = the model's measured track record**, not a fake per-round %:
  show the walk-forward tight-band coverage (e.g. "50% band hit 48% of the
  time — as specified") + Brier vs fair baseline + the verdict grade
  (calibrated / tape drift / miscalibrated / too few samples). Label it
  "model accuracy (measured)" so it reads as a forecaster's reliability
  record, which is exactly what commercial forecasters publish.
- **Range = `forecast.tight` (50%)** as the primary band, with `forecast.full`
  (90%) as the secondary.
- **Moonshot/mega ETAs = `bandHitEtas["20x"]` and `["50x"]`** (plus 100×
  cosmic as a third tile), each: expected rounds (eta), p90, p-reach, and the
  "tail" flag when `note` is set.
- **Placement**: a new compact hero card at the **top of `CommandCenter`**
  (above `PredictorCard`), so it leads the Dashboard. Keep everything below
  it as-is (the dense panels remain the "detail" layer).

## 6. Implementation plan (UI-only, no formula changes)

1. **New file `frontend/components/ForecastHeadline.tsx`** — the hero card:
   - Left: big `AnimatedNumber` target (`target.median`, `fmtX` style: 2dp
     <10, 1dp <100, 0dp above), label "expected next round", sub-line with
     `expectedValue.ema` ("incl. tail: X×") and state chip.
   - Middle: "50% range" bar (`forecast.tight` lo–hi) + "90% range"
     (`forecast.full`), using the existing `RangeRow`-style markup from
     `FullForecast.tsx` (copy the pattern; do not import private pieces).
   - Right: "model accuracy (measured)" — tight-band coverage % vs 50%
     expected, Brier vs fair, verdict grade chip (tones: calibrated=green,
     drift=cyan, miscalibrated=amber, noise=grey — same `GRADE_TONE` map as
     `FullForecast.tsx`).
   - Bottom row: three ETA tiles — **20× moonshot**, **50× mega**, **100×
     cosmic** — each: `eta` rounds (big), `p90` rounds, `pReach` %, "tail"
     flag when `eta.note` is set.
   - Footer: one line — "Expected distribution of the next round, recalibrated
     every round. Not a call to bet — every stake costs the house edge."
   - Props: `{ analysis: Analysis | null; verification: ForecastVerification |
     null }`. Warming-up state: "need ≥10 rounds of tape…".
   - Reuse: `AnimatedNumber`, `colorFor` from `./charts`; `useRounds` from
     `@/lib/store`; `verifyForecast` from `@/lib/verifyForecast` (compute it
     in `CommandCenter` with the same checkpoint-keyed `useMemo` pattern
     `FullForecast` uses, and pass it down — or compute inside the new
     component with the same pattern; do NOT run it on every tick).
2. **Edit `frontend/components/CommandCenter.tsx`** — render
   `<ForecastHeadline …/>` as the first child (above `<PredictorCardLazy />`).
   No other changes.
3. **No backend changes.** No `db.py`/`api.py`/`pipeline.py` edits. No mirror
   maths changes (no formulas touched).
4. **Docs**: if the change is structural, add one line to
   `docs/ai/frontend.md` under the Dashboard/CommandCenter description
   (check the file first; it may not mention CommandCenter at all).

## 7. Verification (definition of done)

```bash
npx tsc -p tsconfig.app.json --noEmit     # must be clean
npx vitest run                             # no NEW failures (2 pre-existing scaffold failures: example.test.ts "describe is not defined", calendar.browser.test.tsx needs Playwright)
npm run build                              # must succeed (runs package-source.sh first)
```

Then run it: backend on `:8000` (already running — see §8), `npm run dev` on
`:5173`, open the Dashboard, confirm the hero card renders with live numbers
and re-commits on each new round.

## 8. Environment state at handoff time

- **Backend: RUNNING** on `:8000` (started with
  `cd backend && nohup python3 -m uvicorn momento.api:app --host 0.0.0.0 --port 8000 > /tmp/momento-backend.log 2>&1 &`).
  Health: `{"status":"ok","version":"6.2.0","routes":77}`. Tape: **3,775
  rounds**, fed by the file watcher (`source: "watcher"`).
  ⚠️ The VS Code task `backend: run` is **broken** — it calls `python` which
  does not exist on this machine; use `python3`.
- **Frontend dev server: NOT running.** Start with `npm run dev` (Vite `:5173`).
- Git: branch `momento-terminal-replace`, HEAD `181bb5ee` ("EMA headline
  (half-life 50)…"). Untracked: `.agents/ .devin/ .github/ AGENTS.md docs/`;
  modified: `.gitignore`. No uncommitted app code.
- Backend test suite: `cd backend && python3 -m pytest tests -q` (138 tests,
  ~21 s) — not re-run this session; no backend changes planned.

## 9. Copy-integrity checklist (run before shipping the card)

From `.agents/skills/copy-integrity-audit/SKILL.md` — forbidden framings:
"signal", "due/overdue", "hot", "prime time", "next round will", "guaranteed",
"the model predicts", "beat the house". Required: every model figure next to
its measured quality; the standing statement that a correctly implemented
crash game is unpredictable and every stake has EV `-h × stake`. Terms that
are fine: *pressure, radar, DNA, ladder, moonshot, regime* (descriptive engine
names). The card must not let a reasonable user conclude they have an edge.
