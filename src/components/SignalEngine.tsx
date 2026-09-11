import { useMemo, useState } from "react";
import {
  Activity,
  Anchor,
  Crosshair,
  Flame,
  Gauge,
  Radar,
  Rocket,
  Waves,
  Zap,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { analyzeSignals } from "@/lib/signals";
import { type Round, type Signal, type SignalConfig, type SignalTypeId, DEFAULT_SENSITIVITY } from "@/lib/types";

interface TypeMeta {
  id: SignalTypeId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  textColor: string;
  bgClass: string;
  borderClass: string;
  barClass: string;
  description: string;
}

const TYPES: TypeMeta[] = [
  {
    id: "dry-rebound",
    label: "Dry-Zone Rebound",
    icon: Flame,
    textColor: "text-amber-400",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/30",
    barClass: "bg-amber-400",
    description: "Relief leg after a ≥2-round sub-1.5x dry zone",
  },
  {
    id: "streak-continuation",
    label: "Streak Continuation",
    icon: Zap,
    textColor: "text-green-400",
    bgClass: "bg-green-500/10",
    borderClass: "border-green-500/30",
    barClass: "bg-green-400",
    description: "≥3 consecutive wins above the 2x threshold",
  },
  {
    id: "moonshot-pressure",
    label: "Moonshot Pressure",
    icon: Rocket,
    textColor: "text-purple-400",
    bgClass: "bg-purple-500/10",
    borderClass: "border-purple-500/30",
    barClass: "bg-purple-400",
    description: "Momentum building toward a ≥5x event",
  },
  {
    id: "volatility-compression",
    label: "Volatility Compression",
    icon: Waves,
    textColor: "text-sky-400",
    bgClass: "bg-sky-500/10",
    borderClass: "border-sky-500/30",
    barClass: "bg-sky-400",
    description: "Quiet window coiled for a breakout leg",
  },
  {
    id: "momentum-build",
    label: "Momentum Build",
    icon: Gauge,
    textColor: "text-emerald-400",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/30",
    barClass: "bg-emerald-400",
    description: "Strong normalized 3-round upward drift",
  },
  {
    id: "floor-defend",
    label: "Floor Defense",
    icon: Anchor,
    textColor: "text-red-400",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/30",
    barClass: "bg-red-400",
    description: "Window pinned at the 1.0x distributional floor",
  },
];

const metaOf = (id: SignalTypeId) => TYPES.find((t) => t.id === id) ?? TYPES[0];

function ConfidenceBar({ value, barClass }: { value: number; barClass: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
      <div
        className={`h-full ${barClass} transition-all duration-500`}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  );
}

function RangeChip({ label, min, max, tone }: { label: string; min: number; max: number; tone: string }) {
  return (
    <div className={`rounded-lg border px-2.5 py-1.5 ${tone}`}>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-mono text-sm font-semibold text-white">
        {min.toFixed(2)}–{max.toFixed(2)}x
      </p>
    </div>
  );
}

function SignalCard({ signal }: { signal: Signal }) {
  const meta = metaOf(signal.type);
  const Icon = meta.icon;
  const statusBadge =
    signal.status === "hit"
      ? "bg-green-500/20 text-green-400"
      : signal.status === "miss"
        ? "bg-red-500/20 text-red-400"
        : signal.status === "expired"
          ? "bg-slate-600/40 text-slate-300"
          : "bg-primary/20 text-primary";

  return (
    <div className={`rounded-xl border p-4 ${meta.bgClass} ${meta.borderClass}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={`rounded-lg bg-slate-900/50 p-2 ${meta.textColor}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{meta.label}</p>
            <p className="font-mono text-[10px] text-slate-500">{signal.time}</p>
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${statusBadge}`}>
          {signal.status}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <RangeChip label="Entry" min={signal.entry.min} max={signal.entry.max} tone="border-slate-600/50 bg-slate-800/50" />
        <RangeChip label="Target" min={signal.target.min} max={signal.target.max} tone="border-green-600/30 bg-green-500/5" />
        <RangeChip label="Stop" min={signal.stop} max={signal.stop} tone="border-red-600/30 bg-red-500/5" />
      </div>

      <div className="mb-2">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-slate-400">
            confidence {signal.confidence} → <span className="text-white">{signal.adjustedConfidence}</span>
          </span>
          <span className="text-slate-500">horizon {signal.horizon}r</span>
        </div>
        <ConfidenceBar value={signal.adjustedConfidence} barClass={meta.barClass} />
      </div>

      {signal.resolvedMultiplier !== undefined && (
        <p className="font-mono text-[11px] text-slate-500">
          resolved @ {signal.resolvedMultiplier.toFixed(2)}x
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {signal.rationale.map((r, i) => (
          <li key={i} className="text-[11px] text-slate-400">
            · {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Accuracy ring: calibrated overall hit rate as an SVG dial. */
function AccuracyRing({ hitRate, calibration }: { hitRate: number; calibration: number }) {
  const pct = Math.round(hitRate * 100);
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - hitRate);

  return (
    <div className="relative h-24 w-24">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#334155" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="#0ea5e9"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold text-white">{pct}%</span>
        <span className="text-[9px] text-slate-500">cal ×{calibration}</span>
      </div>
    </div>
  );
}

export default function SignalEngine({
  data,
  fullView = false,
}: {
  data: Round[];
  fullView?: boolean;
}) {
  const [sensitivity, setSensitivity] = useState<number>(DEFAULT_SENSITIVITY);
  const config: SignalConfig = useMemo(() => ({ sensitivity }), [sensitivity]);
  const engine = useMemo(() => analyzeSignals(data, config), [data, config]);
  const minConfidence = Math.round(70 - sensitivity * 0.3);

  const activeSignals = engine.activeSignals;
  const recentResolved = engine.signals.filter((s) => s.status !== "active").slice(0, fullView ? 12 : 3);
  const maxBucketProb = Math.max(...engine.rangeBuckets.map((b) => b.probability), 1);

  const header = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <AccuracyRing hitRate={engine.overall.hitRate} calibration={engine.calibration} />
        <div>
          <h3 className="text-lg font-semibold text-white">Signal Engine</h3>
          <p className="text-xs text-slate-400">
            {engine.overall.hits}/{engine.overall.total} resolved hits ·{" "}
            {activeSignals.length} active · {data.length}-round window
          </p>
        </div>
      </div>

      <div className="w-full max-w-xs">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-slate-400">
            <Crosshair className="h-3.5 w-3.5 text-primary" /> Accuracy adjustment
          </span>
          <span className="font-mono text-white">
            sens {sensitivity} · ≥{minConfidence}
          </span>
        </div>
        <Slider
          value={[sensitivity]}
          onValueChange={(v: number[]) => setSensitivity(v[0] ?? DEFAULT_SENSITIVITY)}
          min={0}
          max={100}
          step={1}
        />
        <p className="mt-1.5 text-[10px] text-slate-500">
          Higher sensitivity fires more signals at lower raw confidence; calibration
          (×{engine.calibration}) scales confidence by realized hit rate.
        </p>
      </div>
    </div>
  );

  if (!fullView) {
    return (
      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Radar className="h-5 w-5 text-primary" /> Signals
          </h3>
          <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-semibold text-primary">
            {activeSignals.length} active
          </span>
        </div>

        {activeSignals.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">
            No signals active — engine watches all 6 trigger families.
          </p>
        ) : (
          <div className="space-y-3">
            {activeSignals.slice(0, 2).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = metaOf(s.type).icon;
                    return <Icon className={`h-4 w-4 ${metaOf(s.type).textColor}`} />;
                  })()}
                  <span className="text-sm text-slate-200">{metaOf(s.type).label}</span>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xs text-white">
                    {s.entry.min.toFixed(2)}–{s.entry.max.toFixed(2)}x → {s.target.min.toFixed(2)}x+
                  </p>
                  <p className="text-[10px] text-slate-500">conf {s.adjustedConfidence}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      {header}

      {/* Active signals */}
      <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Active Signals
      </h4>
      {activeSignals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-700 py-6 text-center text-sm text-slate-500">
          No active signals — waiting for trigger conditions on the live feed.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {activeSignals.map((s) => (
            <SignalCard key={s.id} signal={s} />
          ))}
        </div>
      )}

      {/* Accuracy adjustment panel */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            <Activity className="h-4 w-4" /> Accuracy by trigger family
          </h4>
          <div className="space-y-2.5">
            {engine.perType.map((t) => {
              const meta = metaOf(t.type);
              const pct = Math.round(t.hitRate * 100);
              return (
                <div key={t.type} className="flex items-center gap-3">
                  <span className={`w-40 truncate text-xs ${meta.textColor}`}>{meta.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700">
                    <div
                      className={`h-full ${meta.barClass} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-16 text-right font-mono text-xs text-slate-400">
                    {t.total ? `${pct}% (${t.total})` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Range probability ladder (full 1–20x)
          </h4>
          <div className="flex h-28 items-end gap-[3px]">
            {engine.rangeBuckets.map((b) => {
              const intensity = b.probability / maxBucketProb;
              return (
                <div
                  key={b.min}
                  className="flex-1 rounded-t bg-sky-500 transition-all duration-500"
                  style={{ height: `${Math.max(intensity * 100, 3)}%`, opacity: 0.25 + intensity * 0.75 }}
                  title={`${b.min.toFixed(1)}–${b.max.toFixed(1)}x: ${b.count} rounds · ${b.probability.toFixed(1)}%`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-slate-500">
            <span>1.0x</span>
            <span>10x</span>
            <span>20x</span>
          </div>
        </div>
      </div>

      {/* Resolution history */}
      <h4 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Resolution History
      </h4>
      {recentResolved.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-700 py-6 text-center text-sm text-slate-500">
          No resolved signals yet — history fills as rounds play out.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {recentResolved.map((s) => (
            <SignalCard key={s.id} signal={s} />
          ))}
        </div>
      )}
    </div>
  );
}
