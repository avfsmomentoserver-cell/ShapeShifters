/**
 * Command Center — live scope, the committed predictor, ensemble, ETA.
 */
import { useMemo } from "react";
import { ScopeChart, SurvivalChart, ProbBar, AnimatedNumber, colorFor } from "./charts";
import { FullForecast } from "./FullForecast";
import { useRounds } from "@/lib/store";
import { analyze, candidates, probabilityAbove, type Analysis } from "@/lib/pipeline";
import { clamp } from "@/lib/stats";

const STATE_TONE: Record<string, { color: string; label: string }> = {
  Collapse: { color: "#ff4d5e", label: "COLLAPSE" },
  Shelf: { color: "#38c7e8", label: "SHELF" },
  Normal: { color: "#2bd97c", label: "NORMAL" },
  Ignition: { color: "#ffb020", label: "IGNITION" },
  Moonshot: { color: "#ffb020", label: "MOONSHOT" },
};

export function useAnalysis(): Analysis | null {
  const { multipliers } = useRounds();
  return useMemo(() => (multipliers.length >= 10 ? analyze(multipliers) : null), [multipliers]);
}

export function CommandCenter() {
  const { rounds, multipliers, liveFeedActive, simulatorRunning, setIsLive, settings, lastAddedAt, multiTimeframe } = useRounds();
  const analysis = useAnalysis();
  const top = analysis ? candidates(multipliers, analysis).slice(0, 3) : [];
  const last = rounds[rounds.length - 1];
  const tone = last ? STATE_TONE[analysis?.state ?? "Normal"] : null;
  const generatorAllowed = !settings || settings.simulatorEnabled;

  const last20 = multipliers.slice(-20);
  const hitRate2x = last20.length ? last20.filter((m) => m >= 2).length / last20.length : 0;
  
  // Use stacked multi-timeframe target when available, fallback to analysis target
  const displayTarget = multiTimeframe?.available ? multiTimeframe.stackedTarget : (analysis?.target ?? null);

  return (
    <div className="space-y-3">
      {/* status strip */}
      <div className="panel scanline relative overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${liveFeedActive ? "bg-primary live-dot" : "bg-muted-foreground"}`} />
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              {liveFeedActive ? "Live feed · files" : "Feed paused"}
            </span>
            <button
              onClick={() => setIsLive(!simulatorRunning)}
              disabled={!generatorAllowed && !simulatorRunning}
              title={generatorAllowed ? "toggle the provably-fair round generator" : "disabled — enable the generator in Settings; the tape is fed by the file watcher"}
              className={
                !generatorAllowed && !simulatorRunning
                  ? "cursor-not-allowed rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground/50"
                  : simulatorRunning
                    ? "rounded border border-destructive/50 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10"
                    : "rounded border border-border px-2 py-0.5 text-[11px] text-foreground/80 transition-colors hover:border-primary hover:text-primary"
              }
            >
              {simulatorRunning ? "stop generator" : "generator"}
            </button>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="stat-label">last</span>
            <AnimatedNumber
              key={lastAddedAt}
              value={last?.m ?? 0}
              format={(v) => `${v.toFixed(2)}×`}
              className="ticker-in font-mono-num text-xl font-semibold"
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="stat-label">state</span>
            <span className="font-mono-num text-sm font-semibold tracking-widest" style={{ color: tone?.color }}>
              {tone?.label ?? "—"}
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="stat-label">2× hit (20)</span>
            <span className="font-mono-num text-sm">{(hitRate2x * 100).toFixed(0)}%</span>
          </div>
          <div className="ml-auto flex items-baseline gap-2">
            <span className="stat-label">rounds</span>
            <span className="font-mono-num text-sm">{rounds.length.toLocaleString()}</span>
          </div>
        </div>
        {liveFeedActive && <div className="sweep pointer-events-none absolute bottom-0 left-0 h-px w-full" />}
      </div>

      {/* THE PREDICTOR */}
      <PredictorCardLazy />

      {/* THE FULL FORECAST — dedicated, prominent, full-range calibrated target */}
      <FullForecast analysis={analysis} />

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        {/* live scope */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Live scope — last 90 rounds</span>
            <span className="text-[10px] text-muted-foreground">amber blip = ≥10× moonshot</span>
          </div>
          <div className="p-2">
            <ScopeChart rounds={rounds} />
          </div>
        </div>

        {/* ensemble forecast */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Ensemble forecast — next round</span>
          </div>
          <div className="space-y-3 p-4">
            {top.length === 0 && <p className="text-xs text-muted-foreground">Need ≥10 rounds of tape.</p>}
            {top.map((c, i) => (
              <ProbBar
                key={c.state}
                label={`${i + 1}. ${c.state}  ${c.range[0]}–${c.range[1]}×`}
                value={c.probability}
                tone={c.state === "Collapse" ? "red" : c.state === "Moonshot" || c.state === "Ignition" ? "amber" : "green"}
                detail={`${(c.probability * 100).toFixed(1)}%`}
              />
            ))}
            {analysis && (
              <div className="border-t border-border/70 pt-3">
                <ProbBar label="P(≥2×)" value={probabilityAbove(analysis, 2, multipliers)} tone="green" />
                <div className="mt-2">
                  <ProbBar label="P(≥10× moonshot)" value={probabilityAbove(analysis, 10, multipliers)} tone="amber" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* ETA gauge */}
        <div className="panel">
          <div className="panel-header"><span className="panel-title">Crash-point ETA</span></div>
          <div className="p-4">
            {analysis ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-3">
                  <AnimatedNumber
                    value={displayTarget?.median ?? analysis.target.median}
                    format={(v) => `${v.toFixed(2)}×`}
                    className="stat-value"
                  />
                  <span className="text-xs text-muted-foreground">
                    p25 {(displayTarget?.p25 ?? analysis.target.p25).toFixed(2)} – p90 {(displayTarget?.p90 ?? analysis.target.p90).toFixed(2)}×
                  </span>
                  {multiTimeframe?.available && (
                    <span className="text-[10px] text-accent">· multi-timeframe</span>
                  )}
                </div>
                <div className="relative h-2 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="absolute inset-y-0 rounded-full"
                    style={{
                      background: "#38c7e8",
                      boxShadow: "0 0 8px #38c7e888",
                      left: `${clamp((((displayTarget?.p25 ?? analysis.target.p25) - 1) / 9) * 100, 0, 95)}%`,
                      width: `${clamp((((displayTarget?.p90 ?? analysis.target.p90) - (displayTarget?.p25 ?? analysis.target.p25)) / 9) * 100, 3, 100)}%`,
                    }}
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {multiTimeframe?.available 
                    ? "Stacked multi-timeframe target (large 5k + medium 2k + current 600 windows) · forex-style analysis" 
                    : `Median of the calibrated next-round curve (empirical bulk + Hill tail, last 600 rounds) · tail index α = ${analysis.tailAlpha.toFixed(2)} — a fair tape sits at 1.0.`
                  }
                </p>
              </div>
            ) : <p className="text-xs text-muted-foreground">warming up…</p>}
          </div>
        </div>

        {/* survival curve */}
        <div className="panel lg:col-span-2">
          <div className="panel-header">
            <span className="panel-title">Survival curve — P(next survives past x)</span>
          </div>
          <div className="p-2">
            {analysis ? <SurvivalChart analysis={analysis} /> : <div className="h-32" />}
          </div>
        </div>
      </div>

      <LastRounds />
    </div>
  );
}

import { PredictorCard } from "./PredictorCard";
function PredictorCardLazy() {
  return <PredictorCard />;
}

function LastRounds() {
  const { rounds } = useRounds();
  const tail = rounds.slice(-14).reverse();
  return (
    <div className="panel">
      <div className="panel-header"><span className="panel-title">Recent rounds — newest first</span></div>
      <div className="grid grid-cols-4 gap-px bg-border/50 sm:grid-cols-7 lg:grid-cols-14">
        {tail.map((r) => (
          <div key={r.id} className="flex flex-col items-center gap-0.5 bg-card px-1 py-2">
            <span className="font-mono-num text-sm font-semibold" style={{ color: colorFor(r.m) }}>
              {r.m.toFixed(2)}×
            </span>
            <span className="text-[8px] uppercase tracking-wider text-muted-foreground">
              {r.ts.slice(11, 16)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
