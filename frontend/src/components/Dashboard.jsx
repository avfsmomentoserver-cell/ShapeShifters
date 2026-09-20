import { useState, useEffect } from 'react'
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { Play, Pause, RefreshCw, Download, AlertTriangle, TrendingUp, BarChart3, Target } from 'lucide-react'
import CurveShapeAnalyzer from './CurveShapeAnalyzer'
import StreakDetector from './StreakDetector'
import DryZonePredictor from './DryZonePredictor'
import MoonshotForecaster from './MoonshotForecaster'
import ETAEstimator from './ETAEstimator'

export default function Dashboard({ connectionStatus }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [isAutoRefresh, setIsAutoRefresh] = useState(true)
  const [roundData, setRoundData] = useState([])
  const [currentMultiplier, setCurrentMultiplier] = useState(1.00)
  const [selectedShape, setSelectedShape] = useState(null)

  // Fetch real data from watcher API
  const fetchRounds = async () => {
    try {
      const response = await fetch('/api/rounds')
      if (response.ok) {
        const data = await response.json()
        const processedRounds = data.rounds.map((round, index) => ({
          id: index,
          timestamp: round.timestamp,
          time: new Date(round.timestamp).toLocaleTimeString(),
          multiplier: round.multiplier,
          shape: classifyShape(round.multiplier),
          confidence: 0.7 + Math.random() * 0.25
        }))
        setRoundData(processedRounds)
        if (processedRounds.length > 0) {
          setCurrentMultiplier(processedRounds[processedRounds.length - 1].multiplier)
        }
      }
    } catch (error) {
      console.error('Failed to fetch rounds:', error)
    }
  }

  // Real-time data updates from watcher
  useEffect(() => {
    if (!isAutoRefresh || connectionStatus !== 'connected') return

    // Initial fetch
    fetchRounds()

    // Poll for new data every 2 seconds
    const interval = setInterval(fetchRounds, 2000)

    return () => clearInterval(interval)
  }, [isAutoRefresh, connectionStatus])

  const classifyShape = (multiplier) => {
    if (multiplier < 1.5) return 'early-crash'
    if (multiplier < 2.5) return 'standard'
    if (multiplier < 5) return 'extended'
    if (multiplier < 10) return 'moonshot'
    return 'extreme'
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'shapes', label: 'Curve Shapes', icon: TrendingUp },
    { id: 'streaks', label: 'Streaks', icon: Play },
    { id: 'dry-zones', label: 'Dry Zones', icon: AlertTriangle },
    { id: 'moonshots', label: 'Moonshots', icon: Target },
    { id: 'eta', label: 'ETA', icon: RefreshCw }
  ]

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <div className="space-y-6">
            {/* Live Chart */}
            <div className="chart-container">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Live Multiplier Curve</h3>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setIsAutoRefresh(!isAutoRefresh)}
                    className={`p-2 rounded-lg transition-colors ${
                      isAutoRefresh ? 'bg-primary-600 text-white' : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {isAutoRefresh ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button 
                    onClick={() => setRoundData([])}
                    className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={roundData}>
                    <defs>
                      <linearGradient id="colorMultiplier" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="time" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} domain={[0, 'auto']} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#1e293b', 
                        border: '1px solid #334155',
                        borderRadius: '8px'
                      }}
                      labelStyle={{ color: '#94a3b8' }}
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
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Component Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CurveShapeAnalyzer data={roundData} onSelectShape={setSelectedShape} />
              <StreakDetector data={roundData} />
              <DryZonePredictor data={roundData} />
              <MoonshotForecaster data={roundData} />
            </div>

            <ETAEstimator currentMultiplier={currentMultiplier} history={roundData} />
          </div>
        )
      
      case 'shapes':
        return <CurveShapeAnalyzer data={roundData} fullView onSelectShape={setSelectedShape} />
      
      case 'streaks':
        return <StreakDetector data={roundData} fullView />
      
      case 'dry-zones':
        return <DryZonePredictor data={roundData} fullView />
      
      case 'moonshots':
        return <MoonshotForecaster data={roundData} fullView />
      
      case 'eta':
        return <ETAEstimator currentMultiplier={currentMultiplier} history={roundData} fullView />
      
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="card p-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-600/25'
                    : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      {renderContent()}

      {/* Export Button */}
      <div className="flex justify-end">
        <button className="btn-secondary flex items-center space-x-2">
          <Download className="w-4 h-4" />
          <span>Export Data</span>
        </button>
      </div>
    </div>
  )
}
