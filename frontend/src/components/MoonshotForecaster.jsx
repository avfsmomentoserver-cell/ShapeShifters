import { Zap, Target, TrendingUp, Star } from 'lucide-react'

export default function MoonshotForecaster({ data, fullView = false }) {
  const analyzeMoonshots = () => {
    const moonshots = data.filter(r => r.multiplier >= 5)
    const clusters = []
    let currentCluster = null
    
    for (let i = 0; i < moonshots.length; i++) {
      const current = moonshots[i]
      const prevIndex = data.indexOf(current)
      
      if (i > 0) {
        const prev = moonshots[i - 1]
        const prevPrevIndex = data.indexOf(prev)
        const gap = prevIndex - prevPrevIndex
        
        if (gap <= 10) {
          if (!currentCluster) {
            currentCluster = { start: prevPrevIndex, count: 2, multipliers: [prev.multiplier, current.multiplier] }
          } else {
            currentCluster.count++
            currentCluster.multipliers.push(current.multiplier)
          }
        } else {
          if (currentCluster) {
            clusters.push(currentCluster)
          }
          currentCluster = null
        }
      }
    }
    
    if (currentCluster) {
      clusters.push(currentCluster)
    }
    
    return {
      total: moonshots.length,
      percentage: ((moonshots.length / data.length) * 100).toFixed(1) || 0,
      highest: Math.max(...moonshots.map(m => m.multiplier), 0),
      average: moonshots.length > 0 
        ? (moonshots.reduce((acc, m) => acc + m.multiplier, 0) / moonshots.length).toFixed(2)
        : 0,
      clusters: clusters.length,
      recent: moonshots.slice(-5)
    }
  }

  const predictNextMoonshot = () => {
    const recentData = data.slice(-30)
    const highMultipliers = recentData.filter(r => r.multiplier >= 3).length
    const building Momentum = highMultipliers / recentData.length
    
    const avgGapBetweenMoonshots = data.length / Math.max(1, data.filter(r => r.multiplier >= 5).length)
    
    const lastMoonshotIndex = [...data].reverse().findIndex(r => r.multiplier >= 5)
    const roundsSinceLast = lastMoonshotIndex === -1 ? 999 : lastMoonshotIndex
    
    const probability = Math.min(
      30 + (buildingMomentum * 40) + Math.min(roundsSinceLast / avgGapBetweenMoonshots, 1) * 30,
      95
    )
    
    return {
      probability: parseFloat(probability.toFixed(1)),
      estimatedRounds: Math.max(1, Math.round(avgGapBetweenMoonshots - roundsSinceLast)),
      confidence: data.length > 50 ? 'high' : 'medium',
      momentum: buildingMomentum > 0.3 ? 'strong' : buildingMomentum > 0.15 ? 'moderate' : 'weak'
    }
  }

  const stats = analyzeMoonshots()
  const prediction = predictNextMoonshot()

  if (fullView) {
    return (
      <div className="card">
        <h3 className="text-xl font-bold text-white mb-6 flex items-center">
          <Zap className="w-6 h-6 mr-2 text-purple-400" />
          Moonshot Forecaster
        </h3>
        
        {/* Main Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-2">Total Moonshots</p>
            <p className="text-2xl font-bold text-purple-400">{stats.total}</p>
            <p className="text-xs text-slate-500">{stats.percentage}% of rounds</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-2">Highest Multiplier</p>
            <p className="text-2xl font-bold text-yellow-400">{stats.highest.toFixed(2)}x</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-2">Average</p>
            <p className="text-2xl font-bold text-green-400">{stats.average}x</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-2">Clusters Found</p>
            <p className="text-2xl font-bold text-pink-400">{stats.clusters}</p>
          </div>
        </div>

        {/* Prediction Section */}
        <div className="mb-8 p-6 bg-gradient-to-r from-purple-900/30 to-pink-900/30 rounded-xl border border-purple-500/30">
          <h4 className="text-lg font-semibold text-white mb-4 flex items-center">
            <Target className="w-5 h-5 mr-2 text-purple-400" />
            Next Moonshot Prediction
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="relative h-24 w-24 mx-auto mb-3">
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
                    stroke={prediction.probability > 70 ? '#a855f7' : prediction.probability > 40 ? '#eab308' : '#22c55e'}
                    strokeWidth="3"
                    strokeDasharray={`${prediction.probability}, 100`}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center flex-col">
                  <span className="text-2xl font-bold text-white">{prediction.probability}%</span>
                  <Star className={`w-4 h-4 ${prediction.momentum === 'strong' ? 'text-yellow-400' : 'text-slate-400'}`} />
                </div>
              </div>
              <p className="text-sm text-slate-400">Probability</p>
            </div>
            
            <div className="text-center p-4 bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-400 mb-2">Estimated In</p>
              <p className="text-3xl font-bold text-purple-400">{prediction.estimatedRounds}</p>
              <p className="text-sm text-slate-400">rounds</p>
              <div className="mt-2 flex justify-center space-x-1">
                {Array.from({ length: Math.min(prediction.estimatedRounds, 10) }).map((_, i) => (
                  <div key={i} className="w-1.5 h-3 bg-purple-500 rounded-full" />
                ))}
              </div>
            </div>
            
            <div className="space-y-3">
              <div className="bg-slate-800/50 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Momentum</p>
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium capitalize ${
                    prediction.momentum === 'strong' ? 'text-green-400' :
                    prediction.momentum === 'moderate' ? 'text-yellow-400' : 'text-slate-400'
                  }`}>
                    {prediction.momentum}
                  </span>
                  <TrendingUp className={`w-4 h-4 ${
                    prediction.momentum === 'strong' ? 'text-green-400' :
                    prediction.momentum === 'moderate' ? 'text-yellow-400' : 'text-slate-400'
                  }`} />
                </div>
                <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full ${
                      prediction.momentum === 'strong' ? 'bg-green-500' :
                      prediction.momentum === 'moderate' ? 'bg-yellow-500' : 'bg-slate-500'
                    }`}
                    style={{ width: `${prediction.momentum === 'strong' ? 100 : prediction.momentum === 'moderate' ? 60 : 30}%` }}
                  />
                </div>
              </div>
              
              <div className="bg-slate-800/50 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Confidence</p>
                <p className={`text-sm font-bold capitalize ${
                  prediction.confidence === 'high' ? 'text-green-400' : 'text-yellow-400'
                }`}>
                  {prediction.confidence}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Moonshots */}
        <div>
          <h4 className="text-lg font-semibold text-white mb-4">Recent Moonshots (≥5x)</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.recent.slice().reverse().map((round, i) => (
              <div 
                key={i}
                className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-purple-500/20 rounded-lg">
                    <Zap className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-400">{round.time}</p>
                    <p className="text-xs text-slate-500">Round #{data.indexOf(round)}</p>
                  </div>
                </div>
                <span className="text-2xl font-bold text-purple-400">{round.multiplier.toFixed(2)}x</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Moonshot Alert</h3>
        <Zap className="w-5 h-5 text-purple-400" />
      </div>
      
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-purple-500/10 rounded-lg p-3 text-center">
            <p className="text-xs text-purple-400 mb-1">Total</p>
            <p className="text-xl font-bold text-purple-400">{stats.total}</p>
          </div>
          <div className="bg-yellow-500/10 rounded-lg p-3 text-center">
            <p className="text-xs text-yellow-400 mb-1">Highest</p>
            <p className="text-xl font-bold text-yellow-400">{stats.highest.toFixed(1)}x</p>
          </div>
        </div>
        
        <div className="bg-slate-800/50 rounded-lg p-4">
          <p className="text-xs text-slate-400 mb-2">Next Moonshot Probability</p>
          <div className="flex items-center space-x-3">
            <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  prediction.probability > 70 ? 'bg-purple-500' : 
                  prediction.probability > 40 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${prediction.probability}%` }}
              />
            </div>
            <span className={`text-sm font-bold ${
              prediction.probability > 70 ? 'text-purple-400' : 
              prediction.probability > 40 ? 'text-yellow-400' : 'text-green-400'
            }`}>
              {prediction.probability}%
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Est. in {prediction.estimatedRounds} rounds • {prediction.momentum} momentum
          </p>
        </div>
      </div>
    </div>
  )
}
