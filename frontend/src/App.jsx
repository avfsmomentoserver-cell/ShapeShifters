import { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard'
import { Activity, TrendingUp, Clock, Zap } from 'lucide-react'

function App() {
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [lastUpdate, setLastUpdate] = useState(null)

  useEffect(() => {
    // Simulate connection check
    const timer = setTimeout(() => {
      setConnectionStatus('connected')
      setLastUpdate(new Date())
    }, 1000)

    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="border-b border-slate-700/50 backdrop-blur-sm bg-slate-900/50 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="bg-gradient-to-r from-primary-500 to-primary-600 p-2 rounded-lg">
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Crash Curve Analytics</h1>
                <p className="text-xs text-slate-400">Shape-Based Forecasting Engine</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-sm">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-slate-400">
                  {lastUpdate ? lastUpdate.toLocaleTimeString() : '--:--:--'}
                </span>
              </div>
              
              <div className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                connectionStatus === 'connected' 
                  ? 'bg-green-500/20 text-green-400' 
                  : 'bg-yellow-500/20 text-yellow-400'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-400 live-indicator' : 'bg-yellow-400'
                }`} />
                <span>{connectionStatus === 'connected' ? 'Live' : 'Connecting...'}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        {/* Quick Stats Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="stat-card flex items-center space-x-3">
            <div className="bg-primary-500/20 p-3 rounded-lg">
              <Activity className="w-5 h-5 text-primary-400" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Active Patterns</p>
              <p className="text-lg font-bold text-white">12</p>
            </div>
          </div>
          
          <div className="stat-card flex items-center space-x-3">
            <div className="bg-crash-green/20 p-3 rounded-lg">
              <TrendingUp className="w-5 h-5 text-crash-green" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Success Rate</p>
              <p className="text-lg font-bold text-white">73.4%</p>
            </div>
          </div>
          
          <div className="stat-card flex items-center space-x-3">
            <div className="bg-crash-yellow/20 p-3 rounded-lg">
              <Clock className="w-5 h-5 text-crash-yellow" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Avg Round Time</p>
              <p className="text-lg font-bold text-white">8.2s</p>
            </div>
          </div>
          
          <div className="stat-card flex items-center space-x-3">
            <div className="bg-crash-purple/20 p-3 rounded-lg">
              <Zap className="w-5 h-5 text-crash-purple" />
            </div>
            <div>
              <p className="text-xs text-slate-400">Moonshot Alert</p>
              <p className="text-lg font-bold text-white">2 pending</p>
            </div>
          </div>
        </div>

        {/* Dashboard */}
        <Dashboard connectionStatus={connectionStatus} />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-700/50 mt-8 py-4">
        <div className="container mx-auto px-4 text-center text-xs text-slate-500">
          <p>Crash Curve Analytics v1.0 • Powered by Stochastic Modeling & Pattern Recognition</p>
        </div>
      </footer>
    </div>
  )
}

export default App
