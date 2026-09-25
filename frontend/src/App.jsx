import { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard'
import { TrendingUp, Clock } from 'lucide-react'

function App() {
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [lastUpdate, setLastUpdate] = useState(null)

  useEffect(() => {
    // Check if backend is reachable
    const checkConnection = async () => {
      try {
        const res = await fetch('/api/')
        if (res.ok) {
          setConnectionStatus('connected')
        } else {
          setConnectionStatus('demo')
        }
      } catch {
        // Backend not running - use demo mode
        setConnectionStatus('demo')
      }
      setLastUpdate(new Date())
    }

    checkConnection()
    const interval = setInterval(checkConnection, 30000)

    return () => clearInterval(interval)
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
                <h1 className="text-xl font-bold text-white">ShapeShifters</h1>
                <p className="text-xs text-slate-400">Crash Curve Analytics & Forecasting Engine</p>
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
                  : connectionStatus === 'demo'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-yellow-500/20 text-yellow-400'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-green-400 live-indicator' : 
                  connectionStatus === 'demo' ? 'bg-yellow-400' : 'bg-yellow-400'
                }`} />
                <span>{connectionStatus === 'connected' ? 'Live' : connectionStatus === 'demo' ? 'Demo Mode' : 'Connecting...'}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <Dashboard connectionStatus={connectionStatus} />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-700/50 mt-8 py-4">
        <div className="container mx-auto px-4 text-center text-xs text-slate-500">
          <p>ShapeShifters v1.0 • Powered by Stochastic Modeling, Pareto Distributions, Markov Chains & Ensemble Forecasting</p>
        </div>
      </footer>
    </div>
  )
}

export default App
