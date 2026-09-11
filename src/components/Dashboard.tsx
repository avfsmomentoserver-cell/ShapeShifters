import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpenText,
  Pause,
  Play,
  Radar,
  RefreshCw,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import CurveShapeAnalyzer from "@/components/analyzers/CurveShapeAnalyzer";
import StreakDetector from "@/components/analyzers/StreakDetector";
import DryZonePredictor from "@/components/analyzers/DryZonePredictor";
import MoonshotForecaster from "@/components/analyzers/MoonshotForecaster";
import ETAEstimator from "@/components/analyzers/ETAEstimator";
import ResearchLibrary from "@/components/ResearchLibrary";
import SignalEngine from "@/components/SignalEngine";
import DownloadSourceButton from "@/components/DownloadSourceButton";
import { computeQuickStats, makeRound, seedRounds } from "@/lib/analysis";
import type { Round, ShapeId } from "@/lib/types";

type TabId =
  | "overview"
  | "shapes"
  | "signals"
  | "streaks"
  | "dry-zones"
  | "moonshots"
  | "eta"
  | "research";

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "shapes", label: "Curve Shapes", icon: TrendingUp },
  { id: "signals", label: "Signals", icon: Radar },
  { id: "streaks", label: "Streaks", icon: Play },
  { id: "dry-zones", label: "Dry Zones", icon: AlertTriangle },
  { id: "moonshots", label: "Moonshots", icon: Target },
  { id: "eta", label: "ETA", icon: RefreshCw },
  { id: "research", label: "Research", icon: BookOpenText },
];

const TICK_MS = 3000;

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [roundData, setRoundData] = useState<Round[]>(() => seedRounds(50, TICK_MS));
  const [currentMultiplier, setCurrentMultiplier] = useState(1.0);
  const [selectedShape, setSelectedShape] = useState<ShapeId | null>(null);

  // Live feed: a new crash round every TICK_MS, multiplier ticking in between.
  useEffect(() => {
    if (!isAutoRefresh) return;

    const interval = setInterval(() => {
      setCurrentMultiplier((prev) => {
        const next = prev + 0.01 + Math.random() * 0.05;
        return next > 10 ? 1.0 : parseFloat(next.toFixed(2));
      });

      setRoundData((prev) => [...prev.slice(1), makeRound(Date.now(), new Date(), prev)]);
    }, TICK_MS);

    return () => clearInterval(interval);
  }, [isAutoRefresh]);

  const handleReset = useCallback(() => {
    setRoundData(seedRounds(50, TICK_MS));
    setCurrentMultiplier(1.0);
  }, []);

  const eta = useMemo(() => roundData, [roundData]); // history reference
  const quickStats = useMemo(
    () => computeQuickStats(roundData, { stdDev: undefined, estimatedCrash: null, confidence: "low", method: "", timeRemaining: null }),
    [roundData],
  );

  const renderContent = () => {
    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-6">
            <div className="chart-container">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">Live Multiplier Curve</h3>
                  <p className="font-mono text-xs text-slate-500">
                    current tick: {currentMultiplier.toFixed(2)}x
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsAutoRefresh(!isAutoRefresh)}
                    className={`rounded-lg p-2 transition-colors ${
                      isAutoRefresh ? "bg-primary text-primary-foreground" : "bg-slate-700 text-slate-300"
                    }`}
                    title={isAutoRefresh ? "Pause feed" : "Resume feed"}
                  >
                    {isAutoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={handleReset}
                    className="rounded-lg bg-slate-700 p-2 text-slate-300 transition-colors hover:bg-slate-600"
                    title="Reset data"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={roundData}>
                    <defs>
                      <linearGradient id="colorMultiplier" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" stroke="#64748b" fontSize={12} minTickGap={40} />
                    <YAxis stroke="#64748b" fontSize={12} domain={[0, "auto"]} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#1e293b",
                        border: "1px solid #334155",
                        borderRadius: "8px",
                      }}
                      labelStyle={{ color: "#94a3b8" }}
                    />
                    <ReferenceLine y={2} stroke="#22c55e" strokeDasharray="3 3" />
                    <ReferenceLine y={5} stroke="#eab308" strokeDasharray="3 3" />
                    <ReferenceLine y={10} stroke="#a855f7" strokeDasharray="3 3" />
                    <Area
                      type="monotone"
                      dataKey="multiplier"
                      stroke="#0ea5e9"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorMultiplier)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <CurveShapeAnalyzer data={roundData} onSelectShape={setSelectedShape} />
              <SignalEngine data={roundData} />
              <StreakDetector data={roundData} />
              <DryZonePredictor data={roundData} />
              <MoonshotForecaster data={roundData} />
            </div>

            <ETAEstimator currentMultiplier={currentMultiplier} history={eta} />
          </div>
        );
      case "shapes":
        return <CurveShapeAnalyzer data={roundData} fullView onSelectShape={setSelectedShape} />;
      case "signals":
        return <SignalEngine data={roundData} fullView />;
      case "streaks":
        return <StreakDetector data={roundData} fullView />;
      case "dry-zones":
        return <DryZonePredictor data={roundData} fullView />;
      case "moonshots":
        return <MoonshotForecaster data={roundData} fullView />;
      case "eta":
        return <ETAEstimator currentMultiplier={currentMultiplier} history={roundData} fullView />;
      case "research":
        return <ResearchLibrary rounds={roundData} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Persistent bundle bar — the source README's non-negotiable */}
      <div className="card flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-semibold text-white">Source & research, bundled at every step</p>
            <p className="text-xs text-slate-500">
              {quickStats.activePatterns} active shape patterns · window of {roundData.length} rounds
              {selectedShape ? ` · selected: ${selectedShape}` : ""}
            </p>
          </div>
        </div>
        <DownloadSourceButton />
      </div>

      {/* Tab Navigation */}
      <div className="card p-2">
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2.5 font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? "bg-primary text-primary-foreground shadow-lg shadow-sky-900/40"
                    : "bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {renderContent()}
    </div>
  );
}
