/**
 * Full Forecast — the dedicated, prominent next-round forecast panel.
 *
 * The headline is the EXPONENTIALLY WEIGHTED mean of the next round
 * (half-life 50 rounds) with its per-round Δ printed beside it. It was
 * measured to re-commit its 2-decimal display on 98% of rounds on the live
 * tape; the plain rolling mean managed only 37% and the whole-tape mean even
 * less, both of which read as "stuck" (bug reports: frozen at "10.4×", then
 * frozen at "6.67×"). Big hits shift the headline instantly — a 40× spike
 * moves it the same round it lands.
 *
 * Everything else renders the whole calibrated next-round distribution: a
 * tight 50% interval (the IQR), a full 90% interval, a 98% envelope, the
 * observed unlimited range, an adaptive log-scale chart that keeps equal
 * multiples per grid cell, a per-percentile ladder, a single "time to each
 * magnitude" ladder (2x/5x/10x big hits run straight into 20x/50x/100x/1000x
 * moonshot-mega-cosmic), the seed-folder prior data the estimate is validated
 * against, and the model diagnostics that say how much to trust the tail.
 *
 * The quantile ladder is sampled off the calibrated empirical + Hill-tail
 * survival curve (survival.py port) over the recent 600-round window, so it
 * re-commits on every round and stays honest about a fair tape.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useRounds } from "@/lib/store";
import {
  survivalCurveLog, type Analysis, type BigHitKey, type BandHitKey,
} from "@/lib/pipeline";
import { verifyForecast, type ForecastVerification } from "@/lib/verifyForecast";
import { AnimatedNumber, colorFor } from "./charts";

/** Prior-data reference from the repo seed/ folder (see backend/momento/seed.py). */
export interface SeedEvidence {
  found: boolean;
  corpora: string[];
  combined: { count: number; mean: number; median: number; p95: number; p99: number; max: number };
  byCorpus: Record<string, { count: number; mean: number; median: number; p95: number; p99: number; max: number }>;
  note: string;
}

/** One-time fetch of the seed corpus — it never changes under us. */
export function useSeedEvidence(): SeedEvidence | null {
  const [evidence, setEvidence] = useState<SeedEvidence | null>(null);
  useEffect(() => {
    let live = true;
    api.get<SeedEvidence>("/seed")
      .then((e) => { if (live) setEvidence(e); })
      .catch(() => { if (live) setEvidence(null); });
    return () => { live = false; };
  }, []);
  return evidence;
}

/** Format a multiplier: 2 decimals < 10, 1 < 100, 0 above. */
const fmtX = (v: number): string =>
  v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);

/** Round a forecast max up to a display-friendly ceiling so the tail is visible. */
function niceCeil(v: number): number {
  const ladder = [10, 20, 50, 100, 150, 200, 300, 500, 1000];
  for (const s of ladder) if (s >= v) return s;
  return 1000;
}

const X_TICKS = [1, 2, 3, 5, 10, 20, 50, 100];
/** Big-hit thresholds (green leg of the ladder) and band entries (the tail leg). */
const CHART_LINES: Array<{ t: number; c: string; leg: "big" | "band" }> = [
  { t: 2, c: "#2bd97c", leg: "big" },
  { t: 5, c: "#2bd97c", leg: "big" },
  { t: 10, c: "#2bd97c", leg: "big" },
  { t: 20, c: "#38c7e8", leg: "band" },
  { t: 50, c: "#ffb020", leg: "band" },
  { t: 100, c: "#ffb020", leg: "band" },
];

export function FullForecast({ analysis }: { analysis: Analysis | null }) {
  const { rounds, multipliers, lastAddedAt } = useRounds();
  const seed = useSeedEvidence();

  // The verification replays the recorded tape walk-forward — at each
  // checkpoint the forecast is recomputed from the rounds BEFORE it, then
  // measured against the actual next round. That replay is O(n) and must not
  // run on every tick: key it to the checkpoint boundary (floor((n-warmup)/
  // step)) so it recomputes exactly when a new 15-round block lands — the
  // natural cadence of a per-checkpoint measurement.
  const WARMUP = 300, VSTEP = 15;
  const ckpt = multipliers.length > WARMUP
    ? Math.floor((multipliers.length - WARMUP) / VSTEP)
    : 0;
  const lastVerify = useRef<ForecastVerification | null>(null);
  const ckptRef = useRef(-1);
  const verification = useMemo<ForecastVerification | null>(() => {
    if (ckptRef.current === ckpt) return lastVerify.current;
    ckptRef.current = ckpt;
    lastVerify.current = verifyForecast(multipliers, { warmup: WARMUP, step: VSTEP });
    return lastVerify.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ckpt]);

  if (!analysis || multipliers.length < 10) {
    return (
      <div className="panel scanline relative overflow-hidden">
        <div className="panel-header"><span className="panel-title">Full forecast — expected next-round target</span></div>
        <div className="p-4 text-xs text-muted-foreground">need ≥10 rounds of tape for a calibrated forecast…</div>
      </div>
    );
  }

  const f = analysis.forecast;
  const sAt = analysis.survivalAt;

  return (
    <div className="panel scanline relative overflow-hidden ring-1 ring-primary/20">
      <div className="panel-header border-b border-primary/10 bg-primary/[0.03]">
        <span className="panel-title">Full forecast — expected next-round target</span>
        <span className="text-[10px] text-muted-foreground" key={lastAddedAt}>
          <span className="ticker-in">re-committed · round {rounds.length.toLocaleString()}</span>
        </span>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* LEFT — expected value + unlimited range + robust sub-mark + seed evidence */}
        <div className="space-y-3">
          <div>
            <p className="stat-label">next round — estimated value (E[X], live)</p>
            <div className="flex items-baseline gap-1.5">
              <AnimatedNumber
                key={lastAddedAt}
                value={analysis.expectedValue.ema}
                format={(v) => `${fmtX(v)}×`}
                className="ticker-in font-mono-num text-5xl font-bold leading-none"
              />
              <span
                className="font-mono-num text-sm font-semibold"
                style={{ color: analysis.expectedValue.deltaPerRound >= 0 ? "#2bd97c" : "#ff4d5e" }}
              >
                {analysis.expectedValue.deltaPerRound >= 0 ? "▲" : "▼"}
                {Math.abs(analysis.expectedValue.deltaPerRound).toFixed(4)}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              recency-weighted mean (half-life {analysis.expectedValue.halfLife} rounds) · re-commits every
              round (Δ shown) ·
              state <span className="font-mono-num" style={{ color: colorFor(f.p50) }}>{analysis.state}</span> ·
              median {fmtX(f.p50)}× (robust)
            </p>
          </div>

          {/* range stack — the full observed span is the unlimited range */}
          <div className="space-y-1.5">
            <RangeRow
              tone="tight"
              label="tight 50% range"
              lo={f.tight[0]}
              hi={f.tight[1]}
              sub={`IQR ${fmtX(f.iqr)}×`}
            />
            <RangeRow
              tone="full"
              label="full 90% range"
              lo={f.full[0]}
              hi={f.full[1]}
              sub={`p05–p95`}
            />
            <RangeRow
              tone="extreme"
              label="extreme 98% range"
              lo={f.extreme[0]}
              hi={f.extreme[1]}
              sub={`p01–p99 · tail reach`}
            />
            <RangeRow
              tone="extreme"
              label="unlimited range (observed)"
              lo={1}
              hi={analysis.expectedValue.max}
              sub={`no cap — max ${fmtX(analysis.expectedValue.max)}× on ${analysis.expectedValue.n.toLocaleString()} rounds`}
            />
          </div>

          {/* seed evidence — the estimate validated against prior data */}
          <SeedEvidenceRow seed={seed} ev={analysis.expectedValue} />

          {/* diagnostics */}
          <div className="grid grid-cols-3 gap-1.5">
            <Diag label="tail α" value={analysis.tailAlpha.toFixed(2)} hint="fair = 1.0" />
            <Diag label="P(≥2×)" value={`${(sAt(2) * 100).toFixed(1)}%`} />
            <Diag label="P(≥10×)" value={`${(sAt(10) * 100).toFixed(2)}%`} />
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            E[X] is the arithmetic mean of the whole tape — it carries the entire tail
            (no upper bound) and re-commits with every round. The median is the robust
            sub-mark: it barely moves by design. The tail α shows how heavy the right
            tail is: <span className="font-mono-num">α &gt; 1</span> decays faster than fair,
            <span className="font-mono-num"> α &lt; 1</span> fatter.
          </p>
        </div>

        {/* RIGHT — adaptive log-scale distribution + quantile ladder */}
        <div className="min-w-0 space-y-3">
          <ForecastChart analysis={analysis} f={f} maxX={niceCeil(Math.max(20, f.p99 * 1.15, 100))} />
          <QuantileLadder f={f} />
        </div>
      </div>

      {/* time to each magnitude — the whole ladder as one forecast idea */}
      <div className="border-t border-border/70 px-4 py-3">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="stat-label">time to each magnitude — recalibrated every round</p>
          <p className="text-[9px] text-muted-foreground">
            <span style={{ color: "#2bd97c" }}>● big hit</span>
            {"  "}
            <span style={{ color: "#38c7e8" }}>● moonshot</span>
            {"  "}
            <span style={{ color: "#ffb020" }}>● mega / cosmic</span>
            {"  "}
            <span>· one ladder from 2× to 1000×</span>
          </p>
        </div>
        <HitLadder big={analysis.hitEtas} band={analysis.bandHitEtas} />
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          One-round reach p drives a geometric wait (E = 1/p, CI ±1.5σ, p90 = −ln 0.1 / p). Bigger
          magnitudes ride the Hill tail, so 20×+ tiles are flagged “tail” when the tape has too few
          exceedances to trust the count directly — the ladder is one continuous forecast, not a
          separate big-hit read.
        </p>
      </div>

      {/* verification — the same forecast, measured against the rounds it predicted */}
      <VerificationSection v={verification} rounds={rounds.length} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

const RANGE_TONE: Record<string, string> = {
  tight: "#2bd97c",
  full: "#38c7e8",
  extreme: "#ffb020",
};

function RangeRow({ tone, label, lo, hi, sub }: { tone: string; label: string; lo: number; hi: number; sub: string }) {
  const c = RANGE_TONE[tone];
  return (
    <div className="flex items-center justify-between rounded border border-border/70 bg-secondary/30 px-2.5 py-1.5">
      <span className="text-[11px] text-muted-foreground">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
        {label}
      </span>
      <span className="font-mono-num text-sm font-semibold">
        {fmtX(lo)}–{fmtX(hi)}×
        <span className="ml-2 text-[10px] font-normal text-muted-foreground">{sub}</span>
      </span>
    </div>
  );
}

function Diag({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-border bg-secondary/40 px-2 py-1.5">
      <p className="stat-label">{label}</p>
      <p className="mt-0.5 font-mono-num text-sm font-semibold">{value}</p>
      {hint && <p className="text-[9px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The prior-data anchor: the seed/ corpus (91k past aviator rounds) is the
 * estimate's evidence. The live E[X] is VALID when it sits near the prior mean
 * (within ~30%), PENDING when the tape is still thin, and DRIFT when the live
 * regime has genuinely moved away from the historical one — in which case the
 * seed is context, not a target.
 */
function SeedEvidenceRow({ seed, ev }: { seed: SeedEvidence | null; ev: { full: number; n: number } }) {
  if (!seed || !seed.found) {
    return (
      <div className="rounded border border-border/70 bg-secondary/30 px-2.5 py-1.5">
        <p className="text-[10px] text-muted-foreground">
          seed evidence — <span className="text-foreground/70">no corpus found</span> (live-tape estimate only)
        </p>
      </div>
    );
  }
  const prior = seed.combined;
  const ratio = prior.mean > 0 ? ev.full / prior.mean : 1;
  const near = Math.abs(ratio - 1) <= 0.3;
  const thin = ev.n < 200;
  const verdict = near && !thin
    ? { label: "VALID — near prior mean", tone: "#2bd97c" }
    : thin
      ? { label: "pending — tape still thin", tone: "#ffb020" }
      : { label: `drift — live regime is ${ratio >= 1 ? "fatter" : "thinner"} than prior`, tone: "#38c7e8" };
  return (
    <div className="rounded border border-border/70 bg-secondary/30 px-2.5 py-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">seed evidence · prior data</p>
        <span className="font-mono-num text-[10px] font-semibold" style={{ color: verdict.tone }}>{verdict.label}</span>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        <div>
          <p className="font-mono-num text-sm font-semibold">{fmtX(prior.mean)}×</p>
          <p className="text-[9px] text-muted-foreground">prior mean · {prior.count.toLocaleString()} rounds</p>
        </div>
        <div>
          <p className="font-mono-num text-sm font-semibold">{fmtX(prior.median)}×</p>
          <p className="text-[9px] text-muted-foreground">prior median</p>
        </div>
        <div>
          <p className="font-mono-num text-sm font-semibold">{fmtX(prior.max)}×</p>
          <p className="text-[9px] text-muted-foreground">prior max (unlimited tail)</p>
        </div>
      </div>
      <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
        {seed.corpora.join(" + ")} — validated: whole-tape E[X] {fmtX(ev.full)}× vs prior {fmtX(prior.mean)}×
        (ratio {ratio.toFixed(2)}×). Prior p95 {fmtX(prior.p95)}×, p99 {fmtX(prior.p99)}×.
      </p>
    </div>
  );
}

const BAND_LEG_TONE: Record<string, string> = {
  big: "#2bd97c",
  "20x": "#38c7e8",
  "50x": "#ffb020",
  "100x": "#ffb020",
  "1000x": "#ff4d5e",
};

/**
 * One continuous "time to each magnitude" ladder: the big hits (2/5/10×) run
 * straight into the band entries (20/50/100/1000×) so the forecast reads as a
 * single idea — how long until the next 2×, then the next 10×, then the next
 * moonshot, then the next mega — rather than two unrelated strips.
 */
function HitLadder({ big, band }: {
  big: Analysis["hitEtas"];
  band: Analysis["bandHitEtas"];
}) {
  const tiles: Array<{ key: string; label: string; threshold: number; eta: number; pReach: number; p90: number; note: string | null; tone: string }> = [
    ...(["2x", "5x", "10x"] as BigHitKey[]).map((k) => ({
      key: k, label: k, threshold: big[k].threshold,
      eta: big[k].eta, pReach: big[k].pReach, p90: big[k].p90, note: big[k].note,
      tone: BAND_LEG_TONE.big,
    })),
    ...(["20x", "50x", "100x", "1000x"] as BandHitKey[]).map((k) => {
      const b = band[k];
      return {
        key: k, label: b.label, threshold: b.threshold,
        eta: b.eta.eta, pReach: b.eta.pReach, p90: b.eta.p90, note: b.eta.note,
        tone: BAND_LEG_TONE[k],
      };
    }),
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {tiles.map((t) => {
        const isBand = t.threshold >= 20;
        return (
          <div
            key={t.key}
            className="rounded border bg-secondary/40 px-2.5 py-2"
            style={{ borderColor: `${t.tone}44` }}
          >
            <p className="flex items-center justify-between text-[10px] uppercase tracking-widest" style={{ color: t.tone }}>
              <span>≥ {t.threshold}×</span>
              {isBand && <span className="text-[8px] normal-case tracking-normal text-muted-foreground">
                {t.key === "20x" ? "moonshot" : t.key === "50x" ? "mega" : t.key === "100x" ? "cosmic" : "jackpot"}
              </span>}
            </p>
            <p className="mt-0.5 flex items-baseline gap-1">
              <AnimatedNumber value={t.eta} format={(v) => fmtRounds(v)} className="font-mono-num text-xl font-semibold" />
              <span className="text-[9px] text-muted-foreground">rounds</span>
            </p>
            <p className="text-[9px] text-muted-foreground">
              p={(t.pReach * 100).toFixed(t.pReach < 0.01 ? 3 : 2)}% · p90 {fmtRounds(t.p90)}
              {t.note ? " · tail" : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

const pctS = (x: number) => `${(x * 100).toFixed(1)}%`;

function Pbar({ value, expected, noise }: { value: number; expected: number; noise: number }) {
  return (
    <div className="relative h-1.5 w-28 overflow-hidden rounded-full bg-secondary sm:w-36">
      <div
        className="absolute inset-y-0 rounded-full"
        style={{
          left: `${Math.min(96, value * 100)}%`,
          width: 4,
          background: Math.abs(value - expected) <= Math.max(0.08, noise) ? "#2bd97c" : "#ffb020",
        }}
      />
      <div
        className="absolute inset-y-0"
        style={{ left: `${Math.min(97, expected * 100 - 0.75)}%`, width: 1.5, background: "#38c7e8", opacity: 0.7 }}
      />
    </div>
  );
}

const GRADE_TONE: Record<string, { c: string; label: string }> = {
  calibrated: { c: "#2bd97c", label: "calibrated" },
  drift: { c: "#38c7e8", label: "tape drift" },
  miscalibrated: { c: "#ffb020", label: "miscalibrated" },
  noise: { c: "#8a93a6", label: "too few samples" },
};

/**
 * The measurement half of the forecast loop: the forecast as committed at each
 * checkpoint, replayed against the actual next round. Loose by construction —
 * each band is compared against the rate it PROMISES (50/90/98), a miss is
 * graded (near = inside the next wider band, not a failure), and the verdict
 * says WHY when it's off: tape drift vs miscalibration vs not-enough-data.
 */
function VerificationSection({ v, rounds }: { v: ForecastVerification | null; rounds: number }) {
  if (!v) {
    return (
      <div className="border-t border-border/70 px-4 py-3">
        <p className="stat-label">forecast verification — measured against the rounds it predicted</p>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          needs ≈350+ recorded rounds to start scoring (walk-forward: every forecast is recomputed
          from the tape before it, so nothing is graded with hindsight).
        </p>
      </div>
    );
  }
  const g = GRADE_TONE[v.verdict.grade];
  const c = v.coverage;
  const regime = v.regime;
  const alphaDir = regime.alphaDrift < -0.12 ? "fatter" : regime.alphaDrift > 0.12 ? "thinner" : "holding";
  return (
    <div className="border-t border-border/70 px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="stat-label">forecast verification — the loop, measured on {v.samples} checkpoints × every {v.step}th round</p>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: g.c, borderColor: `${g.c}55`, background: `${g.c}12` }}
        >
          {g.label}
        </span>
      </div>

      <p className="text-[11px] leading-relaxed text-foreground/85">{v.verdict.headline}</p>

      <div className="mt-2.5 grid gap-x-6 gap-y-1.5 md:grid-cols-2">
        {/* coverage vs the promised rates — the core of the loose scoring */}
        {(
          [
            ["tight 50% band", c.tight],
            ["full 90% band", c.full],
            ["extreme 98% band", c.extreme],
          ] as const
        ).map(([label, m]) => (
          <div key={label} className="flex items-center gap-2.5 rounded border border-border/60 bg-secondary/30 px-2.5 py-1.5">
            <span className="w-28 shrink-0 text-[10px] text-muted-foreground">{label}</span>
            <Pbar value={m.share} expected={m.expected} noise={m.noiseBar} />
            <span className="font-mono-num text-xs font-semibold">{pctS(m.share)}</span>
            <span className="text-[9px] text-muted-foreground">
              / {pctS(m.expected)} promised · near {m.near} · far {m.miss}
            </span>
            <span className="ml-auto font-mono-num text-[9px] text-muted-foreground">
              {m.error >= 0 ? "+" : ""}{pctS(m.error)}
            </span>
          </div>
        ))}
        {/* the target itself, as a calibrated probability */}
        <div className="flex items-center gap-2.5 rounded border border-border/60 bg-secondary/30 px-2.5 py-1.5">
          <span className="w-28 shrink-0 text-[10px] text-muted-foreground">P(≥2×) target</span>
          <span className="font-mono-num text-xs font-semibold">{v.medianBrier.toFixed(3)}</span>
          <span className="text-[9px] text-muted-foreground">
            Brier vs {v.fairBrier.toFixed(2)} fair-floor
          </span>
        </div>
      </div>

      {/* ETAs vs the waits that actually happened */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {v.wait.map((w) => {
          const r = w.ratio;
          const tone = w.realizedMean === 0 ? "#8a93a6" : Math.abs(r - 1) <= 0.35 ? "#2bd97c" : r > 1 ? "#ffb020" : "#38c7e8";
          const word = w.realizedMean === 0 ? "no hits yet" : Math.abs(r - 1) <= 0.35 ? "on time" : r > 1 ? "slower" : "faster";
          return (
            <div key={w.threshold} className="rounded border border-border/60 bg-secondary/30 px-2.5 py-1.5">
              <p className="text-[10px] text-muted-foreground">{w.label} wait</p>
              <p className="mt-0.5 font-mono-num text-sm font-semibold" style={{ color: tone }}>
                {w.realizedMean === 0 ? "—" : `${fmtRounds(w.realizedMean)} vs ${fmtRounds(w.predictedMean)}`}
              </p>
              <p className="text-[9px] text-muted-foreground">
                realized vs predicted · {w.realizedMean === 0 ? "waiting" : word}
                {w.realizedMean > 0 && ` (${r.toFixed(2)}×)`} · {w.hits} hits
              </p>
            </div>
          );
        })}
      </div>

      {/* recent regime vs the earlier baseline — the investigation trail */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span>
          recent 25% — tight <span className="font-mono-num text-foreground/85">{pctS(v.recent.tightShare)}</span> · full{" "}
          <span className="font-mono-num text-foreground/85">{pctS(v.recent.fullShare)}</span>
        </span>
        <span>
          regime — α <span className="font-mono-num text-foreground/85">{regime.alphaEarlier.toFixed(2)} → {regime.alphaNow.toFixed(2)}</span> (
          {alphaDir}) · P(≥2×){" "}
          <span className="font-mono-num text-foreground/85">{pctS(regime.pAbove2Earlier)} → {pctS(regime.pAbove2Now)}</span>
        </span>
        {v.verdict.grade === "drift" && <span className="text-muted-foreground/80">the 600-round window lags a moving tape — expectations re-baseline each round</span>}
      </div>

      {/* rectification notes — what to look at, in order */}
      {v.verdict.notes.length > 0 && (
        <div className="mt-2 space-y-1">
          {v.verdict.notes.map((n, i) => (
            <p key={i} className="flex gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
              <span className="shrink-0 text-primary/70">→</span>
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function QuantileLadder({ f }: { f: Analysis["forecast"] }) {
  const items: Array<{ q: string; v: number; hot?: boolean }> = [
    { q: "p01", v: f.p01 },
    { q: "p05", v: f.p05 },
    { q: "p10", v: f.p10 },
    { q: "p25", v: f.p25, hot: true },
    { q: "p50", v: f.p50, hot: true },
    { q: "p75", v: f.p75, hot: true },
    { q: "p90", v: f.p90 },
    { q: "p95", v: f.p95 },
    { q: "p99", v: f.p99 },
  ];
  return (
    <div>
      <p className="stat-label mb-1.5">quantile ladder — P(crash ≤ x)</p>
      <div className="grid grid-cols-9 gap-1">
        {items.map((it) => (
          <div
            key={it.q}
            className={`rounded border px-1 py-1 text-center ${it.hot ? "border-primary/40 bg-primary/[0.06]" : "border-border/70 bg-secondary/30"}`}
          >
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{it.q}</p>
            <p className="mt-0.5 font-mono-num text-[11px] font-semibold" style={{ color: it.hot ? colorFor(it.v) : undefined }}>
              {fmtX(it.v)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Adaptive log-x survival chart. Equal multiples per grid cell, so a 6x target
 * and a 55.98x target both sit comfortably on the same axis. Shows the full
 * calibrated curve, the tight band, the expected target, and the big-hit lines.
 */
function ForecastChart({ analysis, f, maxX }: { analysis: Analysis; f: Analysis["forecast"]; maxX: number }) {
  const pts = survivalCurveLog(analysis, maxX, 70);
  const W = 640, H = 220, PAD_L = 34, PAD_R = 14, PAD_T = 14, PAD_B = 26;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const X = (v: number) => PAD_L + (Math.log(Math.max(1, v)) / Math.log(maxX)) * plotW;
  const Y = (p: number) => PAD_T + (1 - Math.max(0, Math.min(1, p))) * plotH;

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(p.x).toFixed(1)},${Y(p.p).toFixed(1)}`).join(" ");
  const area = `${line} L${X(maxX).toFixed(1)},${Y(0).toFixed(1)} L${X(1).toFixed(1)},${Y(0).toFixed(1)} Z`;
  const targetC = colorFor(f.p50);
  const xTicks = X_TICKS.filter((t) => t <= maxX);

  return (
    <div className="rounded border border-border/70 bg-secondary/20 p-2">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <span className="stat-label">next-round distribution — log scale to {maxX}×</span>
        <span className="text-[9px] text-muted-foreground">curve = P(next survives past x)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Full forecast distribution">
        {/* y grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={PAD_L} x2={W - PAD_R} y1={Y(g)} y2={Y(g)} stroke="hsl(200 14% 15%)" strokeDasharray="2 5" />
            <text x={2} y={Y(g) + 3} fontSize="9" fill="hsl(160 8% 45%)">{(g * 100).toFixed(0)}%</text>
          </g>
        ))}
        {/* tight 50% band on the x axis */}
        <rect
          x={X(f.tight[0])} y={PAD_T} width={Math.max(0, X(f.tight[1]) - X(f.tight[0]))} height={plotH}
          fill={RANGE_TONE.tight} fillOpacity={0.10}
        />
        {/* full 90% band, lighter */}
        <rect
          x={X(f.full[0])} y={PAD_T} width={Math.max(0, X(f.full[1]) - X(f.full[0]))} height={plotH}
          fill={RANGE_TONE.full} fillOpacity={0.05}
        />
        {/* area + curve */}
        <path d={area} fill="#38c7e8" fillOpacity={0.08} />
        <path d={line} fill="none" stroke="#38c7e8" strokeWidth={1.6} />
        {/* the magnitude ladder: big-hit lines (green) + band entries (cyan/amber) */}
        {CHART_LINES.filter((l) => l.t <= maxX).map((l) => (
          <g key={l.t} opacity={l.leg === "band" ? 0.8 : 1}>
            <line x1={X(l.t)} x2={X(l.t)} y1={PAD_T} y2={PAD_T + plotH} stroke={l.c} strokeOpacity={0.4} strokeDasharray={l.leg === "band" ? "5 3" : "3 4"} />
            <text x={X(l.t) + 2} y={PAD_T + (l.leg === "band" ? 20 : 10)} fontSize="9" fill={l.c}>{l.t}×</text>
          </g>
        ))}
        {/* expected target marker */}
        <line x1={X(f.p50)} x2={X(f.p50)} y1={PAD_T} y2={PAD_T + plotH} stroke={targetC} strokeWidth={1.4} />
        <circle cx={X(f.p50)} cy={Y(0.5)} r={3.2} fill={targetC} />
        <text x={Math.min(W - PAD_R - 6, X(f.p50) + 5)} y={Y(0.5) - 6} fontSize="10" fontWeight="700" fill={targetC}>
          {fmtX(f.p50)}×
        </text>
        {/* x ticks (log) */}
        {xTicks.map((t) => (
          <text key={t} x={X(t)} y={H - 8} fontSize="9" fill="hsl(160 8% 45%)" textAnchor="middle">{t}×</text>
        ))}
      </svg>
    </div>
  );
}

const fmtRounds = (r: number) => (r < 99.5 ? r.toFixed(r < 20 ? 1 : 0) : "99+");
