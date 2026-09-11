import { useMemo } from "react";
import {
  Activity,
  Anchor,
  Gauge,
  Minus,
  TrendingUp,
  Waves,
  Zap,
} from "lucide-react";
import { type Round, type ShapeFeatures, type ShapeId } from "@/lib/types";

interface ShapeMeta {
  id: ShapeId;
  label: string;
  range: string;
  color: string;
  textColor: string;
  bgColor: string;
  borderColor: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

/**
 * Feature-rich taxonomy: the source's five multiplier bands extended with
 * context shapes detected from rolling features (z-score outlier, local
 * turbulence, median lock, low-volatility grind).
 */
const SHAPES: ShapeMeta[] = [
  {
    id: "early-crash",
    label: "Early Crash",
    range: "< 1.5x",
    color: "bg-crash-red",
    textColor: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    icon: Activity,
    description: "Quick crashes indicating high volatility",
  },
  {
    id: "standard",
    label: "Standard",
    range: "1.5–2.5x",
    color: "bg-crash-yellow",
    textColor: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    icon: TrendingUp,
    description: "Normal distribution pattern",
  },
  {
    id: "extended",
    label: "Extended",
    range: "2.5–5x",
    color: "bg-crash-green",
    textColor: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    icon: TrendingUp,
    description: "Above average performance",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    range: "5–10x",
    color: "bg-crash-purple",
    textColor: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    icon: Zap,
    description: "High multiplier clusters detected",
  },
  {
    id: "extreme",
    label: "Extreme",
    range: "> 10x",
    color: "bg-crash-pink",
    textColor: "text-pink-400",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/30",
    icon: Zap,
    description: "Rare extreme events",
  },
  {
    id: "spike",
    label: "Spike",
    range: "z ≥ 2.2 outlier",
    color: "bg-fuchsia-500",
    textColor: "text-fuchsia-400",
    bgColor: "bg-fuchsia-500/10",
    borderColor: "border-fuchsia-500/30",
    icon: Gauge,
    description: "Z-score outlier burst vs the rolling mean",
  },
  {
    id: "grinder",
    label: "Grinder",
    range: "1.2–1.5x, low σ",
    color: "bg-teal-500",
    textColor: "text-teal-400",
    bgColor: "bg-teal-500/10",
    borderColor: "border-teal-500/30",
    icon: Anchor,
    description: "Low-volatility grind near the distributional floor",
  },
  {
    id: "volatile",
    label: "Volatile",
    range: "σ/μ > 0.75",
    color: "bg-orange-500",
    textColor: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    icon: Waves,
    description: "Turbulent local window, wide round-to-round swings",
  },
  {
    id: "plateau",
    label: "Plateau",
    range: "±15% of median",
    color: "bg-blue-500",
    textColor: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    icon: Minus,
    description: "Median-locked flat drift with muted momentum",
  },
];

interface ShapeAggregate {
  count: number;
  avgZ: number;
  avgVol: number;
  avgMomentum: number;
  avgPercentile: number;
}

/** Per-shape feature aggregates over the current window. */
function aggregateShapes(data: Round[]): Record<string, ShapeAggregate> {
  const acc: Record<string, { n: number; z: number; v: number; m: number; p: number }> = {};
  for (const r of data) {
    const f: ShapeFeatures = r.features;
    const a = (acc[r.shape] ??= { n: 0, z: 0, v: 0, m: 0, p: 0 });
    a.n++;
    a.z += f.zScore;
    a.v += f.localVolatility;
    a.m += f.momentum;
    a.p += f.percentile;
  }
  const out: Record<string, ShapeAggregate> = {};
  for (const [shape, a] of Object.entries(acc)) {
    out[shape] = {
      count: a.n,
      avgZ: parseFloat((a.z / a.n).toFixed(2)),
      avgVol: parseFloat((a.v / a.n).toFixed(2)),
      avgMomentum: parseFloat((a.m / a.n).toFixed(2)),
      avgPercentile: parseFloat((a.p / a.n).toFixed(2)),
    };
  }
  return out;
}

function FeatureChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-900/50 px-2 py-1 text-center">
      <p className="text-[9px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-mono text-xs font-semibold text-slate-200">{value}</p>
    </div>
  );
}

export default function CurveShapeAnalyzer({
  data,
  fullView = false,
  onSelectShape,
}: {
  data: Round[];
  fullView?: boolean;
  onSelectShape?: (shape: ShapeId) => void;
}) {
  const shapeStats = useMemo(() => aggregateShapes(data), [data]);

  const total = data.length || 1;
  const colorOf = (shape: string) =>
    SHAPES.find((s) => s.id === shape)?.color ?? "bg-slate-500";
  const textColorOf = (shape: string) =>
    SHAPES.find((s) => s.id === shape)?.textColor ?? "text-slate-400";

  if (fullView) {
    return (
      <div className="card">
        <h3 className="mb-1 text-xl font-bold text-white">Curve Shape Analysis</h3>
        <p className="mb-6 text-xs text-slate-500">
          9-shape taxonomy: 5 multiplier bands + 4 context shapes from rolling
          z-score, local volatility (σ/μ), momentum and percentile features.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SHAPES.map((shape) => {
            const agg = shapeStats[shape.id];
            const count = agg?.count ?? 0;
            const percentage = ((count / total) * 100).toFixed(1);
            const Icon = shape.icon;
            return (
              <button
                key={shape.id}
                onClick={() => onSelectShape?.(shape.id)}
                className={`${shape.bgColor} ${shape.borderColor} rounded-xl border p-5 text-left transition-transform duration-200 hover:scale-105`}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className={`${shape.textColor} rounded-lg bg-slate-900/40 p-2`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <span className={`text-2xl font-bold ${shape.textColor}`}>{percentage}%</span>
                </div>
                <h4 className="mb-1 text-lg font-semibold text-white">{shape.label}</h4>
                <p className="mb-2 font-mono text-sm text-slate-400">{shape.range}</p>
                <p className="text-xs text-slate-500">{shape.description}</p>

                {agg && (
                  <div className="mt-3 grid grid-cols-4 gap-1.5 border-t border-slate-700/50 pt-3">
                    <FeatureChip label="z̄" value={agg.avgZ.toFixed(2)} />
                    <FeatureChip label="σ/μ" value={agg.avgVol.toFixed(2)} />
                    <FeatureChip label="mom" value={agg.avgMomentum.toFixed(2)} />
                    <FeatureChip label="pct" value={agg.avgPercentile.toFixed(2)} />
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-400">
                  <span className="font-semibold text-white">{count}</span> rounds detected
                </p>
              </button>
            );
          })}
        </div>

        <div className="mt-8">
          <h4 className="mb-4 text-lg font-semibold text-white">Distribution Timeline</h4>
          <div className="flex h-48 items-end gap-1">
            {data.slice(-50).map((round) => (
              <div
                key={round.id}
                className={`${colorOf(round.shape)} flex-1 rounded-t transition-all duration-500`}
                style={{ height: `${Math.min(round.multiplier * 10, 100)}%` }}
                title={`${round.time}: ${round.multiplier}x (${round.shape}) · z=${round.features.zScore} σ/μ=${round.features.localVolatility}`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-500">
            <span>50 rounds ago</span>
            <span>Now</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Curve Shapes</h3>
        <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-xs font-semibold text-primary">
          {Object.keys(shapeStats).length}/9 active
        </span>
      </div>
      <div className="space-y-3">
        {SHAPES.filter((s) => (shapeStats[s.id]?.count ?? 0) > 0).map((shape) => {
          const count = shapeStats[shape.id]?.count ?? 0;
          const percentage = Math.round((count / total) * 100);
          return (
            <div key={shape.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${shape.color}`} />
                <span className="text-sm text-slate-300">{shape.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className={`h-full ${shape.color} transition-all duration-500`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <span className={`w-10 text-right text-sm font-medium ${textColorOf(shape.id)}`}>
                  {percentage}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
