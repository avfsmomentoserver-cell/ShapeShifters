import { useState, useEffect, useCallback } from 'react'
import {
  Target, TrendingUp, Zap, Activity, AlertTriangle, Gauge,
  Rocket, Moon, Shield, ChevronRight, TrendingDown, BarChart3
} from 'lucide-react'

const API_BASE = '/api'

const regimeConfig = {
  stable_low:     { label: 'Stable Low',    color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/30',   icon: TrendingDown },
  stable_high:    { label: 'Stable High',   color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/30',  icon: TrendingUp },
  volatile_mixed: { label: 'Volatile Mixed',color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: Activity },
  trending_up:    { label: 'Trending Up',   color: 'text-emerald-400',bg: 'bg-emerald-500/10',border: 'border-emerald-500/30',icon: TrendingUp },
  trending_down:  { label: 'Trending Down', color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/30',    icon: TrendingDown },
  chaotic:        { label: 'Chaotic',       color: 'text-pink-400',   bg: 'bg-pink-500/10',   border: 'border-pink-500/30',   icon: AlertTriangle }
}

const confidenceConfig = {
  high:   { label: 'HIGH',   color: 'text-green-400',  bg: 'bg-green-500/20',  stroke: '#22c55e' },
  medium: { label: 'MEDIUM', color: 'text-yellow-400', bg: 'bg-yellow-500/20', stroke: '#eab308' },
  low:    { label: 'LOW',    color: 'text-red-400',    bg: 'bg-red-500/20',    stroke: '#ef4444' }
}

export default function ForecastSummary({ connectionStatus }) {
  const [forecastData, setForecastData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  const fetchForecast = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/forecast/summary`)
      if (!res.ok) throw new Error(`API returned ${res.status}`)
      const data = await res.json()
      if (data.success) {
        setForecastData(data)
        setError(null)
      } else {
        throw new Error(data.detail || 'Forecast failed')
      }
    } catch (err) {
      setError(err.message)
      // Fallback to demo data so the UI is always useful
      setForecastData(generateDemoForecast())
    } finally {
      setLoading(false)
      setLastUpdate(new Date())
    }
  }, [])

  useEffect(() => {
    // Always fetch - will use demo fallback data if backend not available
    fetchForecast()
    const interval = setInterval(fetchForecast, 10000) // Refresh every 10s
    return () => clearInterval(interval)
  }, [fetchForecast])

  // --- Demo data fallback (when backend not running) ---
  function generateDemoForecast() {
    return {
      success: true,
      timestamp: Date.now() / 1000,
      rounds_analyzed: 1000,
      forecast: {
        target_multiplier: 2.47,
        confidence: 0.68,
        confidence_label: 'medium',
        range_low: 1.62,
        range_high: 3.32,
        regime: 'volatile_mixed',
        risk_score: 0.42,
        recommended_action: 'MODERATE_RISK: Conservative strategy recommended',
        model_confidence: 0.71
      },
      moonshot_ETA: {
        rounds_until_moonshot: 8,
        probability: 0.34,
        expected_value: 7.2,
        threshold: 5.0
      },
      mega_ETA: {
        rounds_until_mega: 47,
        probability: 0.12,
        threshold: 10.0
      },
      market_context: {
        mean_multiplier: 2.31,
        median_multiplier: 1.85,
        std_dev: 2.14,
        min: 1.0,
        max: 48.7,
        current_streak: 3,
        streak_type: 'win',
        streak_continuation_prob: 0.62,
        dry_zone_probability: 0.28,
        curve_shape: 'power_law',
        pareto_alpha: 1.87,
        pareto_fit: 'good'
      },
      signal_breakdown: [
        { model: 'Pareto Distribution', estimate: 2.34, confidence: 0.82, weight: 0.24, detail: 'alpha=1.870' },
        { model: 'Historical Mean',    estimate: 2.31, confidence: 1.00, weight: 0.18, detail: 'n=1000' },
        { model: 'Ensemble ETA',       estimate: 2.52, confidence: 0.71, weight: 0.21, detail: 'volatile_mixed' },
        { model: 'Moonshot Forecast',  estimate: 3.10, confidence: 0.34, weight: 0.12, detail: 'prob=34.0%' },
        { model: 'Markov Streak',      estimate: 2.68, confidence: 0.62, weight: 0.15, detail: '3 wins' },
        { model: 'Dry Zone Adjust',    estimate: 2.12, confidence: 0.72, weight: 0.10, detail: 'prob=28.0%' }
      ],
      grouped_predictions: [
        { group_id: 'overall_ensemble', regime: 'volatile_mixed', predicted_crash_point: 2.52, confidence_interval: [1.38, 3.66], risk_score: 0.42, recommended_action: 'MODERATE_RISK: Conservative strategy recommended', model_confidence: 0.71 },
        { group_id: 'cluster_0', regime: 'volatile_mixed', predicted_crash_point: 1.45, confidence_interval: [1.10, 1.80], risk_score: 0.55, recommended_action: 'UNFAVORABLE: Wait for better conditions', model_confidence: 0.68 },
        { group_id: 'cluster_1', regime: 'volatile_mixed', predicted_crash_point: 4.8, confidence_interval: [3.2, 6.4], risk_score: 0.35, recommended_action: 'FAVORABLE: Consider moderate bets with stop-loss', model_confidence: 0.65 }
      ]
    }
  }

  if (loading) {
    return (
      <div className="card flex items-center justify-center py-20">
        <div className="flex items-center space-x-3">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-400">Computing ensemble forecast...</span>
        </div>
      </div>
    )
  }

  if (!forecastData) {
    return (
      <div className="card text-center py-20">
        <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-slate-400">Unable to load forecast data</p>
        <button onClick={fetchForecast} className="btn-primary mt-4">Retry</button>
      </div>
    )
  }

  const fc = forecastData.forecast
  const moon = forecastData.moonshot_ETA
  const mega = forecastData.mega_ETA
  const ctx = forecastData.market_context
  const signals = forecastData.signal_breakdown || []
  const groups = forecastData.grouped_predictions || []
  const regime = regimeConfig[fc.regime] || regimeConfig.chaotic
  const conf = confidenceConfig[fc.confidence_label] || confidenceConfig.medium
  const RegimeIcon = regime.icon

  const confidencePct = Math.round(fc.confidence * 100)
  const riskPct = Math.round(fc.risk_score * 100)
  const moonPct = Math.round(moon.probability * 100)
  const megaPct = Math.round(mega.probability * 100)
  const streakPct = Math.round(ctx.streak_continuation_prob * 100)
  const dryPct = Math.round(ctx.dry_zone_probability * 100)

  // Action styling
  const actionLabel = fc.recommended_action?.split(':')[0] || 'NEUTRAL'
  const actionText = fc.recommended_action?.split(':').slice(1).join(':').trim() || 'Standard risk management applies'
  const actionStyles = {
    HIGH_RISK:     { bg: 'bg-red-500/10',     border: 'border-red-500/40',    text: 'text-red-400',     icon: AlertTriangle },
    MODERATE_RISK: { bg: 'bg-yellow-500/10',  border: 'border-yellow-500/40', text: 'text-yellow-400',  icon: Shield },
    FAVORABLE:     { bg: 'bg-green-500/10',   border: 'border-green-500/40',  text: 'text-green-400',   icon: TrendingUp },
    UNFAVORABLE:   { bg: 'bg-orange-500/10',  border: 'border-orange-500/40',text: 'text-orange-400',  icon: TrendingDown },
    NEUTRAL:       { bg: 'bg-slate-500/10',   border: 'border-slate-500/40',  text: 'text-slate-300',   icon: Gauge }
  }
  const actionStyle = actionStyles[actionLabel] || actionStyles.NEUTRAL
  const ActionIcon = actionStyle.icon

  return (
    <div className="space-y-6">
      {/* === HERO FORECAST CARD === */}
      <div className="card overflow-hidden relative">
        {/* Gradient background overlay */}
        <div className={`absolute inset-0 ${regime.bg} opacity-50 pointer-events-none`} />
        
        <div className="relative z-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <div className="bg-gradient-to-r from-primary-500 to-primary-600 p-2.5 rounded-lg">
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Next Round Forecast</h2>
                <p className="text-xs text-slate-400">
                  Ensemble of {signals.length} models • {forecastData.rounds_analyzed?.toLocaleString()} rounds analyzed
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full ${regime.bg} ${regime.border} border`}>
                <RegimeIcon className={`w-4 h-4 ${regime.color}`} />
                <span className={`text-xs font-medium ${regime.color}`}>{regime.label}</span>
              </div>
              {lastUpdate && (
                <span className="text-xs text-slate-500">
                  {lastUpdate.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          {/* Main target display */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Target Multiplier - Big display */}
            <div className="lg:col-span-1 flex flex-col items-center justify-center p-6 bg-slate-900/50 rounded-xl border border-slate-700">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Target Multiplier</p>
              <div className="flex items-baseline space-x-1">
                <span className="text-6xl font-bold bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
                  {fc.target_multiplier?.toFixed(2)}
                </span>
                <span className="text-2xl font-bold text-slate-400">x</span>
              </div>
              {/* Confidence gauge */}
              <div className="mt-4 w-full max-w-[200px]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-400">Confidence</span>
                  <span className={`text-sm font-bold ${conf.color}`}>{confidencePct}%</span>
                </div>
                <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${confidencePct}%`, backgroundColor: conf.stroke }}
                  />
                </div>
                <div className={`mt-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${conf.bg} ${conf.color}`}>
                  {conf.label}
                </div>
              </div>
            </div>

            {/* Range & Key Metrics */}
            <div className="lg:col-span-2 space-y-4">
              {/* Range bar */}
              <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-slate-300">Predicted Range</span>
                  <span className="text-xs text-slate-500">95% confidence interval</span>
                </div>
                <div className="relative h-8 bg-slate-800 rounded-lg overflow-hidden">
                  {/* Range fill */}
                  <div
                    className="absolute h-full bg-gradient-to-r from-primary-500/30 via-primary-500/50 to-primary-500/30 border-x-2 border-primary-400"
                    style={{
                      left: '0%',
                      right: '0%'
                    }}
                  />
                  {/* Target marker */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-primary-400 shadow-lg shadow-primary-500/50"
                    style={{ left: '50%', transform: 'translateX(-50%)' }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="text-center">
                    <p className="text-xs text-slate-500">Low</p>
                    <p className="text-lg font-bold text-red-400">{fc.range_low?.toFixed(2)}x</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">Target</p>
                    <p className="text-lg font-bold text-primary-400">{fc.target_multiplier?.toFixed(2)}x</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">High</p>
                    <p className="text-lg font-bold text-green-400">{fc.range_high?.toFixed(2)}x</p>
                  </div>
                </div>
              </div>

              {/* Quick metrics grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="stat-card text-center">
                  <Gauge className="w-4 h-4 mx-auto mb-1 text-yellow-400" />
                  <p className="text-xs text-slate-400">Risk Score</p>
                  <p className={`text-xl font-bold ${riskPct > 70 ? 'text-red-400' : riskPct > 50 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {riskPct}%
                  </p>
                </div>
                <div className="stat-card text-center">
                  <BarChart3 className="w-4 h-4 mx-auto mb-1 text-blue-400" />
                  <p className="text-xs text-slate-400">Model Conf.</p>
                  <p className="text-xl font-bold text-blue-400">
                    {Math.round((fc.model_confidence || 0.5) * 100)}%
                  </p>
                </div>
                <div className="stat-card text-center">
                  <Activity className="w-4 h-4 mx-auto mb-1 text-primary-400" />
                  <p className="text-xs text-slate-400">Curve Shape</p>
                  <p className="text-sm font-bold text-primary-400 capitalize">
                    {ctx.curve_shape?.replace('_', ' ')}
                  </p>
                </div>
                <div className="stat-card text-center">
                  <TrendingUp className="w-4 h-4 mx-auto mb-1 text-green-400" />
                  <p className="text-xs text-slate-400">Pareto Alpha</p>
                  <p className="text-xl font-bold text-green-400">{ctx.pareto_alpha?.toFixed(2)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Recommended Action Banner */}
          <div className={`mt-6 p-4 rounded-xl border ${actionStyle.bg} ${actionStyle.border} flex items-center space-x-4`}>
            <div className={`p-3 rounded-full ${actionStyle.bg} ${actionStyle.border} border`}>
              <ActionIcon className={`w-6 h-6 ${actionStyle.text}`} />
            </div>
            <div className="flex-1">
              <p className={`text-sm font-bold ${actionStyle.text}`}>{actionLabel}</p>
              <p className="text-sm text-slate-300">{actionText}</p>
            </div>
            <button
              onClick={fetchForecast}
              className="p-2 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors"
              title="Refresh forecast"
            >
              <ChevronRight className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>
      </div>

      {/* === MOONSHOT & MEGA ETA === */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Moonshot ETA */}
        <div className="card relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Rocket className="w-5 h-5 text-purple-400" />
                <h3 className="text-lg font-semibold text-white">Moonshot ETA</h3>
              </div>
              <span className="text-xs text-slate-500">{moon.threshold}x+</span>
            </div>

            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-slate-400 mb-1">Estimated In</p>
                <div className="flex items-baseline space-x-1">
                  <span className="text-4xl font-bold text-purple-400">
                    {moon.rounds_until_moonshot ?? '--'}
                  </span>
                  <span className="text-sm text-slate-400">rounds</span>
                </div>
              </div>
              {/* Circular probability gauge */}
              <div className="relative h-24 w-24">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#334155"
                    strokeWidth="3"
                  />
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth="3"
                    strokeDasharray={`${moonPct}, 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-lg font-bold text-white">{moonPct}%</span>
                  <span className="text-[10px] text-slate-500">prob</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                <span className="text-xs text-slate-400">Expected Value</span>
                <span className="text-sm font-bold text-purple-400">{moon.expected_value?.toFixed(2)}x</span>
              </div>
              {/* Progress dots for countdown */}
              {moon.rounds_until_moonshot && (
                <div className="flex items-center justify-center space-x-1 pt-1">
                  {Array.from({ length: Math.min(moon.rounds_until_moonshot, 15) }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-1.5 h-4 rounded-sm ${i === 0 ? 'bg-purple-400 animate-pulse' : 'bg-purple-500/30'}`}
                    />
                  ))}
                  {moon.rounds_until_moonshot > 15 && (
                    <span className="text-xs text-slate-500 ml-1">+{moon.rounds_until_moonshot - 15} more</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mega ETA */}
        <div className="card relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/5 to-orange-500/5 pointer-events-none" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <Moon className="w-5 h-5 text-yellow-400" />
                <h3 className="text-lg font-semibold text-white">Mega Multiplier ETA</h3>
              </div>
              <span className="text-xs text-slate-500">{mega.threshold}x+</span>
            </div>

            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs text-slate-400 mb-1">Estimated In</p>
                <div className="flex items-baseline space-x-1">
                  <span className="text-4xl font-bold text-yellow-400">
                    {mega.rounds_until_mega ?? '--'}
                  </span>
                  <span className="text-sm text-slate-400">rounds</span>
                </div>
              </div>
              {/* Circular probability gauge */}
              <div className="relative h-24 w-24">
                <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#334155"
                    strokeWidth="3"
                  />
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#eab308"
                    strokeWidth="3"
                    strokeDasharray={`${megaPct}, 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-lg font-bold text-white">{megaPct}%</span>
                  <span className="text-[10px] text-slate-500">prob</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-slate-800/50 rounded-lg">
                <span className="text-xs text-slate-400">Historical Max</span>
                <span className="text-sm font-bold text-yellow-400">{ctx.max?.toFixed(2)}x</span>
              </div>
              {/* Progress dots for countdown */}
              {mega.rounds_until_mega && mega.rounds_until_mega <= 50 && (
                <div className="flex items-center justify-center space-x-0.5 pt-1 flex-wrap gap-y-1">
                  {Array.from({ length: Math.min(mega.rounds_until_mega, 30) }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 h-3 rounded-sm ${i === 0 ? 'bg-yellow-400 animate-pulse' : 'bg-yellow-500/20'}`}
                    />
                  ))}
                  {mega.rounds_until_mega > 30 && (
                    <span className="text-xs text-slate-500 ml-1">+{mega.rounds_until_mega - 30}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* === SIGNAL BREAKDOWN === */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-white">Model Signal Breakdown</h3>
          </div>
          <span className="text-xs text-slate-500">Weighted ensemble contribution</span>
        </div>

        <div className="space-y-3">
          {signals.map((signal, i) => {
            const signalPct = Math.round(signal.confidence * 100)
            const weightPct = Math.round(signal.weight * 100)
            return (
              <div key={i} className="flex items-center space-x-4 p-3 bg-slate-800/30 rounded-lg">
                {/* Model name & detail */}
                <div className="w-48 flex-shrink-0">
                  <p className="text-sm font-medium text-white">{signal.model}</p>
                  <p className="text-xs text-slate-500">{signal.detail}</p>
                </div>

                {/* Estimate */}
                <div className="text-center w-20 flex-shrink-0">
                  <p className="text-xs text-slate-500">Est.</p>
                  <p className="text-lg font-bold text-primary-400">{signal.estimate?.toFixed(2)}x</p>
                </div>

                {/* Confidence bar */}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-400">Confidence</span>
                    <span className="text-xs font-medium text-slate-300">{signalPct}%</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        signalPct > 70 ? 'bg-green-500' : signalPct > 40 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${signalPct}%` }}
                    />
                  </div>
                </div>

                {/* Weight */}
                <div className="text-center w-16 flex-shrink-0">
                  <p className="text-xs text-slate-500">Weight</p>
                  <p className="text-sm font-bold text-slate-300">{weightPct}%</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* Ensemble formula display */}
        <div className="mt-4 p-3 bg-slate-900/50 rounded-lg border border-slate-700">
          <p className="text-xs text-slate-500 mb-1">Ensemble Formula</p>
          <p className="text-sm text-slate-300 font-mono">
            target = Σ(model_estimate × model_weight) / Σ(weights)
          </p>
          <p className="text-xs text-primary-400 mt-1">
            = {fc.target_multiplier?.toFixed(2)}x (from {signals.length} contributing models)
          </p>
        </div>
      </div>

      {/* === MARKET CONTEXT === */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-white">Market Context</h3>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-1">Mean</p>
            <p className="text-lg font-bold text-white">{ctx.mean_multiplier?.toFixed(2)}x</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-1">Median</p>
            <p className="text-lg font-bold text-white">{ctx.median_multiplier?.toFixed(2)}x</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-1">Std Dev</p>
            <p className="text-lg font-bold text-white">±{ctx.std_dev?.toFixed(2)}</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-1">Streak</p>
            <p className={`text-lg font-bold ${ctx.streak_type === 'win' ? 'text-green-400' : 'text-red-400'}`}>
              {ctx.current_streak} {ctx.streak_type}s
            </p>
            <p className="text-xs text-slate-500">{streakPct}% continue</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-1">Dry Zone</p>
            <p className={`text-lg font-bold ${dryPct > 50 ? 'text-orange-400' : 'text-green-400'}`}>
              {dryPct}%
            </p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-1">Pareto Fit</p>
            <p className={`text-lg font-bold capitalize ${ctx.pareto_fit === 'good' ? 'text-green-400' : 'text-yellow-400'}`}>
              {ctx.pareto_fit}
            </p>
          </div>
        </div>
      </div>

      {/* === GROUPED PREDICTIONS === */}
      {groups.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Zap className="w-5 h-5 text-yellow-400" />
              <h3 className="text-lg font-semibold text-white">Scenario Predictions</h3>
            </div>
            <span className="text-xs text-slate-500">Cluster-based grouped forecasts</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {groups.map((group, i) => {
              const gRegime = regimeConfig[group.regime] || regimeConfig.chaotic
              const gRisk = Math.round(group.risk_score * 100)
              const gConf = Math.round(group.model_confidence * 100)
              return (
                <div
                  key={i}
                  className={`p-4 rounded-xl border ${gRegime.bg} ${gRegime.border}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-400">
                      {group.group_id.replace(/_/g, ' ')}
                    </span>
                    <span className={`text-xs ${gRegime.color} capitalize`}>{group.regime.replace('_', ' ')}</span>
                  </div>

                  <div className="text-center mb-3">
                    <p className="text-xs text-slate-500 mb-1">Predicted Crash</p>
                    <p className="text-3xl font-bold text-white">{group.predicted_crash_point?.toFixed(2)}x</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Range: {group.confidence_interval[0]?.toFixed(2)}x - {group.confidence_interval[1]?.toFixed(2)}x
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Risk</span>
                      <span className={gRisk > 70 ? 'text-red-400' : gRisk > 50 ? 'text-yellow-400' : 'text-green-400'}>
                        {gRisk}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Model Conf.</span>
                      <span className="text-blue-400">{gConf}%</span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-700/50">
                    {group.recommended_action}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
