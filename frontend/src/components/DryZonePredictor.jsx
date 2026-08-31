import { AlertTriangle, Clock, TrendingDown } from 'lucide-react'

export default function DryZonePredictor({ data, fullView = false }) {
  const analyzeDryZones = () => {
    const dryZones = []
    let currentZone = null
    
    for (let i = 0; i < data.length; i++) {
      const round = data[i]
      const isDry = round.multiplier < 1.5
      
      if (isDry) {
        if (!currentZone) {
          currentZone = { start: i, count: 1, rounds: [round] }
        } else {
          currentZone.count++
          currentZone.rounds.push(round)
        }
      } else {
        if (currentZone && currentZone.count >= 2) {
          dryZones.push({ ...currentZone, end: i - 1 })
        }
        currentZone = null
      }
    }
    
    if (currentZone && currentZone.count >= 2) {
      dryZones.push({ ...currentZone, end: data.length - 1, active: true })
    }
    
    return dryZones
  }

  const predictNextDryZone = () => {
    const recentData = data.slice(-20)
    const lowMultipliers = recentData.filter(r => r.multiplier < 2).length
    const probability = Math.min((lowMultipliers / recentData.length) * 100, 95)
    
    const avgGapBetweenDryZones = data.reduce((acc, curr, i, arr) => {
      if (i > 0 && curr.multiplier < 1.5 && arr[i-1].multiplier >= 1.5) {
        return acc + 1
      }
      return acc
    }, 0) / Math.max(1, data.filter(r => r.multiplier < 1.5).length / 3)
    
    return {
      probability: parseFloat(probability.toFixed(1)),
      estimatedRounds: Math.round(avgGapBetweenDryZones) || 3,
      confidence: data.length > 30 ? 'high' : 'medium'
    }
  }

  const dryZones = analyzeDryZones()
  const prediction = predictNextDryZone()
  const activeZone = dryZones.find(z => z.active)
  
  const totalDryRounds = data.filter(r => r.multiplier < 1.5).length
  const dryPercentage = ((totalDryRounds / data.length) * 100).toFixed(1) || 0

  if (fullView) {
    return (
      <div className="card">
        <h3 className="text-xl font-bold text-white mb-6">Dry Zone Predictor</h3>
        
        {/* Active Warning */}
        {activeZone && (
          <div className="mb-8 p-6 bg-orange-500/10 border-2 border-orange-500/30 rounded-xl">
            <div className="flex items-center space-x-4">
              <div className="p-4 bg-orange-500/20 rounded-full">
                <AlertTriangle className="w-8 h-8 text-orange-400 live-indicator" />
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-bold text-orange-400 mb-1">Active Dry Zone Detected</h4>
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

        {/* Prediction Card */}
        <div className="mb-8 p-6 bg-gradient-to-r from-slate-800 to-slate-900 rounded-xl border border-slate-700">
          <h4 className="text-lg font-semibold text-white mb-4 flex items-center">
            <Clock className="w-5 h-5 mr-2 text-primary-400" />
            Next Dry Zone Prediction
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center p-4 bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-400 mb-2">Probability</p>
              <div className="relative h-20 w-20 mx-auto">
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
                    stroke={prediction.probability > 70 ? '#ef4444' : prediction.probability > 40 ? '#eab308' : '#22c55e'}
                    strokeWidth="3"
                    strokeDasharray={`${prediction.probability}, 100`}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold text-white">{prediction.probability}%</span>
                </div>
              </div>
            </div>
            
            <div className="text-center p-4 bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-400 mb-2">Estimated In</p>
              <p className="text-3xl font-bold text-primary-400">{prediction.estimatedRounds}</p>
              <p className="text-sm text-slate-400">rounds</p>
            </div>
            
            <div className="text-center p-4 bg-slate-800/50 rounded-lg">
              <p className="text-xs text-slate-400 mb-2">Confidence</p>
              <p className={`text-2xl font-bold capitalize ${
                prediction.confidence === 'high' ? 'text-green-400' : 'text-yellow-400'
              }`}>
                {prediction.confidence}
              </p>
              <p className="text-sm text-slate-400">based on {data.length} rounds</p>
            </div>
          </div>
        </div>

        {/* Historical Dry Zones */}
        <div>
          <h4 className="text-lg font-semibold text-white mb-4">Historical Dry Zones</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {dryZones.slice().reverse().map((zone, i) => (
              <div 
                key={i}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  zone.active ? 'bg-orange-500/10 border border-orange-500/30' : 'bg-slate-800/50'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <TrendingDown className={`w-5 h-5 ${zone.active ? 'text-orange-400' : 'text-slate-400'}`} />
                  <span className="text-sm text-slate-300">
                    Zone #{dryZones.length - i}
                  </span>
                  {zone.active && (
                    <span className="text-xs bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full live-indicator">
                      Active
                    </span>
                  )}
                </div>
                <div className="flex items-center space-x-4">
                  <div className="flex space-x-1">
                    {Array.from({ length: Math.min(zone.count, 15) }).map((_, j) => (
                      <div 
                        key={j}
                        className="w-2 h-3 bg-orange-500 rounded-sm"
                      />
                    ))}
                  </div>
                  <span className={`font-bold ${zone.active ? 'text-orange-400' : 'text-slate-300'}`}>
                    {zone.count} rounds
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-2">Total Dry Rounds</p>
            <p className="text-2xl font-bold text-orange-400">{totalDryRounds}</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-2">Dry Zone Frequency</p>
            <p className="text-2xl font-bold text-orange-400">{dryPercentage}%</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Dry Zone Alert</h3>
        <AlertTriangle className={`w-5 h-5 ${activeZone ? 'text-orange-400 live-indicator' : 'text-slate-400'}`} />
      </div>
      
      <div className="space-y-4">
        {activeZone ? (
          <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-orange-400 font-medium">Active Dry Zone</p>
                <p className="text-xs text-slate-400">{activeZone.count} low multipliers</p>
              </div>
              <span className="text-2xl font-bold text-orange-400">{activeZone.count}</span>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-sm text-green-400 font-medium">No Active Dry Zone</p>
            <p className="text-xs text-slate-400">Normal pattern detected</p>
          </div>
        )}
        
        <div className="bg-slate-800/50 rounded-lg p-4">
          <p className="text-xs text-slate-400 mb-2">Next Zone Probability</p>
          <div className="flex items-center space-x-3">
            <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  prediction.probability > 70 ? 'bg-red-500' : 
                  prediction.probability > 40 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${prediction.probability}%` }}
              />
            </div>
            <span className={`text-sm font-bold ${
              prediction.probability > 70 ? 'text-red-400' : 
              prediction.probability > 40 ? 'text-yellow-400' : 'text-green-400'
            }`}>
              {prediction.probability}%
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Est. in {prediction.estimatedRounds} rounds
          </p>
        </div>
      </div>
    </div>
  )
}
