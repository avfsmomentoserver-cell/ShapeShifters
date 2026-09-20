# ShapeShifters Project Rules

## Project Overview
This is a crash curve analytics platform with Node.js file watcher, Python prediction backend, and React frontend. The system provides mathematical analysis of crash game data for predicting multipliers, streaks, dry zones, and moonshot clusters.

## Tech Stack
- **Frontend**: React with Vite, TailwindCSS
- **Data Watcher**: Node.js file watching server (port 8787)
- **Prediction Backend**: Python FastAPI with mathematical models (port 8000)
- **Database**: JSON file storage + SQLite for Python backend
- **Build Tool**: Vite

## Development Commands
- **Start data watcher**: `MOMENTO_WATCH_DIR="$HOME/Downloads" PYTHON_BACKEND_URL="http://localhost:8000" node server/live-db.mjs`
- **Start Python backend**: `cd backend && python -m uvicorn src.api.main:app --reload --host 0.0.0.0 --port 8000`
- **Start frontend dev server**: `cd frontend && npm run dev` (runs on port 3000)
- **Build frontend**: `cd frontend && npm run build`
- **Install frontend deps**: `cd frontend && npm install`

## Data Flow
1. JSON files appear in `~/Downloads` (from external data collection)
2. Node.js watcher ingests files and stores in `data/rounds.json`
3. Watcher sends rounds to Python backend for mathematical analysis
4. Frontend polls watcher API for live round data
5. Frontend can request analysis from Python backend via watcher proxy

## Data Watcher (Node.js)
- Watches `~/Downloads` for JSON crash data files
- API endpoints: `/api/health`, `/api/rounds`
- Proxies analysis requests to Python backend
- Stores data in `data/rounds.json` (max 5000 rounds)

## Prediction Backend (Python)
- Python 3.8+ required
- Mathematical models: Pareto, Exponential, Markov Chains, GMM, Bayesian ETA
- **NEW**: Adaptive parameter estimation with exponential smoothing
- **NEW**: Ensemble predictor combining multiple models
- **NEW**: Hidden Markov Models for regime detection
- API endpoints: `/analyze`, `/components/*`, `/data/*`
- SQLite database for round storage and analysis
- Install deps: `pip install -r requirements.txt`

## Frontend (React)
- React with Vite build tool
- TailwindCSS for styling
- Recharts for data visualization
- Fetches live rounds from watcher API: `/api/rounds`
- Auto-refreshes every 2 seconds
- Components in `frontend/src/components/`

## General Development
- Git branch: currently on `implementing-solutions-7421f`
- Main branch: `main`
- Development branch: `calibrated`
- Use conventional commit messages
- Always test changes before marking tasks complete
- Mathematical correctness is paramount - all models must be verifiable

## Environment Setup
- Node.js 20.x required (use nvm if needed)
- Python 3.8+ with pip
- Ensure NVM is loaded: `export NVM_DIR="$HOME/.config/nvm" && . "$NVM_DIR/nvm.sh"`

## Key Files
- `README.md` - Project documentation
- `AGENTS.md` - This file (agent configuration)
- `PREDICTION_PIPELINE_ANALYSIS.md` - Mathematical model analysis (updated v2.0)
- `.devin/config.json` - Devin CLI configuration
- `server/live-db.mjs` - Data watcher implementation
- `backend/src/lib/math_models.py` - Mathematical models (updated with adaptive/ensemble/HMM)
- `backend/src/analyzer.py` - Main analysis engine (updated with new features)
- `frontend/src/components/Dashboard.jsx` - Main dashboard component

## Recent Improvements (v2.0)
- Adaptive parameter estimation for time-varying conditions
- Ensemble methods combining Pareto, Exponential, GMM, and Markov models
- Hidden Markov Models for regime detection (low/moderate/high volatility)
- Enhanced uncertainty quantification with model disagreement measurement
- Confidence-weighted ensemble predictions for moonshot and moderate win probabilities
