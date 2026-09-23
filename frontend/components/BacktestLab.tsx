/**
 * Strategy Lab — walk-forward backtest with equity curve and controls.
 * Quarter-Kelly staking on +EV exceedance bets, scored over the corpus.
 */
import { useMemo, useState } from "react";
import { AnimatedNumber } from "./charts";
import { useRounds } from "@/lib/store";
import { backtest, DEFAULT_CONFIG, type BacktestConfig, type BacktestResult } from "@/lib/backtest";
import { clamp } from "@/lib/stats";

const PRESETS: Array<{ label: string; cfg: Partial<BacktestConfig> }> = [
  { label: "Safe · 2× quarter-Kelly", cfg: { threshold: 2, kellyFraction: 0.25, minEdge: 0.05 } },
  { label: "Balanced · 3× quarter-Kelly", cfg: { threshold: 3, kellyFraction: 0.25, minEdge: 0.03 } },
  { label: "Aggressive · 5× half-Kelly", cfg: { threshold: 5, kellyFraction: 0.5, minEdge: 0.02 } },
  { label: "Moon chase · 10×", cfg: { threshold: 10, kellyFraction: 0.5, minEdge: 0 } },
];

export function BacktestLab() {
  const { multipliers } = useRounds();
  const [cfg, setCfg] = useState<BacktestConfig>(DEFAULT_CONFIG);

  const result = useMemo<BacktestResult | null>(
    () => (multipliers.length >= cfg.warmup + 60 ? backtest(multipliers, cfg) : null),
    [multipliers, cfg],
  );

  const positive = (result?.roi ?? 0) > 0;

  return (
    <div className="space-y-3">
      {/* controls */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Strategy Lab — walk-forward backtest</span>
          <span className="text-[10px] text-muted-foreground">only data before each round is used</span>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setCfg({ ...DEFAULT_CONFIG, ...p.cfg })}
                className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                  cfg.threshold === p.cfg.threshold && cfg.kellyFraction === p.cfg.kellyFraction
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Slider label={`cash-out ${cfg.threshold.toFixed(1)}×`} min={1.2} max={10} step={0.1}
              value={cfg.threshold} onChange={(v) => setCfg({ ...cfg, threshold: v })} />
            <Slider label={`kelly fraction ${(cfg.kellyFraction * 100).toFixed(0)}%`} min={0.05} max={1} step={0.05}
              value={cfg.kellyFraction} onChange={(v) => setCfg({ ...cfg, kellyFraction: v })} />
            <Slider label={`min edge ${(cfg.minEdge * 100).toFixed(0)}%`} min={0} max={0.15} step={0.01}
              value={cfg.minEdge} onChange={(v) => setCfg({ ...cfg, minEdge: v })} />
          </div>
        </div>
      </div>

      {result ? (
        <>
          {/* headline stats */}
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="final bankroll" value={result.finalBankroll} format={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              tone={positive ? "#2bd97c" : "#ff4d5e"} sub={`start ${result.config.startBankroll.toLocaleString()}`} />
            <Stat label="ROI" value={result.roi * 100} format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`}
              tone={positive ? "#2bd97c" : "#ff4d5e"} sub="over full corpus" />
            <Stat label="bets placed" value={result.bets} format={(v) => v.toLocaleString()} sub={`${result.hits} won`} />
            <Stat label="hit rate" value={result.hitRate * 100} format={(v) => `${v.toFixed(1)}%`}
              sub={`avg stake ${result.avgStake.toFixed(1)}`} />
            <Stat label="max drawdown" value={result.maxDrawdown * 100} format={(v) => `${v.toFixed(1)}%`} tone="#ff4d5e"
              sub={`worst loss run ${result.longestLossRun}`} />
            <Stat label="bets / round" value={result.bets / Math.max(1, multipliers.length - result.config.warmup)}
              format={(v) => v.toFixed(2)} sub="selectivity" />
          </div>

          {/* equity curve */}
          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">Equity curve</span>
              <span className="text-[10px] text-muted-foreground">
                {result.config.threshold.toFixed(1)}× cash-out · {(result.config.kellyFraction * 100).toFixed(0)}% kelly · edge ≥ {(result.config.minEdge * 100).toFixed(0)}%
              </span>
            </div>
            <EquityCurve result={result} />
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Paper P&amp;L only. At a {result.config.threshold.toFixed(1)}× cash-out the fair probability with a 4% house edge is
            {" "}{((1 / result.config.threshold) * 0.96 * 100).toFixed(1)}% — the strategy bets only when the live engines
            price the round above that with the required edge. Past simulated performance says nothing about future rounds;
            the house edge is relentless by design.
          </p>
        </>
      ) : (
        <div className="panel"><div className="p-4 text-xs text-muted-foreground">need ≥{cfg.warmup + 60} rounds to backtest — keep the live feed running.</div></div>
      )}
    </div>
  );
}

function EquityCurve({ result }: { result: BacktestResult }) {
  const pts = result.equity;
  if (pts.length < 2) return <div className="h-40" />;
  const W = 900, H = 220, PAD_L = 46, PAD_B = 20, PAD_T = 12;
  const lo = Math.min(...pts.map((p) => p.bankroll)) * 0.98;
  const hi = Math.max(...pts.map((p) => p.bankroll)) * 1.02;
  const x = (i: number) => PAD_L + (i / (pts.length - 1)) * (W - PAD_L - 12);
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - (v - lo) / Math.max(1e-9, hi - lo));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.bankroll).toFixed(1)}`).join(" ");
  const start = pts[0].bankroll;
  const up = pts[pts.length - 1].bankroll >= start;
  const color = up ? "#2bd97c" : "#ff4d5e";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Equity curve">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => {
        const v = lo + (hi - lo) * g;
        return (
          <g key={g}>
            <line x1={PAD_L} x2={W - 12} y1={y(v)} y2={y(v)} stroke="hsl(200 14% 15%)" strokeDasharray="2 5" />
            <text x={4} y={y(v) + 3.5} fontSize="9" fill="hsl(160 8% 45%)">{v.toFixed(0)}</text>
          </g>
        );
      })}
      <line x1={PAD_L} x2={W - 12} y1={y(start)} y2={y(start)} stroke="hsl(160 8% 52%)" strokeDasharray="6 4" strokeOpacity={0.6} />
      <path d={`${path} L${x(pts.length - 1)},${y(lo)} L${PAD_L},${y(lo)} Z`} fill={color} fillOpacity={0.07} stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.6}
        style={{ filter: `drop-shadow(0 0 6px ${color}88)` }} />
    </svg>
  );
}

function Slider({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="stat-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="mt-1 w-full accent-[#2bd97c]" />
    </label>
  );
}

function Stat({ label, value, format, tone, sub }: {
  label: string; value: number; format: (v: number) => string; tone?: string; sub?: string;
}) {
  return (
    <div className="panel p-3.5">
      <p className="stat-label">{label}</p>
      <AnimatedNumber value={value} format={format}
        className={`font-mono-num mt-1 block text-xl font-bold ${tone ? "" : ""}`}
      />
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      {tone && <div className="mt-1 h-0.5 rounded-full" style={{ background: tone, boxShadow: `0 0 6px ${tone}` }} />}
    </div>
  );
}

export const _clamp = clamp;
