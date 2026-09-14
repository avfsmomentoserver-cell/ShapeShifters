import { useMemo } from "react";
import { Activity, Clock, TrendingUp, Zap } from "lucide-react";
import Dashboard from "@/components/Dashboard";
import LiveFeedReceiver from "@/components/LiveFeedReceiver";
import { calculateEta, computeQuickStats } from "@/lib/analysis";
import { useLiveRounds } from "@/hooks/useLiveRounds";

const Index = () => {
  const feed = useLiveRounds();
  const lastUpdate = feed.rounds.at(-1)?.timestamp ? new Date(feed.rounds.at(-1)!.timestamp) : null;
  const isLive = feed.status === "watching" || feed.status === "imported";
  const stats = useMemo(
    () => computeQuickStats(feed.rounds, calculateEta(feed.currentMultiplier ?? 1, feed.rounds)),
    [feed.currentMultiplier, feed.rounds],
  );

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-700/50 bg-slate-900/60 backdrop-blur-md">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-gradient-to-r from-sky-500 to-sky-600 p-2 shadow-lg shadow-sky-950/40">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Crash Curve Analytics</h1>
                <p className="text-xs text-slate-400">Shapeshifters · Shape-Based Forecasting Engine</p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden items-center gap-2 text-sm sm:flex">
                <Clock className="h-4 w-4 text-slate-400" />
                <span className="font-mono text-slate-400">
                  {lastUpdate ? lastUpdate.toLocaleTimeString() : "--:--:--"}
                </span>
              </div>

              <div
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${
                  isLive
                    ? "bg-green-500/20 text-green-400"
                    : "bg-yellow-500/20 text-yellow-400"
                }`}
              >
                <div
                  className={`h-2 w-2 rounded-full ${
                    isLive ? "live-indicator bg-green-400" : "bg-yellow-400"
                  }`}
                />
                <span>{isLive ? "Live" : "Waiting"}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <LiveFeedReceiver feed={feed} />
        </div>

        {/* Quick Stats Bar */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="stat-card flex items-center gap-3">
            <div className="rounded-lg bg-primary/20 p-3">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Active Patterns</p>
              <p className="text-lg font-bold text-white">{stats.activePatterns}</p>
            </div>
          </div>

          <div className="stat-card flex items-center gap-3">
            <div className="rounded-lg bg-crash-green/20 p-3">
              <TrendingUp className="h-5 w-5 text-crash-green" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Win Rate (≥2x)</p>
              <p className="text-lg font-bold text-white">{stats.successRate}%</p>
            </div>
          </div>

          <div className="stat-card flex items-center gap-3">
            <div className="rounded-lg bg-crash-yellow/20 p-3">
              <Clock className="h-5 w-5 text-crash-yellow" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Avg Multiplier</p>
              <p className="text-lg font-bold text-white">{stats.avgMultiplier}x</p>
            </div>
          </div>

          <div className="stat-card flex items-center gap-3">
            <div className="rounded-lg bg-crash-purple/20 p-3">
              <Zap className="h-5 w-5 text-crash-purple" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Moonshots ≥5x</p>
              <p className="text-lg font-bold text-white">{stats.pendingMoonshots}</p>
            </div>
          </div>
        </div>

        <Dashboard roundData={feed.rounds} currentMultiplier={feed.currentMultiplier} />
      </main>

      {/* Footer */}
      <footer className="mt-8 border-t border-slate-700/50 py-4">
        <div className="container mx-auto px-4 text-center text-xs text-slate-500">
          <p>
            Shapeshifters v1.0 · Powered by Stochastic Modeling & Pattern Recognition ·
            Research-grade math, bundled with source at every step
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
