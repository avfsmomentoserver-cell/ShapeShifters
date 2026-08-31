import { RefreshCw, Clock, TrendingUp, AlertCircle } from 'lucide-react'

export default function ETAEstimator({ currentMultiplier, history, fullView = false }) {
  const calculateETA = () => {
    if (history.length < 5) {
      return {
        estimatedCrash: null,
        confidence: 'low',
        method: 'insufficient_data',
        timeRemaining: null
      }
    }

    const recentRounds = history.slice(-20)
    const avgCrashPoint = recentRounds.reduce((acc, r) => acc + r.multiplier, 0) / recentRounds.length
    
    const stdDev = Math.sqrt(
      recentRounds.reduce((acc, r) => acc + Math.pow(r.multiplier - avgCrashPoint, 2), 0) / recentRounds.length
    )
    
    const growthRate = 0.06
    const timeToCrash = Math.log(avgCrashPoint / currentMultiplier) / growthRate
    
    const crashProbability = []
    for (let i = 1; i <= 10; i++) {
      const targetMultiplier = currentMultiplier + i * 0.5
      const probability = 100 * Math.exp(-Math.pow(targetMultiplier - avgCrashPoint, 2) / (2 * Math.pow(stdDev, 2)))
      crashProbability.push({
        multiplier: targetMultiplier.toFixed(2),
        probability: Math.min(probability, 99).toFixed(1)
      })
    }
    
    return {
      estimatedCrash: parseFloat(avgCrashPoint.toFixed(2)),
      confidence: history.length > 30 ? 'high' : history.length > 15 ? 'medium' : 'low',
      method: 'stochastic_modeling',
      timeRemaining: Math.max(0, parseFloat(timeToCrash.toFixed(1))),
      stdDev: parseFloat(stdDev.toFixed(2)),
      crashProbability
    }
  }

  const eta = calculateETA()

  if (fullView) {
    return (
      <div className="card">
        <h3 className="text-xl font-bold text-white mb-6 flex items-center">
          <RefreshCw className="w-6 h-6 mr-2 text-primary-400" />
          ETA Estimator
        </h3>
        
        {/* Current Status */}
        <div className="mb-8 p-6 bg-gradient-to-r from-primary-900/30 to-slate-900/30 rounded-xl border border-primary-500/30">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-sm text-slate-400 mb-1">Current Multiplier</p>
              <p className="text-4xl font-bold text-white">{currentMultiplier.toFixed(2)}x</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-slate-400 mb-1">Estimated Crash</p>
              <p className="text-4xl font-bold text-primary-400">
                {eta.estimatedCrash ? `${eta.estimatedCrash.toFixed(2)}x` : '--'}
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-800/50 rounded-lg p-4 text-center">
              <Clock className="w-5 h-5 mx-auto mb-2 text-primary-400" />
              <p className="text-xs text-slate-400 mb-1">Time Remaining</p>
              <p className="text-xl font-bold text-white">
                {eta.timeRemaining !== null ? `${eta.timeRemaining}s` : '--'}
              </p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4 text-center">
              <TrendingUp className="w-5 h-5 mx-auto mb-2 text-green-400" />
              <p className="text-xs text-slate-400 mb-1">Confidence</p>
              <p className={`text-xl font-bold capitalize ${
                eta.confidence === 'high' ? 'text-green-400' :
                eta.confidence === 'medium' ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {eta.confidence}
              </p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4 text-center">
              <AlertCircle className="w-5 h-5 mx-auto mb-2 text-yellow-400" />
              <p className="text-xs text-slate-400 mb-1">Volatility</p>
              <p className="text-xl font-bold text-yellow-400">
                {eta.stdDev ? `±${eta.stdDev}` : '--'}
              </p>
            </div>
          </div>
        </div>

        {/* Crash Probability Distribution */}
        <div className="mb-8">
          <h4 className="text-lg font-semibold text-white mb-4">Crash Probability by Multiplier</h4>
          <div className="space-y-3">
            {eta.crashProbability?.map((item, i) => (
              <div key={i} className="flex items-center space-x-4">
                <span className="text-sm text-slate-300 w-16">{item.multiplier}x</span>
                <div className="flex-1 h-4 bg-slate-700 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      parseFloat(item.probability) > 70 ? 'bg-red-500' :
                      parseFloat(item.probability) > 40 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${item.probability}%` }}
                  />
                </div>
                <span className={`text-sm font-bold w-12 text-right ${
                  parseFloat(item.probability) > 70 ? 'text-red-400' :
                  parseFloat(item.probability) > 40 ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {item.probability}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Method Info */}
        <div className="p-4 bg-slate-800/50 rounded-lg">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-primary-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-white mb-1">Estimation Method</p>
              <p className="text-xs text-slate-400">
                Using {eta.method.replace('_', ' ')} with {history.length} historical rounds. 
                Predictions become more accurate with larger sample sizes.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Live ETA</h3>
        <RefreshCw className="w-5 h-5 text-primary-400" />
      </div>
      
      <div className="space-y-4">
        <div className="bg-gradient-to-r from-primary-900/30 to-slate-900/30 rounded-lg p-4 border border-primary-500/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-400 mb-1">Current</p>
              <p className="text-2xl font-bold text-white">{currentMultiplier.toFixed(2)}x</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400 mb-1">Est. Crash</p>
              <p className="text-2xl font-bold text-primary-400">
                {eta.estimatedCrash ? `${eta.estimatedCrash.toFixed(2)}x` : '--'}
              </p>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800/50 rounded-lg p-3 text-center">
            <Clock className="w-4 h-4 mx-auto mb-1 text-primary-400" />
            <p className="text-xs text-slate-400 mb-1">Time Left</p>
            <p className="text-lg font-bold text-white">
              {eta.timeRemaining !== null ? `${eta.timeRemaining}s` : '--'}
            </p>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 text-center">
            <TrendingUp className="w-4 h-4 mx-auto mb-1 text-green-400" />
            <p className="text-xs text-slate-400 mb-1">Confidence</p>
            <p className={`text-lg font-bold capitalize ${
              eta.confidence === 'high' ? 'text-green-400' :
              eta.confidence === 'medium' ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {eta.confidence}
            </p>
          </div>
        </div>
        
        <div className="bg-slate-800/50 rounded-lg p-3">
          <p className="text-xs text-slate-400 mb-2">Next Targets</p>
          <div className="flex justify-between">
            {eta.crashProbability?.slice(0, 5).map((item, i) => (
              <div key={i} className="text-center">
                <p className="text-xs text-slate-500">{item.multiplier}x</p>
                <p className={`text-sm font-bold ${
                  parseFloat(item.probability) > 70 ? 'text-red-400' :
                  parseFloat(item.probability) > 40 ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {item.probability}%
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
