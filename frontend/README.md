# Crash Curve Analytics Frontend

Real-time crash game analytics dashboard with shape-based forecasting, built with React + Vite + TailwindCSS.

## Features

### 📊 Core Components

1. **Curve Shape Analyzer** - Classifies rounds into 5 categories:
   - Early Crash (<1.5x)
   - Standard (1.5-2.5x)
   - Extended (2.5-5x)
   - Moonshot (5-10x)
   - Extreme (>10x)

2. **Streak Detector** - Tracks win/loss streaks in real-time:
   - Current streak monitoring
   - Hot/cold streak identification
   - Historical streak timeline

3. **Dry Zone Predictor** - Predicts low multiplier clusters:
   - Active dry zone alerts
   - Probability estimation
   - Historical pattern analysis

4. **Moonshot Forecaster** - Identifies high multiplier opportunities:
   - Cluster detection
   - Momentum tracking
   - Next moonshot prediction

5. **ETA Estimator** - Real-time crash point estimation:
   - Stochastic modeling
   - Confidence levels
   - Probability distribution

## Installation

```bash
cd frontend
npm install
npm run dev
```

## Configuration

Update `vite.config.js` to connect to your backend:

```javascript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8000', // Your backend URL
      changeOrigin: true
    }
  }
}
```

## Project Structure

```
frontend/
├── src/
│   ├── components/
│   │   ├── Dashboard.jsx         # Main dashboard with tabs
│   │   ├── CurveShapeAnalyzer.jsx
│   │   ├── StreakDetector.jsx
│   │   ├── DryZonePredictor.jsx
│   │   ├── MoonshotForecaster.jsx
│   │   └── ETAEstimator.jsx
│   ├── App.jsx                   # Root component
│   ├── main.jsx                  # Entry point
│   └── index.css                 # Global styles
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## API Integration

The frontend expects the following API endpoints from the backend:

```javascript
// Get recent rounds
GET /api/rounds?limit=100

// Get curve shapes
GET /api/shapes

// Get streak data
GET /api/streaks

// Get predictions
GET /api/predictions

// WebSocket for real-time updates
WS ws://localhost:8000/ws
```

## Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run linter
npm run lint
```

## Technologies

- **React 18** - UI framework
- **Vite** - Build tool & dev server
- **TailwindCSS** - Styling
- **Recharts** - Charts & visualization
- **Lucide React** - Icons
- **Axios** - HTTP client
- **date-fns** - Date formatting

## License

MIT
