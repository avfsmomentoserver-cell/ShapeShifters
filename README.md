# ShapeShifters - Crash Curve Analytics Platform

A comprehensive mathematical analysis platform for crash game prediction using stochastic models, statistical analysis, and machine learning techniques.

## Overview

ShapeShifters provides real-time analysis of crash game data with mathematical rigor:
- **Curve Shape Analysis**: Classifies crash patterns using statistical fitting
- **Streak Detection**: Markov chain-based win/loss sequence analysis  
- **Dry Zone Prediction**: GMM clustering for low multiplier periods
- **Moonshot Forecasting**: Extreme value theory for high multiplier events
- **ETA Estimation**: Bayesian real-time crash point estimation

## Architecture

### Data Flow
1. **Ingestion**: JSON files appear in `~/Downloads` from external data collection
2. **Watcher**: Node.js server processes files and stores in local JSON database
3. **Backend**: Python FastAPI server performs mathematical analysis
4. **Frontend**: React dashboard displays real-time predictions and visualizations

### Components

#### Data Watcher (Node.js)
- **Port**: 8787
- **File**: `server/live-db.mjs`
- **Watch Directory**: `~/Downloads`
- **API Endpoints**: `/api/health`, `/api/rounds`
- **Storage**: `data/rounds.json` (max 5000 rounds)

#### Prediction Backend (Python)
- **Port**: 8000
- **Framework**: FastAPI
- **Database**: SQLite (`momento.db`)
- **Mathematical Models**: Pareto, Exponential, Markov Chains, GMM, Bayesian ETA
- **API Endpoints**: `/analyze`, `/components/*`, `/data/*`

#### Frontend Dashboard (React)
- **Port**: 3000
- **Framework**: React + Vite + TailwindCSS
- **Visualization**: Recharts
- **Update Frequency**: 2-second polling
- **Components**: Dashboard, Curve Shapes, Streaks, Dry Zones, Moonshots, ETA

## Installation

### Prerequisites
- Node.js 20.x (use nvm)
- Python 3.8+
- npm

### Setup

```bash
# Clone repository
git clone https://github.com/avfsmomentoserver-cell/ShapeShifters.git
cd ShapeShifters

# Install Node.js if needed
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm install 20

# Install Python dependencies
sudo apt install python3-fastapi python3-uvicorn python3-numpy python3-scipy python3-sklearn python3-pydantic python3-pytest

# Install frontend dependencies
cd frontend
npm install
cd ..
```

## Development

### Start All Services

```bash
# Terminal 1: Start Python backend
cd backend
python3 -m uvicorn src.api.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2: Start data watcher
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
MOMENTO_WATCH_DIR="$HOME/Downloads" PYTHON_BACKEND_URL="http://localhost:8000" node server/live-db.mjs

# Terminal 3: Start frontend
cd frontend
export NVM_DIR="$HOME/.config/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npm run dev
```

### Data Ingestion

Place JSON crash data files in `~/Downloads` with format:
```json
{
  "source": "aviator",
  "collectedAt": "2026-09-20T13:40:00.000Z",
  "rounds": [
    {
      "timestamp": "2026-09-20T13:40:00.000Z",
      "multiplier": 3.5,
      "color": "rgb(100, 200, 100)",
      "source": "aviator"
    }
  ]
}
```

## Mathematical Models

### Pareto Distribution
Models heavy-tailed crash multiplier distributions:
- Formula: `P(X > x) = (x_m / x)^α`
- Parameters: x_m (minimum), α (tail index)
- MLE estimation with KS goodness-of-fit testing

### Markov Chain Streak Analyzer
Analyzes win/loss sequences:
- States: win (≥2x), loss (<2x)
- Transition matrix: P = [[P(W|W), P(L|W)], [P(W|L), P(L|L)]]
- Expected duration via geometric distribution

### Gaussian Mixture Models
Identifies clusters in multiplier space:
- Log-transform for skewness handling
- EM algorithm for parameter estimation
- Bootstrap confidence intervals

### Bayesian ETA Estimator
Real-time crash point estimation:
- Conjugate Pareto prior/posterior
- Conditional survival function
- Hazard rate calculation

## API Documentation

### Watcher API (Port 8787)
- `GET /api/health` - Health check
- `GET /api/rounds` - Get all rounds
- `POST /api/rounds` - Add new rounds

### Prediction API (Port 8000)
- `GET /analyze` - Full comprehensive analysis
- `GET /analyze/quick` - Quick analysis
- `POST /analyze/live` - Live round ETA
- `GET /components/curve-shape` - Curve classification
- `GET /components/streaks` - Streak analysis
- `GET /components/dry-zone` - Dry zone prediction
- `GET /components/moonshot` - Moonshot forecast
- `GET /components/eta` - ETA estimation
- `GET /data/rounds` - Historical rounds
- `GET /data/stats` - Aggregate statistics

## Configuration

### Environment Variables
- `MOMENTO_WATCH_DIR`: Directory to watch for JSON files (default: `~/Downloads`)
- `PYTHON_BACKEND_URL`: Python backend URL (default: `http://localhost:8000`)
- `PORT`: Watcher server port (default: 8787)

### Frontend Configuration
Update `frontend/vite.config.js` to change proxy targets if needed.

## Testing

### Backend Tests
```bash
cd backend
pytest tests/ -v
```

### Frontend Linter
```bash
cd frontend
npm run lint
```

## Branch Strategy

- `main`: Stable production branch
- `calibrated`: Development branch with watcher integration
- `implementing-solutions-7421f`: Feature development branch

## Performance

- **Watcher**: <10ms per file ingestion
- **Python Analysis**: ~100ms for 1000 rounds
- **Frontend Polling**: 2-second intervals
- **Database**: JSON storage (max 5000 rounds)

## License

MIT License

## Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes with conventional messages
4. Push to branch
5. Open Pull Request

## Support

For issues and questions, please open an issue on GitHub.
