import { useMemo } from "react";
import { Star, Target, TrendingUp, Zap } from "lucide-react";
import { analyzeMoonshots, predictMoonshot } from "@/lib/analysis";
import { MOONSHOT_THRESHOLD, type Round } from "@/lib/types";

export default function MoonshotForecaster({
  data,
  fullView = false,
}: {
  data: Round[];
  fullView?: boolean;
}) {
  const stats = useMemo(() => analyzeMoonshots(data), [data]);
  const prediction = useMemo(() => predictMoonshot(data), [data]);

  const ringColor =
    prediction.probability > 70
      ? "#a855f7"
      : prediction.probability > 40
        ? "#eab308"
        : "#22c55e";

  const momentumColor =
    prediction.momentum === "strong"
      ? "text-green-400"
      : prediction.momentum === "moderate"
        ? "text-yellow-400"
        : "text-slate-400";

  if (fullView) {
    return (
      <div className="card">
        <h3 className="mb-6 flex items-center text-xl font-bold text-white">
          <Zap className="mr-2 h-6 w-6 text-purple-400" />
          Moonshot Forecaster
        </h3>

        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="stat-card text-center">
            <p className="mb-2 text-xs text-slate-400">Total Moonshots</p>
            <p className="text-2xl font-bold text-purple-400">{stats.total}</p>
            <p className="text-xs text-slate-500">{stats.percentage}% of rounds</p>
          </div>
          <div className="stat-card text-center">
            <p className="mb-2 text-xs text-slate-400">Highest Multiplier</p>
            <p className="text-2xl font-bold text-yellow-400">{stats.highest.toFixed(2)}x</p>
          </div>
          <div className="stat-card text-center">
            <p className="mb-2 text-xs text-slate-400">Average</p>
            <p className="text-2xl font-bold text-green-400">{stats.average}x</p>
          </div>
          <div className="stat-card text-center">
            <p className="mb-2 text-xs text-slate-400">Clusters Found</p>
            <p className="text-2xl font-bold text-pink-400">{stats.clusters.length}</p>
          </div>
        </div>

        <div className="mb-8 rounded-xl border border-purple-500/30 bg-gradient-to-r from-purple-900/30 to-pink-900/30 p-6">
          <h4 className="mb-4 flex items-center text-lg font-semibold text-white">
            <Target className="mr-2 h-5 w-5 text-purple-400" />
            Next Moonshot Prediction
          </h4>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="text-center">
              <div className="relative mx-auto mb-3 h-24 w-24">
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
                    stroke={ringColor}
                    strokeWidth="3"
                    strokeDasharray={`${prediction.probability}, 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-white">{prediction.probability}%</span>
                  <Star
                    className={`h-4 w-4 ${
                      prediction.momentum === "strong" ? "text-yellow-400" : "text-slate-400"
                    }`}
                  />
                </div>
              </div>
              <p className="text-sm text-slate-400">Probability</p>
            </div>

            <div className="rounded-lg bg-slate-800/50 p-4 text-center">
              <p className="mb-2 text-xs text-slate-400">Estimated In</p>
              <p className="text-3xl font-bold text-purple-400">{prediction.estimatedRounds}</p>
              <p className="text-sm text-slate-400">rounds</p>
              <div className="mt-2 flex justify-center gap-1">
                {Array.from({ length: Math.min(prediction.estimatedRounds, 10) }).map((_, i) => (
                  <div key={i} className="h-3 w-1.5 rounded-full bg-purple-500" />
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg bg-slate-800/50 p-3">
                <p className="mb-1 text-xs text-slate-400">Momentum</p>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium capitalize ${momentumColor}`}>
                    {prediction.momentum}
                  </span>
                  <TrendingUp className={`h-4 w-4 ${momentumColor}`} />
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className={`h-full rounded-full ${
                      prediction.momentum === "strong"
                        ? "bg-crash-green"
                        : prediction.momentum === "moderate"
                          ? "bg-crash-yellow"
                          : "bg-slate-500"
                    }`}
                    style={{
                      width:
                        prediction.momentum === "strong"
                          ? "100%"
                          : prediction.momentum === "moderate"
                            ? "60%"
                            : "30%",
                    }}
                  />
                </div>
              </div>
              <div className="rounded-lg bg-slate-800/50 p-3">
                <p className="mb-1 text-xs text-slate-400">Confidence</p>
                <p
                  className={`text-sm font-bold capitalize ${
                    prediction.confidence === "high" ? "text-green-400" : "text-yellow-400"
                  }`}
                >
                  {prediction.confidence}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h4 className="mb-4 text-lg font-semibold text-white">
            Recent Moonshots (≥{MOONSHOT_THRESHOLD}x)
          </h4>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {stats.recent.length === 0 && (
              <p className="text-sm text-slate-500">No moonshots in the current window yet.</p>
            )}
            {stats.recent
              .slice()
              .reverse()
              .map((round) => (
                <div
                  key={round.id}
                  className="flex items-center justify-between rounded-lg border border-purple-500/20 bg-gradient-to-r from-purple-500/10 to-pink-500/10 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-purple-500/20 p-2">
                      <Zap className="h-5 w-5 text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm text-slate-400">{round.time}</p>
                      <p className="text-xs text-slate-500">{round.shape}</p>
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-purple-400">
                    {round.multiplier.toFixed(2)}x
                  </span>
                </div>
              ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Moonshot Alert</h3>
        <Zap className="h-5 w-5 text-purple-400" />
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-purple-500/10 p-3 text-center">
            <p className="mb-1 text-xs text-purple-400">Total</p>
            <p className="text-xl font-bold text-purple-400">{stats.total}</p>
          </div>
          <div className="rounded-lg bg-yellow-500/10 p-3 text-center">
            <p className="mb-1 text-xs text-yellow-400">Highest</p>
            <p className="text-xl font-bold text-yellow-400">{stats.highest.toFixed(1)}x</p>
          </div>
        </div>
        <div className="rounded-lg bg-slate-800/50 p-4">
          <p className="mb-2 text-xs text-slate-400">Next Moonshot Probability</p>
          <div className="flex items-center gap-3">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-700">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  prediction.probability > 70
                    ? "bg-crash-purple"
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
                  ? "text-purple-400"
                  : prediction.probability > 40
                    ? "text-yellow-400"
                    : "text-green-400"
              }`}
            >
              {prediction.probability}%
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Est. in {prediction.estimatedRounds} rounds · {prediction.momentum} momentum
          </p>
        </div>
      </div>
    </div>
  );
}
