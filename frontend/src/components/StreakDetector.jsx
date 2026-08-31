import { Play, Pause, TrendingUp, TrendingDown } from 'lucide-react'

export default function StreakDetector({ data, fullView = false }) {
  const calculateStreaks = () => {
    let currentStreak = { type: null, count: 0, start: null }
    const streaks = []
    
    for (let i = 1; i < data.length; i++) {
      const prev = data[i - 1]
      const curr = data[i]
      
      const type = curr.multiplier >= 2 ? 'win' : 'loss'
      
      if (currentStreak.type === type) {
        currentStreak.count++
      } else {
        if (currentStreak.count > 0) {
          streaks.push({ ...currentStreak, end: i - 1 })
        }
        currentStreak = { type, count: 1, start: i }
      }
    }
    
    if (currentStreak.count > 0) {
      streaks.push({ ...currentStreak, end: data.length - 1, current: true })
    }
    
    return streaks
  }

  const streaks = calculateStreaks()
  const currentStreak = streaks.find(s => s.current) || { type: null, count: 0 }
  
  const hotStreaks = streaks.filter(s => s.type === 'win' && s.count >= 3).length
  const coldStreaks = streaks.filter(s => s.type === 'loss' && s.count >= 3).length
  
  const maxWinStreak = Math.max(...streaks.filter(s => s.type === 'win').map(s => s.count), 0)
  const maxLossStreak = Math.max(...streaks.filter(s => s.type === 'loss').map(s => s.count), 0)

  if (fullView) {
    return (
      <div className="card">
        <h3 className="text-xl font-bold text-white mb-6">Streak Analysis</h3>
        
        {/* Current Streak */}
        <div className={`mb-8 p-6 rounded-xl border-2 ${
          currentStreak.type === 'win' 
            ? 'bg-green-500/10 border-green-500/30' 
            : currentStreak.type === 'loss'
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-slate-700/30 border-slate-600/30'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className={`p-4 rounded-full ${
                currentStreak.type === 'win' 
                  ? 'bg-green-500/20' 
                  : currentStreak.type === 'loss'
                  ? 'bg-red-500/20'
                  : 'bg-slate-600/20'
              }`}>
                {currentStreak.type === 'win' ? (
                  <TrendingUp className="w-8 h-8 text-green-400" />
                ) : currentStreak.type === 'loss' ? (
                  <TrendingDown className="w-8 h-8 text-red-400" />
                ) : (
                  <Play className="w-8 h-8 text-slate-400" />
                )}
              </div>
              <div>
                <p className="text-sm text-slate-400">Current Streak</p>
                <p className={`text-3xl font-bold ${
                  currentStreak.type === 'win' ? 'text-green-400' 
                  : currentStreak.type === 'loss' ? 'text-red-400'
                  : 'text-slate-400'
                }`}>
                  {currentStreak.count} {currentStreak.type === 'win' ? 'wins' : currentStreak.type === 'loss' ? 'losses' : 'rounds'}
                </p>
              </div>
            </div>
            
            {currentStreak.current && (
              <div className="flex items-center space-x-2 bg-primary-500/20 px-4 py-2 rounded-full">
                <div className="w-2 h-2 bg-primary-400 rounded-full live-indicator" />
                <span className="text-sm font-medium text-primary-400">Active</span>
              </div>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-2">Hot Streaks (3+)</p>
            <p className="text-2xl font-bold text-green-400">{hotStreaks}</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-2">Cold Streaks (3+)</p>
            <p className="text-2xl font-bold text-red-400">{coldStreaks}</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-2">Max Win Streak</p>
            <p className="text-2xl font-bold text-green-400">{maxWinStreak}</p>
          </div>
          <div className="stat-card text-center">
            <p className="text-xs text-slate-400 mb-2">Max Loss Streak</p>
            <p className="text-2xl font-bold text-red-400">{maxLossStreak}</p>
          </div>
        </div>

        {/* Recent Streaks Timeline */}
        <div>
          <h4 className="text-lg font-semibold text-white mb-4">Recent Streaks</h4>
          <div className="space-y-2">
            {streaks.slice(-10).reverse().map((streak, i) => (
              <div 
                key={i}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  streak.type === 'win' ? 'bg-green-500/10' : 'bg-red-500/10'
                }`}
              >
                <div className="flex items-center space-x-3">
                  {streak.type === 'win' ? (
                    <TrendingUp className="w-5 h-5 text-green-400" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-red-400" />
                  )}
                  <span className="text-sm text-slate-300">
                    {streak.type === 'win' ? 'Win' : 'Loss'} Streak
                  </span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="flex space-x-1">
                    {Array.from({ length: Math.min(streak.count, 10) }).map((_, j) => (
                      <div 
                        key={j}
                        className={`w-2 h-4 rounded-sm ${
                          streak.type === 'win' ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`font-bold ${
                    streak.type === 'win' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {streak.count}
                  </span>
                  {streak.current && (
                    <span className="text-xs bg-primary-500/20 text-primary-400 px-2 py-0.5 rounded-full">
                      Active
                    </span>
                  )}
                </div>
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
        <h3 className="text-lg font-semibold text-white">Streak Detector</h3>
        {currentStreak.current ? (
          <Pause className="w-5 h-5 text-primary-400" />
        ) : (
          <Play className="w-5 h-5 text-slate-400" />
        )}
      </div>
      
      <div className="space-y-4">
        <div className={`p-4 rounded-lg ${
          currentStreak.type === 'win' 
            ? 'bg-green-500/10 border border-green-500/30' 
            : currentStreak.type === 'loss'
            ? 'bg-red-500/10 border border-red-500/30'
            : 'bg-slate-700/30 border border-slate-600/30'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {currentStreak.type === 'win' ? (
                <TrendingUp className="w-5 h-5 text-green-400" />
              ) : currentStreak.type === 'loss' ? (
                <TrendingDown className="w-5 h-5 text-red-400" />
              ) : (
                <Play className="w-5 h-5 text-slate-400" />
              )}
              <span className="text-sm text-slate-300">Current</span>
            </div>
            <span className={`text-2xl font-bold ${
              currentStreak.type === 'win' ? 'text-green-400' 
              : currentStreak.type === 'loss' ? 'text-red-400'
              : 'text-slate-400'
            }`}>
              {currentStreak.count}
            </span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-green-500/10 rounded-lg p-3 text-center">
            <p className="text-xs text-green-400 mb-1">Hot Streaks</p>
            <p className="text-lg font-bold text-green-400">{hotStreaks}</p>
          </div>
          <div className="bg-red-500/10 rounded-lg p-3 text-center">
            <p className="text-xs text-red-400 mb-1">Cold Streaks</p>
            <p className="text-lg font-bold text-red-400">{coldStreaks}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
