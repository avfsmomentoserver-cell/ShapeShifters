import { useMemo } from "react";
import { AlertTriangle, Clock, TrendingDown } from "lucide-react";
import { analyzeDryZones, predictDryZone } from "@/lib/analysis";
import { SHAPE_THRESHOLDS, type Round } from "@/lib/types";

function ProbabilityRing({ value, color }: { value: number; color: string }) {
  return (
    <div className="relative mx-auto h-20 w-20">
      <svg className="h-full w-full" viewBox="0 0 36 36">
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke="#334155"
          strokeWidth="3"
        />
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={`${value}, 100`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-bold text-white">{value}%</span>
      </div>
    </div>
  );
}

export default function DryZonePredictor({
  data,
  fullView = false,
}: {
  data: Round[];
  fullView?: boolean;
}) {
  const dryZones = useMemo(() => analyzeDryZones(data), [data]);
  const prediction = useMemo(() => predictDryZone(data), [data]);
  const activeZone = dryZones.find((z) => z.active);

  const totalDryRounds = data.filter(
    (r) => r.multiplier < SHAPE_THRESHOLDS.earlyCrash,
  ).length;
  const dryPercentage = data.length
    ? ((totalDryRounds / data.length) * 100).toFixed(1)
    : "0.0";

  const ringColor =
    prediction.probability > 70
      ? "#ef4444"
      : prediction.probability > 40
        ? "#eab308"
        : "#22c55e";

  if (fullView) {
    return (
      <div className="card">
        <h3 className="mb-6 text-xl font-bold text-white">Dry Zone Predictor</h3>

        {activeZone && (
          <div className="mb-8 rounded-xl border-2 border-orange-500/30 bg-orange-500/10 p-6">
            <div className="flex items-center gap-4">
              <div className="rounded-full bg-orange-500/20 p-4">
                <AlertTriangle className="live-indicator h-8 w-8 text-orange-400" />
              </div>
              <div className="flex-1">
                <h4 className="mb-1 text-lg font-bold text-orange-400">
                  Active Dry Zone Detected
                </h4>
                <p className="text-sm text-slate-300">
                  {activeZone.count} consecutive low multipliers (&lt;1.5x)
                </p>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-orange-400">{activeZone.count}</p>
                <p className="text-xs text-slate-400">rounds</p>
              </div>
            </div>
          </div>
        )}

        <div className="mb-8 rounded-xl border border-slate-700 bg-gradient-to-r from-slate-800 to-slate-900 p-6">
          <h4 className="mb-4 flex items-center text-lg font-semibold text-white">
            <Clock className="mr-2 h-5 w-5 text-primary" />
            Next Dry Zone Prediction
          </h4>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-lg bg-slate-800/50 p-4 text-center">
              <p className="mb-2 text-xs text-slate-400">Probability</p>
              <ProbabilityRing value={prediction.probability} color={ringColor} />
            </div>
            <div className="rounded-lg bg-slate-800/50 p-4 text-center">
              <p className="mb-2 text-xs text-slate-400">Estimated In</p>
              <p className="text-3xl font-bold text-primary">{prediction.estimatedRounds}</p>
              <p className="text-sm text-slate-400">rounds</p>
            </div>
            <div className="rounded-lg bg-slate-800/50 p-4 text-center">
              <p className="mb-2 text-xs text-slate-400">Confidence</p>
              <p
                className={`text-2xl font-bold capitalize ${
                  prediction.confidence === "high" ? "text-green-400" : "text-yellow-400"
                }`}
              >
                {prediction.confidence}
              </p>
              <p className="text-sm text-slate-400">based on {data.length} rounds</p>
            </div>
          </div>
        </div>

        <div>
          <h4 className="mb-4 text-lg font-semibold text-white">Historical Dry Zones</h4>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {dryZones.length === 0 && (
              <p className="text-sm text-slate-500">No dry zones in the current window.</p>
            )}
            {dryZones
              .slice()
              .reverse()
              .map((zone, i) => (
                <div
                  key={`${zone.start}-${i}`}
                  className={`flex items-center justify-between rounded-lg p-3 ${
                    zone.active
                      ? "border border-orange-500/30 bg-orange-500/10"
                      : "bg-slate-800/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <TrendingDown
                      className={`h-5 w-5 ${zone.active ? "text-orange-400" : "text-slate-400"}`}
                    />
                    <span className="text-sm text-slate-300">
                      Zone #{dryZones.length - i}
                    </span>
                    {zone.active && (
                      <span className="live-indicator rounded-full bg-orange-500/20 px-2 py-0.5 text-xs text-orange-400">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex gap-1">
                      {Array.from({ length: Math.min(zone.count, 15) }).map((_, j) => (
                        <div key={j} className="h-3 w-2 rounded-sm bg-orange-500" />
                      ))}
                    </div>
                    <span
                      className={`font-bold ${zone.active ? "text-orange-400" : "text-slate-300"}`}
                    >
                      {zone.count} rounds
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="stat-card text-center">
            <p className="mb-2 text-xs text-slate-400">Total Dry Rounds</p>
            <p className="text-2xl font-bold text-orange-400">{totalDryRounds}</p>
          </div>
          <div className="stat-card text-center">
            <p className="mb-2 text-xs text-slate-400">Dry Zone Frequency</p>
            <p className="text-2xl font-bold text-orange-400">{dryPercentage}%</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Dry Zone Alert</h3>
        <AlertTriangle
          className={`h-5 w-5 ${activeZone ? "live-indicator text-orange-400" : "text-slate-400"}`}
        />
      </div>
      <div className="space-y-4">
        {activeZone ? (
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-400">Active Dry Zone</p>
                <p className="text-xs text-slate-400">{activeZone.count} low multipliers</p>
              </div>
              <span className="text-2xl font-bold text-orange-400">{activeZone.count}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
            <p className="text-sm font-medium text-green-400">No Active Dry Zone</p>
            <p className="text-xs text-slate-400">Normal pattern detected</p>
          </div>
        )}
        <div className="rounded-lg bg-slate-800/50 p-4">
          <p className="mb-2 text-xs text-slate-400">Next Zone Probability</p>
          <div className="flex items-center gap-3">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-700">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  prediction.probability > 70
                    ? "bg-crash-red"
                    : prediction.probability > 40
                      ? "bg-crash-yellow"
                      : "bg-crash-green"
                }`}
                style={{ width: `${prediction.probability}%` }}
              />
            </div>
            <span
              className={`text-sm font-bold ${
                prediction.probability > 70
                  ? "text-red-400"
                  : prediction.probability > 40
                    ? "text-yellow-400"
                    : "text-green-400"
              }`}
            >
              {prediction.probability}%
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Est. in {prediction.estimatedRounds} rounds
          </p>
        </div>
      </div>
    </div>
  );
}
