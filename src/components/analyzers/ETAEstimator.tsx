import { RefreshCw, Clock, TrendingUp, AlertCircle } from "lucide-react";
import { calculateEta } from "@/lib/analysis";
import type { Round } from "@/lib/types";

export default function ETAEstimator({
  currentMultiplier,
  history,
  fullView = false,
}: {
  currentMultiplier: number;
  history: Round[];
  fullView?: boolean;
}) {
  const eta = calculateEta(currentMultiplier, history);
  const probColor = (p: number) =>
    p > 70 ? "text-red-400" : p > 40 ? "text-yellow-400" : "text-green-400";
  const barColor = (p: number) =>
    p > 70 ? "bg-crash-red" : p > 40 ? "bg-crash-yellow" : "bg-crash-green";

  if (fullView) {
    return (
      <div className="card">
        <h3 className="mb-6 flex items-center text-xl font-bold text-white">
          <RefreshCw className="mr-2 h-6 w-6 text-primary" />
          ETA Estimator
        </h3>

        <div className="mb-8 rounded-xl border border-primary/30 bg-gradient-to-r from-sky-900/30 to-slate-900/30 p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="mb-1 text-sm text-slate-400">Current Multiplier</p>
              <p className="text-4xl font-bold text-white">{currentMultiplier.toFixed(2)}x</p>
            </div>
            <div className="text-right">
              <p className="mb-1 text-sm text-slate-400">Estimated Crash</p>
              <p className="text-4xl font-bold text-primary">
                {eta.estimatedCrash !== null ? `${eta.estimatedCrash.toFixed(2)}x` : "--"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-slate-800/50 p-4 text-center">
              <Clock className="mx-auto mb-2 h-5 w-5 text-primary" />
              <p className="mb-1 text-xs text-slate-400">Time Remaining</p>
              <p className="text-xl font-bold text-white">
                {eta.timeRemaining !== null ? `${eta.timeRemaining}s` : "--"}
              </p>
            </div>
            <div className="rounded-lg bg-slate-800/50 p-4 text-center">
              <TrendingUp className="mx-auto mb-2 h-5 w-5 text-green-400" />
              <p className="mb-1 text-xs text-slate-400">Confidence</p>
              <p
                className={`text-xl font-bold capitalize ${
                  eta.confidence === "high"
                    ? "text-green-400"
                    : eta.confidence === "medium"
                      ? "text-yellow-400"
                      : "text-red-400"
                }`}
              >
                {eta.confidence}
              </p>
            </div>
            <div className="rounded-lg bg-slate-800/50 p-4 text-center">
              <AlertCircle className="mx-auto mb-2 h-5 w-5 text-yellow-400" />
              <p className="mb-1 text-xs text-slate-400">Volatility</p>
              <p className="text-xl font-bold text-yellow-400">
                {eta.stdDev !== undefined ? `±${eta.stdDev}` : "--"}
              </p>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <h4 className="mb-4 text-lg font-semibold text-white">
            Crash Probability by Multiplier
          </h4>
          <div className="space-y-3">
            {eta.crashProbability?.map((item) => (
              <div key={item.multiplier} className="flex items-center gap-4">
                <span className="w-16 font-mono text-sm text-slate-300">{item.multiplier}x</span>
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor(parseFloat(item.probability))}`}
                    style={{ width: `${item.probability}%` }}
                  />
                </div>
                <span className={`w-12 text-right text-sm font-bold ${probColor(parseFloat(item.probability))}`}>
                  {item.probability}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <p className="mb-1 text-sm font-medium text-white">Estimation Method</p>
              <p className="text-xs text-slate-400">
                Using {eta.method.replace(/_/g, " ")} with {history.length} historical rounds.
                Predictions become more accurate with larger sample sizes. See the Research tab
                for full derivations (§6).
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Live ETA</h3>
        <RefreshCw className="h-5 w-5 text-primary" />
      </div>
      <div className="space-y-4">
        <div className="rounded-lg border border-primary/30 bg-gradient-to-r from-sky-900/30 to-slate-900/30 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="mb-1 text-xs text-slate-400">Current</p>
              <p className="text-2xl font-bold text-white">{currentMultiplier.toFixed(2)}x</p>
            </div>
            <div className="text-right">
              <p className="mb-1 text-xs text-slate-400">Est. Crash</p>
              <p className="text-2xl font-bold text-primary">
                {eta.estimatedCrash !== null ? `${eta.estimatedCrash.toFixed(2)}x` : "--"}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-800/50 p-3 text-center">
            <Clock className="mx-auto mb-1 h-4 w-4 text-primary" />
            <p className="mb-1 text-xs text-slate-400">Time Left</p>
            <p className="text-lg font-bold text-white">
              {eta.timeRemaining !== null ? `${eta.timeRemaining}s` : "--"}
            </p>
          </div>
          <div className="rounded-lg bg-slate-800/50 p-3 text-center">
            <TrendingUp className="mx-auto mb-1 h-4 w-4 text-green-400" />
            <p className="mb-1 text-xs text-slate-400">Confidence</p>
            <p
              className={`text-lg font-bold capitalize ${
                eta.confidence === "high"
                  ? "text-green-400"
                  : eta.confidence === "medium"
                    ? "text-yellow-400"
                    : "text-red-400"
              }`}
            >
              {eta.confidence}
            </p>
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/50 p-3">
          <p className="mb-2 text-xs text-slate-400">Next Targets</p>
          <div className="flex justify-between">
            {eta.crashProbability?.slice(0, 5).map((item) => (
              <div key={item.multiplier} className="text-center">
                <p className="font-mono text-xs text-slate-500">{item.multiplier}x</p>
                <p className={`text-sm font-bold ${probColor(parseFloat(item.probability))}`}>
                  {item.probability}%
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
