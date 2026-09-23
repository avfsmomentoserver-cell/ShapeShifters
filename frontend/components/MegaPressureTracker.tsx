/**
 * Mega Pressure Tracker — port of invent/middleware/megaPressure.ts +
 * features/pressure. Pressure between mega rounds, ETA with confidence
 * intervals, bankroll requirements, chase strategies.
 */
import { useMemo, useState } from "react";
import { useRounds } from "@/lib/store";
import {
  detectCeilings, ceilingPressure, computeExhaustion, scanMoonshot,
  megaPressure, megaEta, bankrollPlan, chasePlan, lingBand,
  type ChaseStrategyName,
} from "@/lib/avfs";
import { AnimatedNumber, ProbBar } from "./charts";
import { clamp } from "@/lib/stats";

const MEGA_RANGES = [
  { label: "Mega 50×+", min: 50 },
  { label: "Moon 10×+", min: 10 },
  { label: "Cosmic 100×+", min: 100 },
];

function pressureTone(p: number): string {
  return p >= 0.7 ? "#ff4d5e" : p >= 0.4 ? "#ffb020" : "#2bd97c";
}

export function MegaPressureTracker() {
  const { multipliers, rounds } = useRounds();
  const [megaMin, setMegaMin] = useState(50);
  const [chase, setChase] = useState<ChaseStrategyName>("moderate");

  const timestamps = useMemo(() => rounds.map((r) => r.ts), [rounds]);
  const mp = useMemo(() => megaPressure(multipliers, megaMin, timestamps), [multipliers, megaMin, timestamps]);
  const eta = useMemo(() => megaEta(multipliers, mp, megaMin, timestamps), [multipliers, mp, megaMin, timestamps]);
  const bank = useMemo(() => bankrollPlan(mp), [mp]);
  const plan = useMemo(() => chasePlan(mp, chase), [mp, chase]);

  // AVFS pressure stack: ceilings → gap pressure → exhaustion → moonshot scan
  const pressure = useMemo(() => {
    if (multipliers.length < 40) return null;
    const w = multipliers.slice(-250);
    const ceilings = detectCeilings(w);
    const cp = ceilingPressure(w, ceilings);
    const ph: number[] = [];
    for (let i = 40; i < w.length; i += 10) {
      const win = w.slice(Math.max(0, i - 120), i);
      ph.push(ceilingPressure(win, detectCeilings(win)).totalPressure);
    }
    const ex = computeExhaustion(w, ph, ceilings);
    const nearest = cp.dominant?.distance ?? -1;
    const scan = scanMoonshot(w, cp.releaseProbability, ex.compression.current, nearest, 0.5 + ex.combined * 0.2);
    return { ceilings, cp, ex, scan };
  }, [multipliers]);

  const tone = pressureTone(mp.currentPressure);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {MEGA_RANGES.map((r) => (
          <button key={r.min} onClick={() => setMegaMin(r.min)}
            className={`rounded border px-3 py-1.5 text-xs transition-colors ${
              megaMin === r.min ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            }`}>
            {r.label}
          </button>
        ))}
        <span className="ml-auto self-center text-[10px] text-muted-foreground">
          {mp.megaCount} mega events in corpus
        </span>
      </div>

      {/* pressure gauge + factors */}
      <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
        <div className="panel flex flex-col items-center p-5">
          <PressureGauge value={mp.currentPressure} tone={tone} />
          <p className="mt-3 text-center text-[11px] uppercase tracking-widest" style={{ color: tone }}>
            {mp.currentPressure >= 0.7 ? "critical pressure" : mp.currentPressure >= 0.4 ? "building" : "calm field"}
          </p>
        </div>
        <div className="panel p-4">
          <p className="stat-label">pressure factors — energy .3 / shape .2 / momentum .2 / time .2 / gap .1</p>
          <div className="mt-3 space-y-2.5">
            <ProbBar label="energy buildup (≥5× share, 50r)" value={mp.energyBuildup} tone="green" detail={`${(mp.energyBuildup * 100).toFixed(0)}%`} />
            <ProbBar label="shape consistency (trend repeats)" value={mp.shapeConsistency} tone="green" detail={`${(mp.shapeConsistency * 100).toFixed(0)}%`} />
            <ProbBar label="band momentum (upward moves)" value={mp.bandMomentum} tone="cyan" detail={`${(mp.bandMomentum * 100).toFixed(0)}%`} />
            <ProbBar label="time decay since last mega" value={mp.timeDecay} tone="amber" detail={`${(mp.timeDecay * 100).toFixed(0)}%`} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/70 pt-3 text-center">
            <div>
              <p className="stat-label">avg mega gap</p>
              <AnimatedNumber value={mp.avgMegaGap} format={(v) => `${v.toFixed(0)} r`} className="stat-value" />
            </div>
            <div>
              <p className="stat-label">minis per mega</p>
              <AnimatedNumber value={mp.avgMiniMoonshots} format={(v) => v.toFixed(2)} className="stat-value" />
            </div>
            <div>
              <p className="stat-label">current band</p>
              <p className="font-mono-num mt-1 text-lg font-bold text-foreground">{lingBand(multipliers[multipliers.length - 1] ?? 0)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ETA + resistance stack */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-4">
          <p className="stat-label">mega ETA — next {megaMin}×+ round</p>
          <div className="mt-2 flex items-baseline gap-3">
            <AnimatedNumber value={eta.roundsEta} format={(v) => `${v.toFixed(0)} rounds`} className="stat-value" />
            <span className="text-xs text-muted-foreground">≈ {eta.timeEtaMinutes} min</span>
          </div>
          <div className="mt-3 space-y-2">
            {([["p50", eta.ci.p50, "#2bd97c"], ["p75", eta.ci.p75, "#ffb020"], ["p95", eta.ci.p95, "#ff4d5e"]] as const).map(([k, [lo, hi], c]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-8 text-[10px] uppercase text-muted-foreground">{k}</span>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div className="absolute inset-y-0 rounded-full" style={{ background: c, left: `${clamp((lo / 400) * 100, 0, 95)}%`, width: `${clamp(((hi - lo) / 400) * 100, 2, 100)}%`, boxShadow: `0 0 6px ${c}66` }} />
                </div>
                <span className="font-mono-num w-16 text-right text-[11px] text-foreground">{lo}–{hi}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{eta.methodology}</p>
        </div>

        <div className="panel p-4">
          <p className="stat-label">resistance stack — ceilings &amp; exhaustion</p>
          {pressure ? (
            <div className="mt-3 space-y-2">
              {pressure.cp.byCeiling.slice(0, 4).map((c) => (
                <ProbBar key={c.level}
                  label={`${c.level.toFixed(2)}× ${c.archetype} · ${c.touches} touches · Δ${c.distance}`}
                  value={c.pressure / 100} tone={c.pressure > 70 ? "red" : "amber"}
                  detail={`${c.pressure.toFixed(0)}`} />
              ))}
              {pressure.cp.byCeiling.length === 0 && <p className="text-xs text-muted-foreground">no active ceilings above tape</p>}
              <div className="grid grid-cols-3 gap-2 border-t border-border/70 pt-2.5 text-center">
                <MiniStat label="exhaustion" value={`${(pressure.ex.combined * 100).toFixed(0)}%`} tone={pressure.ex.combined >= 0.55 ? "#ff4d5e" : "#2bd97c"} />
                <MiniStat label="imminence" value={pressure.ex.imminence} />
                <MiniStat label="release prob" value={`${(pressure.cp.releaseProbability * 100).toFixed(0)}%`} />
              </div>
              <p className="text-[10px] text-muted-foreground">
                moonshot scan confidence {(pressure.scan.confidence * 100).toFixed(0)}% · band trend {pressure.scan.factors.bandTrend}
                {pressure.scan.imminent && <span className="ml-1 font-semibold text-[#ff4d5e]">· RELEASE IMMINENT</span>}
              </p>
            </div>
          ) : <p className="mt-3 text-xs text-muted-foreground">warming up…</p>}
        </div>
      </div>

      {/* bankroll + chase */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-4">
          <p className="stat-label">bankroll requirements</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{bank.recommendation} · recovery ≈ {bank.recoveryRounds} rounds</p>
          <div className="mt-3 space-y-2">
            {(["conservative", "moderate", "aggressive"] as const).map((k) => (
              <div key={k} className={`flex items-center justify-between rounded border px-3 py-2 text-xs ${bank[k].recommended ? "border-primary/60 bg-primary/5" : "border-border"}`}>
                <span className="capitalize text-foreground">{k}{bank[k].recommended && <span className="ml-2 text-[10px] text-primary">← recommended</span>}</span>
                <span className="font-mono-num text-muted-foreground">
                  risk {(bank[k].riskPct * 100).toFixed(1)}% · bankroll ≥ {bank[k].minBankroll.toLocaleString()} · max loss {bank[k].maxLoss}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-4">
          <div className="flex items-center justify-between">
            <p className="stat-label">chase strategy</p>
            <div className="flex gap-1">
              {(["conservative", "moderate", "aggressive"] as const).map((s) => (
                <button key={s} onClick={() => setChase(s)}
                  className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wider ${chase === s ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{plan.description}</p>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <MiniStat label="success" value={`${(plan.successRate * 100).toFixed(0)}%`} />
            <MiniStat label="avg profit" value={plan.avgProfit.toFixed(1)} tone="#2bd97c" />
            <MiniStat label="max loss" value={plan.maxLoss.toLocaleString()} tone="#ff4d5e" />
            <MiniStat label="risk/reward" value={plan.riskReward.toFixed(3)} />
          </div>
          <div className="mt-3 flex h-16 items-end gap-px">
            {plan.betSequence.slice(0, 40).map((b) => (
              <div key={b.round} className="flex-1 rounded-t bg-primary/70" style={{ height: `${clamp((b.bet / plan.maxLoss) * 300, 2, 100)}%` }} title={`round ${b.round}: bet ${b.bet}`} />
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">bet escalation over {plan.params.maxChaseRounds} rounds ×{plan.params.growth} growth</p>
        </div>
      </div>

      {mp.miniPatterns.length > 0 && (
        <div className="panel p-4">
          <p className="stat-label">mini patterns</p>
          <div className="mt-2 space-y-1.5">
            {mp.miniPatterns.map((p) => (
              <div key={p.description} className="flex items-center justify-between text-xs">
                <span className="text-foreground">{p.description}</span>
                <span className="font-mono-num text-primary">{(p.confidence * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PressureGauge({ value, tone }: { value: number; tone: string }) {
  const size = 200, cx = size / 2, cy = size / 2 + 20, r = 78;
  const a0 = Math.PI, a1 = 0;
  const a = a0 + (a1 - a0) * clamp(value, 0, 1);
  const arc = (from: number, to: number) => {
    const x0 = cx + r * Math.cos(from), y0 = cy - r * Math.sin(from);
    const x1 = cx + r * Math.cos(to), y1 = cy - r * Math.sin(to);
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  };
  return (
    <svg width={size} height={size * 0.72} viewBox={`0 0 ${size} ${size * 0.72}`} role="img" aria-label="Mega pressure gauge">
      <path d={arc(a0, a1)} fill="none" stroke="hsl(200 14% 15%)" strokeWidth={14} strokeLinecap="round" />
      <path d={arc(a0, a)} fill="none" stroke={tone} strokeWidth={14} strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 8px ${tone}99)` }} />
      <text x={cx} y={cy - 14} textAnchor="middle" fill={tone} fontSize="34" fontWeight="700" fontFamily="var(--font-mono, monospace)">
        {(value * 100).toFixed(0)}
      </text>
      <text x={cx} y={cy + 6} textAnchor="middle" fill="hsl(160 8% 45%)" fontSize="10" letterSpacing="2">PRESSURE</text>
    </svg>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="stat-label">{label}</p>
      <p className="font-mono-num text-sm font-bold" style={tone ? { color: tone } : undefined}>{value}</p>
    </div>
  );
}
