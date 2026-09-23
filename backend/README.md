# Momento Python Backend — Crash-Curve Analytics Engine

Full Python 3 backend ported from the validated MomentoV5 / ShapeShifters pipeline.

## Engines (all independently tested)

| Engine | File | Logic |
| --- | --- | --- |
| Pareto tail model | `momento/math_models.py` | MLE `x_m = min(x)`, `α = n / Σ ln(x_i/x_m)`; survival `(x_m/x)^α` |
| Exponential crash model | `momento/math_models.py` | `P(crash < x) = 1 − (1−edge)·e^(−λ(x−1))`, λ from tail mean with 4% house edge |
| Markov streak engine | `momento/math_models.py` | win/loss states at 2×, empirical transition matrix, E[run] = 1/(1−p) |
| GMM clustering | `momento/math_models.py` | k-means on log multipliers (dry zone / mid / moon clusters) |
| Regime detector | `momento/math_models.py` | rolling-volatility bands (deterministic fallback of the Gaussian HMM) |
| Curve-shape fitting | `momento/math_models.py` | exponential / power-law / logistic via R² in transformed space |
| Ensemble + ETA | `momento/math_models.py` | confidence-weighted blend; survival = exponential bulk ⊕ Pareto tail |
| Ladder pressure | `momento/pipeline.py` | resistance ceilings, pressure score, release ETA adjustments |
| DNA analogues | `momento/pipeline.py` | z-normalized 8-round pattern match, top-6 vote on outcome |
| Forecast candidates | `momento/pipeline.py` | Markov row + overdue/ladder/DNA tilts, normalized to 1 |

## API (FastAPI)

```
GET  /api/health
GET  /api/rounds?limit=1000
POST /api/rounds            {"multiplier": 2.47}        # ingest one round
POST /api/rounds/bulk       {"multipliers": [...]}      # bulk ingest
GET  /api/analysis          # full payload (state, percentiles, engines)
GET  /api/forecast          # ranked candidates + drivers
GET  /api/eta               # crash-point ETA + survival curve
GET  /api/curves            # curve-shape distribution
WS   /ws/rounds             # live push on each ingest
```

## Run

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run_api.py            # http://localhost:8000  (docs at /docs)
pytest tests/ -q             # engine test suite
```

SQLite database `momento.db` (WAL mode) stores rounds, forecasts and engine metrics.

## Principles

1. Observation before prediction
2. Immutable raw events — corrections recorded separately
3. Explainability mandatory — every forecast carries driver metadata
4. Local-first: SQLite works with zero cloud dependencies
