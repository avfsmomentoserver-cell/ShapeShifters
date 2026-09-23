/**
 * Moon Radar — pressure dial, ETA countdown to the next ≥10× event,
 * and a circular scope showing historic moonshot blips by gap size.
 */
import { useMemo } from "react";
import { AnimatedNumber } from "./charts";
import { useRounds } from "@/lib/store";
import { useAnalysis } from "./CommandCenter";
import { clamp, mean, quantile } from "@/lib/stats";

export function MoonshotRadar() {
  const { multipliers } = useRounds();
  const analysis = useAnalysis();

  const gapStats = useMemo(() => {
    const gaps: number[] = [];
    let last = -1;
    multipliers.forEach((m, i) => {
      if (m >= 10) {
        if (last >= 0) gaps.push(i - last);
        last = i;
      }
    });
    const sinceLast = last >= 0 ? multipliers.length - 1 - last : multipliers.length;
    const sorted = [...gaps].sort((a, b) => a - b);
    return {
      gaps,
      sinceLast,
      meanGap: mean(gaps),
      medianGap: quantile(sorted, 0.5),
      p90Gap: quantile(sorted, 0.9),
      maxSeen: gaps.length ? Math.max(...gaps) : 0,
    };
  }, [multipliers]);

  const pressure = analysis?.ladder.pressureScore ?? 0;
  const moonProb = analysis?.ladder.moonshotProbability ?? 0;
  const etaRounds = gapStats.meanGap > 0
    ? Math.max(0, gapStats.medianGap - gapStats.sinceLast) * (1 - pressure * 0.4)
    : 0;
  const overdueRatio = gapStats.medianGap > 0 ? gapStats.sinceLast / gapStats.medianGap : 0;
  const armed = pressure > 0.6 || overdueRatio > 1.2;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
        {/* radar scope */}
        <div className="panel flex items-center justify-center p-4">
          <RadarScope sinceLast={gapStats.sinceLast} p90Gap={gapStats.p90Gap} armed={armed} />
        </div>

        <div className="grid content-start gap-3">
          {/* ETA countdown */}
          <div className={`panel scanline relative overflow-hidden ${armed ? "shadow-[0_0_36px_rgba(255,176,32,0.15)]" : ""}`}>
            <div className="panel-header">
              <span className="panel-title">Moonshot ETA — next ≥10×</span>
              {armed && <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-accent">release armed</span>}
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <div>
                <p className="stat-label">ETA</p>
                <AnimatedNumber
                  value={etaRounds}
                  format={(v) => (v >= 1 ? `${v.toFixed(1)} rounds` : "imminent")}
                  className="font-mono-num text-3xl font-bold text-accent glow-amber"
                />
              </div>
              <div>
                <p className="stat-label">rounds since last moon</p>
                <p className="font-mono-num text-3xl font-bold">{gapStats.sinceLast}</p>
                <p className="text-[10px] text-muted-foreground">
                  median gap {gapStats.medianGap.toFixed(0)} · p90 {gapStats.p90Gap.toFixed(0)} · max {gapStats.maxSeen}
                </p>
              </div>
              <div>
                <p className="stat-label">overdue ratio</p>
                <AnimatedNumber
                  value={overdueRatio}
                  format={(v) => `${v.toFixed(2)}×`}
                  className={`font-mono-num text-3xl font-bold ${overdueRatio > 1.2 ? "text-accent" : overdueRatio > 0.8 ? "text-foreground" : "text-muted-foreground"}`}
                />
                <p className="text-[10px] text-muted-foreground">since-last ÷ median gap</p>
              </div>
            </div>
          </div>

          {/* pressure + probability */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Ladder pressure</span></div>
              <div className="p-4">
                <Dial value={pressure} label={pressure > 0.7 ? "critical" : pressure > 0.4 ? "building" : "calm"} tone={pressure > 0.7 ? "#ff4d5e" : pressure > 0.4 ? "#ffb020" : "#2bd97c"} />
              </div>
            </div>
            <div className="panel">
              <div className="panel-header"><span className="panel-title">Release probability</span></div>
              <div className="p-4">
                <Dial value={moonProb} label={moonProb > 0.6 ? "strong signal" : moonProb > 0.35 ? "watching" : "background"} tone="#38c7e8" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Gap ledger — every moonshot in the corpus</span>
          <span className="text-[10px] text-muted-foreground">{gapStats.gaps.length} events · bars = rounds between moons</span>
        </div>
        <div className="flex h-20 items-end gap-px overflow-hidden p-3">
          {gapStats.gaps.slice(-120).map((g, i) => (
            <div key={i} className="flex-1 rounded-t-sm"
              title={`gap: ${g} rounds`}
              style={{
                height: `${clamp((g / Math.max(1, gapStats.p90Gap)) * 100, 4, 100)}%`,
                background: g > gapStats.p90Gap ? "#ff4d5e" : g > gapStats.medianGap ? "#ffb020" : "#2bd97c",
                opacity: 0.85,
              }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RadarScope({ sinceLast, p90Gap, armed }: { sinceLast: number; p90Gap: number; armed: boolean }) {
  const angle = clamp(sinceLast / Math.max(1, p90Gap), 0, 1) * 270;
  const r = 92;
  const rad = ((angle - 225) * Math.PI) / 180;
  const hx = 110 + r * 0.78 * Math.cos(rad);
  const hy = 110 + r * 0.78 * Math.sin(rad);

  return (
    <svg viewBox="0 0 220 220" className="h-56 w-56" role="img" aria-label="Moonshot radar">
      <defs>
        <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={armed ? "#ffb020" : "#2bd97c"} stopOpacity="0.5" />
          <stop offset="100%" stopColor={armed ? "#ffb020" : "#2bd97c"} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[30, 55, 80].map((rr) => (
        <circle key={rr} cx="110" cy="110" r={rr} fill="none" stroke="hsl(200 14% 15%)" strokeDasharray="2 4" />
      ))}
      {Array.from({ length: 8 }, (_, i) => {
        const a = ((i * 45 - 225) * Math.PI) / 180;
        return <line key={i} x1="110" y1="110" x2={110 + 92 * Math.cos(a)} y2={110 + 92 * Math.sin(a)} stroke="hsl(200 14% 15%)" strokeDasharray="2 4" />;
      })}
      {/* sweep wedge */}
      <path d={`M110,110 L${110 + 92 * Math.cos(rad - 0.5)},${110 + 92 * Math.sin(rad - 0.5)} A92,92 0 0,1 ${110 + 92 * Math.cos(rad)},${110 + 92 * Math.sin(rad)} Z`} fill="url(#sweepGrad)" />
      {/* head marker */}
      <circle cx={hx} cy={hy} r="5" fill={armed ? "#ffb020" : "#2bd97c"} className={armed ? "glow-amber" : "glow-green"} />
      <text x="110" y="104" textAnchor="middle" fontSize="9" fill="hsl(160 8% 52%)">MOON SCOPE</text>
      <text x="110" y="122" textAnchor="middle" fontSize="16" fontWeight="bold" fill={armed ? "#ffb020" : "#2bd97c"}>
        {sinceLast}
      </text>
      <text x="110" y="136" textAnchor="middle" fontSize="8" fill="hsl(160 8% 45%)">rounds since ≥10×</text>
    </svg>
  );
}

function Dial({ value, label, tone }: { value: number; label: string; tone: string }) {
  const R = 44, C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 110 110" className="h-24 w-24 -rotate-90">
        <circle cx="55" cy="55" r={R} fill="none" stroke="hsl(200 14% 15%)" strokeWidth="9" />
        <circle cx="55" cy="55" r={R} fill="none" stroke={tone} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - clamp(value, 0, 1))}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.2,0.9,0.3,1)", filter: `drop-shadow(0 0 5px ${tone})` }} />
      </svg>
      <div>
        <AnimatedNumber value={value * 100} format={(v) => `${v.toFixed(0)}%`} className="font-mono-num text-2xl font-bold" />
        <p className="text-[10px] uppercase tracking-widest" style={{ color: tone }}>{label}</p>
      </div>
    </div>
  );
}
