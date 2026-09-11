import { useEffect, useMemo, useState } from "react";
import { Activity, Clock, TrendingUp, Zap } from "lucide-react";
import Dashboard from "@/components/Dashboard";
import { calculateEta, computeQuickStats, makeRound, seedRounds } from "@/lib/analysis";
import type { Round } from "@/lib/types";

const TICK_MS = 3000;

const Index = () => {
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected">("connecting");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [rounds, setRounds] = useState<Round[]>(() => seedRounds(50, TICK_MS));

  useEffect(() => {
    const timer = setTimeout(() => {
      setConnectionStatus("connected");
      setLastUpdate(new Date());
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (connectionStatus !== "connected") return;
    const interval = setInterval(() => setLastUpdate(new Date()), 1000);
    return () => clearInterval(interval);
  }, [connectionStatus]);

  // Lightweight mirror feed powering the header quick stats (the dashboard
  // owns the canonical feed used by the analyzers).
  useEffect(() => {
    if (connectionStatus !== "connected") return;
    const interval = setInterval(() => {
      setRounds((prev) => [...prev.slice(1), makeRound(Date.now(), new Date(), prev)]);
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [connectionStatus]);

  const stats = useMemo(() => computeQuickStats(rounds, calculateEta(1, rounds)), [rounds]);

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
                  connectionStatus === "connected"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-yellow-500/20 text-yellow-400"
                }`}
              >
                <div
                  className={`h-2 w-2 rounded-full ${
                    connectionStatus === "connected" ? "live-indicator bg-green-400" : "bg-yellow-400"
                  }`}
                />
                <span>{connectionStatus === "connected" ? "Live" : "Connecting..."}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto px-4 py-6">
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

        <Dashboard />
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
