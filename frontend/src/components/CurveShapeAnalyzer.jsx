import { TrendingUp, Activity, Zap } from 'lucide-react'

export default function CurveShapeAnalyzer({ data, fullView = false, onSelectShape }) {
  const shapeStats = data.reduce((acc, round) => {
    acc[round.shape] = (acc[round.shape] || 0) + 1
    return acc
  }, {})

  const shapes = [
    { 
      id: 'early-crash', 
      label: 'Early Crash', 
      range: '< 1.5x',
      color: 'bg-red-500',
      textColor: 'text-red-400',
      bgColor: 'bg-red-500/20',
      borderColor: 'border-red-500/30',
      icon: Activity,
      description: 'Quick crashes indicating high volatility'
    },
    { 
      id: 'standard', 
      label: 'Standard', 
      range: '1.5-2.5x',
      color: 'bg-yellow-500',
      textColor: 'text-yellow-400',
      bgColor: 'bg-yellow-500/20',
      borderColor: 'border-yellow-500/30',
      icon: TrendingUp,
      description: 'Normal distribution pattern'
    },
    { 
      id: 'extended', 
      label: 'Extended', 
      range: '2.5-5x',
      color: 'bg-green-500',
      textColor: 'text-green-400',
      bgColor: 'bg-green-500/20',
      borderColor: 'border-green-500/30',
      icon: TrendingUp,
      description: 'Above average performance'
    },
    { 
      id: 'moonshot', 
      label: 'Moonshot', 
      range: '5-10x',
      color: 'bg-purple-500',
      textColor: 'text-purple-400',
      bgColor: 'bg-purple-500/20',
      borderColor: 'border-purple-500/30',
      icon: Zap,
      description: 'High multiplier clusters detected'
    },
    { 
      id: 'extreme', 
      label: 'Extreme', 
      range: '> 10x',
      color: 'bg-pink-500',
      textColor: 'text-pink-400',
      bgColor: 'bg-pink-500/20',
      borderColor: 'border-pink-500/30',
      icon: Zap,
      description: 'Rare extreme events'
    }
  ]

  const total = data.length || 1

  if (fullView) {
    return (
      <div className="card">
        <h3 className="text-xl font-bold text-white mb-6">Curve Shape Analysis</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shapes.map(shape => {
            const count = shapeStats[shape.id] || 0
            const percentage = ((count / total) * 100).toFixed(1)
            const Icon = shape.icon
            
            return (
              <button
                key={shape.id}
                onClick={() => onSelectShape?.(shape.id)}
                className={`${shape.bgColor} ${shape.borderColor} border rounded-xl p-5 text-left hover:scale-105 transition-transform duration-200`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`${shape.textColor} p-2 rounded-lg bg-slate-900/30`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <span className={`text-2xl font-bold ${shape.textColor}`}>{percentage}%</span>
                </div>
                
                <h4 className="text-lg font-semibold text-white mb-1">{shape.label}</h4>
                <p className="text-sm text-slate-400 mb-2">{shape.range}</p>
                <p className="text-xs text-slate-500">{shape.description}</p>
                
                <div className="mt-3 pt-3 border-t border-slate-700/50">
                  <p className="text-xs text-slate-400">
                    <span className="font-semibold text-white">{count}</span> rounds detected
                  </p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Shape Distribution Chart */}
        <div className="mt-8">
          <h4 className="text-lg font-semibold text-white mb-4">Distribution Timeline</h4>
          <div className="h-48 flex items-end space-x-1">
            {data.slice(-50).map((round, i) => (
              <div
                key={i}
                className={`flex-1 rounded-t ${
                  shapes.find(s => s.id === round.shape)?.color || 'bg-slate-500'
                }`}
                style={{ height: `${Math.min(round.multiplier * 10, 100)}%` }}
                title={`${round.time}: ${round.multiplier}x (${round.shape})`}
              />
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-slate-500">
            <span>50 rounds ago</span>
            <span>Now</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Curve Shapes</h3>
        <Activity className="w-5 h-5 text-primary-400" />
      </div>
      
      <div className="space-y-3">
        {shapes.slice(0, 4).map(shape => {
          const count = shapeStats[shape.id] || 0
          const percentage = ((count / total) * 100).toFixed(0)
          
          return (
            <div key={shape.id} className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${shape.color}`} />
                <span className="text-sm text-slate-300">{shape.label}</span>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div 
                    className={`h-full ${shape.color} transition-all duration-500`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <span className={`text-sm font-medium ${shape.textColor} w-10 text-right`}>
                  {percentage}%
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
