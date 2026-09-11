import { useMemo } from "react";
import { Play, TrendingDown, TrendingUp } from "lucide-react";
import { analyzeStreaks } from "@/lib/analysis";
import { WIN_THRESHOLD, type Round } from "@/lib/types";

export default function StreakDetector({
  data,
  fullView = false,
}: {
  data: Round[];
  fullView?: boolean;
}) {
  const stats = useMemo(() => analyzeStreaks(data), [data]);
  const { currentStreak, hotStreaks, coldStreaks, maxWinStreak, maxLossStreak, streaks } = stats;

  const colorFor = (type: "win" | "loss") =>
    type === "win" ? "text-green-400" : "text-red-400";
  const bgFor = (type: "win" | "loss") =>
    type === "win" ? "bg-green-500/10" : "bg-red-500/10";

  if (fullView) {
    return (
      <div className="card">
        <h3 className="mb-6 text-xl font-bold text-white">Streak Analysis</h3>

        <div
          className={`mb-8 rounded-xl border-2 p-6 ${
            currentStreak.type === "win"
              ? "border-green-500/30 bg-green-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`rounded-full p-4 ${currentStreak.type === "win" ? "bg-green-500/20" : "bg-red-500/20"}`}>
                {currentStreak.type === "win" ? (
                  <TrendingUp className="h-8 w-8 text-green-400" />
                ) : (
                  <TrendingDown className="h-8 w-8 text-red-400" />
                )}
              </div>
              <div>
                <p className="text-sm text-slate-400">Current Streak</p>
                <p className={`text-3xl font-bold ${colorFor(currentStreak.type)}`}>
                  {currentStreak.count}{" "}
                  {currentStreak.type === "win" ? "wins" : "losses"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-primary/20 px-4 py-2">
              <div className="live-indicator h-2 w-2 rounded-full bg-primary" />
              <span className="text-sm font-medium text-primary">Active</span>
            </div>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="stat-card text-center">
            <p className="mb-2 text-xs text-slate-400">Hot Streaks (3+)</p>
            <p className="text-2xl font-bold text-green-400">{hotStreaks}</p>
          </div>
          <div className="stat-card text-center">
            <p className="mb-2 text-xs text-slate-400">Cold Streaks (3+)</p>
            <p className="text-2xl font-bold text-red-400">{coldStreaks}</p>
          </div>
          <div className="stat-card text-center">
            <p className="mb-2 text-xs text-slate-400">Max Win Streak</p>
            <p className="text-2xl font-bold text-green-400">{maxWinStreak}</p>
          </div>
          <div className="stat-card text-center">
            <p className="mb-2 text-xs text-slate-400">Max Loss Streak</p>
            <p className="text-2xl font-bold text-red-400">{maxLossStreak}</p>
          </div>
        </div>

        <div>
          <h4 className="mb-4 text-lg font-semibold text-white">Recent Streaks</h4>
          <div className="space-y-2">
            {streaks.slice(-10).reverse().map((streak, i) => (
              <div
                key={`${streak.start}-${i}`}
                className={`flex items-center justify-between rounded-lg p-3 ${bgFor(streak.type)}`}
              >
                <div className="flex items-center gap-3">
                  {streak.type === "win" ? (
                    <TrendingUp className="h-5 w-5 text-green-400" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-red-400" />
                  )}
                  <span className="text-sm text-slate-300">
                    {streak.type === "win" ? "Win" : "Loss"} Streak
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    {Array.from({ length: Math.min(streak.count, 10) }).map((_, j) => (
                      <div
                        key={j}
                        className={`h-4 w-2 rounded-sm ${streak.type === "win" ? "bg-green-500" : "bg-red-500"}`}
                      />
                    ))}
                  </div>
                  <span className={`font-bold ${colorFor(streak.type)}`}>{streak.count}</span>
                </div>
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
        <h3 className="text-lg font-semibold text-white">Streak Detector</h3>
        <Play className="h-5 w-5 text-primary" />
      </div>
      <div className="space-y-4">
        <div className={`rounded-lg p-4 ${bgFor(currentStreak.type)} border border-slate-700/50`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {currentStreak.type === "win" ? (
                <TrendingUp className="h-5 w-5 text-green-400" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-400" />
              )}
              <span className="text-sm text-slate-300">Current</span>
            </div>
            <span className={`text-2xl font-bold ${colorFor(currentStreak.type)}`}>
              {currentStreak.count}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-green-500/10 p-3 text-center">
            <p className="mb-1 text-xs text-green-400">Hot Streaks</p>
            <p className="text-lg font-bold text-green-400">{hotStreaks}</p>
          </div>
          <div className="rounded-lg bg-red-500/10 p-3 text-center">
            <p className="mb-1 text-xs text-red-400">Cold Streaks</p>
            <p className="text-lg font-bold text-red-400">{coldStreaks}</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          Threshold: ≥{WIN_THRESHOLD}x counts as a win run · memoryless gaps expected
        </p>
      </div>
    </div>
  );
}
