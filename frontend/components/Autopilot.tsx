/**
 * Autopilot — port of momento/autopilot.py: weighted-signal decision blender
 * (ceiling .35 / gap swing .30 / linguistic .35), paper decision ledger with
 * walk-forward resolution, risk governor and equity curve.
 */
import { useMemo, useState } from "react";
import { useRounds } from "@/lib/store";
import { autopilotBacktest, AUTOPILOT_CONFIG, type AutopilotAction } from "@/lib/avfs";
import { AnimatedNumber } from "./charts";

const ACTION_TONE: Record<AutopilotAction, { color: string; label: string }> = {
  ENTER: { color: "#2bd97c", label: "ENTER" },
  PREPARE: { color: "#ffb020", label: "PREPARE" },
  STAND_DOWN: { color: "#6b7280", label: "STAND DOWN" },
};

const RISK_TONE: Record<string, string> = {
  normal: "#2bd97c", elevated: "#ffb020", critical: "#ff4d5e",
};

export function Autopilot() {
  const { multipliers } = useRounds();
  const [minConfidence, setMinConfidence] = useState(AUTOPILOT_CONFIG.minConfidence);
  const [baseSize, setBaseSize] = useState(AUTOPILOT_CONFIG.baseSize);
  const [target, setTarget] = useState(AUTOPILOT_CONFIG.target);

  const result = useMemo(
    () => (multipliers.length >= AUTOPILOT_CONFIG.window + 20
      ? autopilotBacktest(multipliers, { minConfidence, baseSize, target, window: AUTOPILOT_CONFIG.window })
      : null),
    [multipliers, minConfidence, baseSize, target],
  );

  const last = result?.decisions[result.decisions.length - 1] ?? null;
  const liveTone = last ? ACTION_TONE[last.action] : ACTION_TONE.STAND_DOWN;

  return (
    <div className="space-y-3">
      {/* config */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <span className="stat-label">risk governor</span>
          <Slider label={`min confidence ${(minConfidence * 100).toFixed(0)}%`} min={0.2} max={0.8} step={0.01}
            value={minConfidence} onChange={setMinConfidence} />
          <Slider label={`base size ${baseSize.toFixed(0)}`} min={1} max={100} step={1}
            value={baseSize} onChange={setBaseSize} />
          <Slider label={`exit target ${target.toFixed(1)}×`} min={1.2} max={5} step={0.1}
            value={target} onChange={setTarget} />
          <span className="text-[10px] text-muted-foreground">max risk/round 2% · daily loss limit 15% · 3-loss circuit breaker</span>
        </div>
      </div>

      {/* live decision + performance */}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="panel flex min-w-0 flex-col items-center justify-center p-5">
          <p className="stat-label">current instruction</p>
          {last ? (
            <>
              <div className="relative mt-4 flex h-36 w-36 items-center justify-center">
                <svg viewBox="0 0 120 120" className="absolute inset-0 -rotate-90">
                  <circle cx="60" cy="60" r="52" fill="none" stroke="hsl(200 14% 15%)" strokeWidth="8" />
                  <circle cx="60" cy="60" r="52" fill="none" stroke={liveTone.color} strokeWidth="8"
                    strokeDasharray={`${last.composite * 327} 327`} strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 6px ${liveTone.color}88)` }} />
                </svg>
                <div className="text-center">
                  <p className="font-mono-num text-2xl font-bold" style={{ color: liveTone.color }}>
                    {(last.composite * 100).toFixed(0)}
                  </p>
                  <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">composite</p>
                </div>
              </div>
              <p className="mt-3 rounded px-3 py-1 text-sm font-bold tracking-[0.2em]"
                style={{ color: liveTone.color, border: `1px solid ${liveTone.color}55`, background: `${liveTone.color}11` }}>
                {liveTone.label}
              </p>
              {last.action === "ENTER" && (
                <p className="mt-2 text-xs text-muted-foreground">stake {last.size.toFixed(1)} · exit {target.toFixed(1)}×</p>
              )}
            </>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">need ≥120 rounds</p>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="trades" value={result ? String(result.trades) : "—"} />
            <Metric label="win rate" value={result ? `${(result.winRate * 100).toFixed(1)}%` : "—"}
              tone={result && result.winRate >= 0.5 ? "#2bd97c" : undefined} />
            <Metric label="paper P&L" value={result ? result.totalPnl.toFixed(2) : "—"}
              tone={result && result.totalPnl > 0 ? "#2bd97c" : result && result.totalPnl < 0 ? "#ff4d5e" : undefined} />
            <Metric label="profit factor" value={result?.profitFactor?.toFixed(3) ?? "—"} />
            <Metric label="avg win / loss" value={result ? `${result.avgWin.toFixed(1)}/${result.avgLoss.toFixed(1)}` : "—"} />
            <Metric label="risk level" value={result?.riskLevel ?? "—"} tone={result ? RISK_TONE[result.riskLevel] : undefined} />
          </div>

          <div className="panel">
            <div className="panel-header">
              <span className="panel-title">decision ledger — last 12</span>
              <span className="text-[10px] text-muted-foreground">every decision resolved against the round that landed</span>
            </div>
            <div className="max-h-56 min-w-0 overflow-auto">
              {result ? (
                <table className="w-full min-w-[540px] text-left text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="px-3 py-1.5 font-medium">round</th>
                      <th className="px-3 py-1.5 font-medium">action</th>
                      <th className="px-3 py-1.5 font-medium">composite</th>
                      <th className="px-3 py-1.5 font-medium">stake</th>
                      <th className="px-3 py-1.5 font-medium">primary signal</th>
                      <th className="px-3 py-1.5 text-right font-medium">p&amp;l</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono-num">
                    {result.decisions.slice(-12).reverse().map((d) => (
                      <tr key={d.index} className="border-t border-border/50">
                        <td className="px-3 py-1.5 text-muted-foreground">#{d.index}</td>
                        <td className="px-3 py-1.5 font-semibold" style={{ color: ACTION_TONE[d.action].color }}>
                          {ACTION_TONE[d.action].label}
                        </td>
                        <td className="px-3 py-1.5">{(d.composite * 100).toFixed(0)}</td>
                        <td className="px-3 py-1.5">{d.size > 0 ? d.size.toFixed(1) : "—"}</td>
                        <td className="px-3 py-1.5 text-[10px] text-muted-foreground">{d.primary.replace("_", " ")}</td>
                        <td className="px-3 py-1.5 text-right"
                          style={{ color: d.pnl > 0 ? "#2bd97c" : d.pnl < 0 ? "#ff4d5e" : undefined }}>
                          {d.action === "ENTER" ? (d.pnl >= 0 ? `+${d.pnl.toFixed(2)}` : d.pnl.toFixed(2)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-4 text-xs text-muted-foreground">warming up…</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* equity curve */}
      {result && result.equity.length > 10 && (
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Autopilot equity — cumulative paper P&amp;L</span>
            <span className="text-[10px] text-muted-foreground">{result.trades} trades · {target.toFixed(1)}× exits</span>
          </div>
          <div className="p-2"><EquityLine equity={result.equity} /></div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Composite = (ceiling analyzer × 0.35 + gap swing × 0.30 + linguistic × 0.35), computed each round over the
        trailing {AUTOPILOT_CONFIG.window}-round window only. Entry requires composite ≥ {(minConfidence * 100).toFixed(0)}%;
        between 60% of threshold and the threshold the engine PREPAREs. Sizing is confidence-scaled
        ({baseSize} × composite). This is a decision recorder — it measures whether the platform's reasoning would have
        worked, nothing more.
      </p>
    </div>
  );
}

function EquityLine({ equity }: { equity: number[] }) {
  const W = 900, H = 160;
  const lo = Math.min(...equity, 0);
  const hi = Math.max(...equity, 0.01);
  const x = (i: number) => (i / (equity.length - 1)) * W;
  const y = (v: number) => 10 + (H - 20) * (1 - (v - lo) / Math.max(1e-9, hi - lo));
  const path = equity.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = equity[equity.length - 1] >= 0;
  const color = up ? "#2bd97c" : "#ff4d5e";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Autopilot equity curve">
      {lo < 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="hsl(160 8% 52%)" strokeDasharray="6 4" strokeOpacity={0.5} />}
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} style={{ filter: `drop-shadow(0 0 5px ${color}88)` }} />
    </svg>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="panel p-3.5">
      <p className="stat-label">{label}</p>
      <p className="font-mono-num mt-1 text-xl font-bold" style={tone ? { color: tone } : undefined}>{value}</p>
    </div>
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
        className="mt-1 w-36 accent-[#2bd97c]" />
    </label>
  );
}
