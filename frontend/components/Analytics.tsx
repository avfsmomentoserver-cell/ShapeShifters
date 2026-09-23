/**
 * Analytics — curve shapes, Markov streaks, dry zones (GMM-lite), regimes.
 */
import { Histogram } from "./charts";
import { useAnalysis } from "./CommandCenter";
import { useRounds } from "@/lib/store";

const SHAPE_TONE: Record<string, string> = { exponential: "#2bd97c", power_law: "#ffb020", logistic: "#38c7e8" };
const REGIME_LABEL: Record<string, string> = { low_vol: "LOW VOLATILITY", moderate: "MODERATE", high_vol: "HIGH VOLATILITY" };
const REGIME_TONE: Record<string, string> = { low_vol: "#2bd97c", moderate: "#38c7e8", high_vol: "#ff4d5e" };

export function CurveShapes() {
  const analysis = useAnalysis();
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Curve shape classification</span>
        <span className="text-[10px] text-muted-foreground">R² fit over transformed space</span>
      </div>
      <div className="p-4">
        {!analysis ? <p className="text-xs text-muted-foreground">warming up…</p> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.entries(analysis.shapeDist).map(([shape, share]) => (
                <div key={shape} className="rounded-md border border-border bg-secondary/40 p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs uppercase tracking-widest" style={{ color: SHAPE_TONE[shape] }}>{shape.replace("_", " ")}</span>
                    <span className="font-mono-num text-lg font-semibold">{(share * 100).toFixed(0)}%</span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-background">
                    <div className="h-full transition-all duration-500" style={{ width: `${share * 100}%`, background: SHAPE_TONE[shape] }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Each recent crash trajectory is fitted to exponential (a·eᵇᵗ), power-law (a·tᵏ) and logistic (logit) forms;
              the distribution shows which functional family the tape currently follows. Exponential dominance is the
              textbook signature; power-law drift signals fat-tail risk.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function Streaks() {
  const analysis = useAnalysis();
  const { multipliers } = useRounds();
  const [ww, wl, lw, ll] = analysis?.markov.transition ?? [0, 0, 0, 0];
  const totalFromWin = ww + wl, totalFromLoss = lw + ll;
  const cells = [
    { label: "win → win", value: totalFromWin ? ww / totalFromWin : 0.5, color: "#2bd97c" },
    { label: "win → loss", value: totalFromWin ? wl / totalFromWin : 0.5, color: "#ff4d5e" },
    { label: "loss → loss", value: totalFromLoss ? ll / totalFromLoss : 0.5, color: "#ff4d5e" },
    { label: "loss → win", value: totalFromLoss ? lw / totalFromLoss : 0.5, color: "#2bd97c" },
  ];

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Markov streak engine — win = ≥2×</span>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-secondary/40 p-3">
            <p className="stat-label">current streak</p>
            <p className="mt-1 font-mono-num text-2xl font-semibold">
              {analysis ? `${analysis.markov.currentStreak} ${analysis.markov.streakType === "win" ? "wins" : "losses"}` : "—"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              continuation P = {analysis ? `${(analysis.markov.pContinue * 100).toFixed(1)}%` : "—"}
              {" · "}expected run = {analysis ? analysis.markov.expectedDuration.toFixed(1) : "—"} rounds
              {" · "}historical max = {analysis?.markov.historicalMax ?? "—"}
            </p>
          </div>
          <Histogram multipliers={multipliers.slice(-500)} />
        </div>
        <div className="grid grid-cols-2 content-start gap-2">
          {cells.map((c) => (
            <div key={c.label} className="rounded-md border border-border p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{c.label}</p>
              <p className="mt-1 font-mono-num text-xl font-semibold" style={{ color: c.color }}>
                {(c.value * 100).toFixed(1)}%
              </p>
            </div>
          ))}
          <p className="col-span-2 text-[11px] leading-relaxed text-muted-foreground">
            Empirical first-order transition matrix over win/loss states (threshold 2×). Expected run length
            follows the geometric distribution E[duration] = 1 / (1 − p_continue).
          </p>
        </div>
      </div>
    </div>
  );
}

export function DryZones() {
  const analysis = useAnalysis();
  const clusters = analysis?.clusters ?? [];
  const toneFor = (label: string) => (label === "floor" ? "#ff4d5e" : label === "mid" ? "#38c7e8" : "#ffb020");

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Dry zones — log-space clustering (GMM-lite)</span>
        <span className="text-[10px] text-muted-foreground">last 500 rounds</span>
      </div>
      <div className="p-4">
        {clusters.length === 0 ? <p className="text-xs text-muted-foreground">warming up…</p> : (
          <div className="grid gap-3 sm:grid-cols-3">
            {clusters.map((c) => (
              <div key={c.id} className="rounded-md border border-border bg-secondary/40 p-3" style={{ borderColor: `${toneFor(c.label)}44` }}>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: toneFor(c.label) }}>
                    {c.label === "floor" ? "DRY ZONE" : c.label === "mid" ? "MID BAND" : "MOON CLUSTER"}
                  </span>
                  <span className="font-mono-num text-sm text-muted-foreground">{(c.proportion * 100).toFixed(0)}%</span>
                </div>
                <p className="mt-1 font-mono-num text-2xl font-semibold">{c.meanMultiplier.toFixed(2)}×</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {c.count} rounds · range {c.minMultiplier.toFixed(2)}–{c.maxMultiplier.toFixed(2)}×
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Regimes() {
  const analysis = useAnalysis();
  if (!analysis) return <div className="panel"><div className="p-4 text-xs text-muted-foreground">warming up…</div></div>;
  const r = analysis.regimes;
  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">Regime detector — rolling volatility bands</span>
        {r.transitionDetected && <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">regime shift detected</span>}
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[auto_1fr]">
        <div className="rounded-md border border-border bg-secondary/40 p-4">
          <p className="stat-label">current regime</p>
          <p className="mt-1 text-lg font-semibold tracking-widest" style={{ color: REGIME_TONE[r.current] }}>
            {REGIME_LABEL[r.current]}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">persistence {(r.stayProbability * 100).toFixed(0)}%</p>
        </div>
        <div className="space-y-2">
          {Object.entries(r.distribution).map(([k, v]) => (
            <div key={k} className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">{REGIME_LABEL[k]}</span>
                <span className="font-mono-num">{(v * 100).toFixed(1)}%</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-secondary">
                <div className="h-full transition-all duration-500" style={{ width: `${v * 100}%`, background: REGIME_TONE[k] }} />
              </div>
            </div>
          ))}
          <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
            Deterministic volatility-band fallback of the Gaussian HMM: classify each 50-round window by
            σ vs μ±σ of the rolling volatility series.
          </p>
        </div>
      </div>
    </div>
  );
}
