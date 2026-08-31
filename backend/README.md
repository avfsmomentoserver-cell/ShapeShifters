# Crash Curve Analytics - Python Backend

## Requirements
- Python 3.8+
- numpy>=1.20.0
- scipy>=1.7.0
- scikit-learn>=0.24.0
- fastapi>=0.68.0
- uvicorn>=0.15.0
- pydantic>=1.8.0
- pytest>=6.2.0

## Installation

```bash
cd /workspace/backend
pip install -r requirements.txt
```

## Project Structure

```
backend/
├── src/
│   ├── lib/
│   │   └── math_models.py    # Mathematical models (Pareto, GMM, Markov, ETA)
│   ├── db/
│   │   └── database.py       # SQLite database connector
│   ├── api/
│   │   └── main.py          # FastAPI REST endpoints
│   └── analyzer.py          # Main analysis engine
├── tests/
│   └── test_math_models.py  # Comprehensive pytest suite
├── requirements.txt
└── README.md
```

## Running Tests

```bash
cd /workspace/backend
pytest tests/test_math_models.py -v
```

### Test Coverage

The test suite validates:

1. **Pareto Distribution**
   - PDF/CDF correctness
   - MLE parameter estimation
   - Kolmogorov-Smirnov goodness of fit
   - Heavy tail behavior

2. **Exponential Crash Model**
   - Expected value calculation
   - Random sample generation
   - Memoryless property

3. **Markov Chain Streak Analyzer**
   - Transition matrix construction
   - Streak analysis accuracy
   - Stationary distribution

4. **Gaussian Mixture Cluster Analyzer**
   - Clustering accuracy
   - Dry zone identification
   - Moonshot cluster detection

5. **ETA Estimator**
   - Bayesian updating
   - Live round estimation
   - Confidence intervals

6. **Curve Shape Classifier**
   - Distribution fitting
   - Shape classification
   - Error handling

7. **Dry Zone Predictor**
   - Probability estimation
   - Duration prediction
   - Severity scoring

8. **Moonshot Forecaster**
   - High multiplier prediction
   - Time-to-next estimation
   - Risk assessment

9. **Mathematical Correctness**
   - Pareto tail ratio verification
   - Exponential memoryless property
   - Markov stationary distribution

## Running the API Server

```bash
cd /workspace/backend
python -m uvicorn src.api.main:app --reload --host 0.0.0.0 --port 8000
```

API documentation available at: `http://localhost:8000/docs`

## Quick Start Example

```python
import numpy as np
from src.analyzer import CrashAnalyzer

# Initialize analyzer
analyzer = CrashAnalyzer(db_path="momento.db")

# Generate synthetic data for testing
np.random.seed(42)
multipliers = np.concatenate([
    np.random.exponential(1.3, 800) + 1,  # Low multipliers
    np.random.pareto(2, 200) + 1           # High multipliers
])

# Run comprehensive analysis
result = analyzer.analyze(multipliers=multipliers)

print(f"Shape Type: {result.curve_shape['shape_type']}")
print(f"Current Streak: {result.streak_analysis['current_streak']}")
print(f"Dry Zone Probability: {result.dry_zone_prediction['probability_low_zone']:.1%}")
print(f"Moonshot Probability: {result.moonshot_forecast['probability_moonshot']:.1%}")
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/analyze` | GET | Full comprehensive analysis |
| `/analyze/quick` | GET | Quick analysis (faster) |
| `/analyze/live` | POST | Live round ETA estimation |
| `/components/curve-shape` | GET | Curve shape classification |
| `/components/streaks` | GET | Markov chain streak analysis |
| `/components/dry-zone` | GET | GMM dry zone prediction |
| `/components/moonshot` | GET | Moonshot forecasting |
| `/components/eta` | GET | Real-time ETA estimate |
| `/data/rounds` | GET | Historical rounds |
| `/data/stats` | GET | Aggregate statistics |
| `/health` | GET | Health check |

## Mathematical Models

### Pareto Distribution
```
P(X > x) = (x_m / x)^α  for x ≥ x_m
```

Used for modeling heavy-tailed crash distributions.

### Exponential Crash Model
```
P(crash < x) = 1 - (1 - house_edge) * e^(-λ(x-1))
```

Standard model used by most crash platforms.

### Markov Chain for Streaks
```
P = [[P(W|W), P(L|W)],
     [P(W|L), P(L|L)]]
```

Transition matrix for win/loss state analysis.

### Gaussian Mixture Models
```
p(x) = Σ w_k * N(x | μ_k, σ_k²)
```

Clustering for identifying dry zones and moonshot clusters.

### Bayesian ETA Estimation
```
Posterior: Pareto(α + n, max(x_m, max(data)))
Conditional Survival: S(x|t) = S(x) / S(t)
```

Real-time crash point estimation with confidence intervals.

## Performance Benchmarks

| Operation | Time (ms) | Memory (MB) |
|-----------|-----------|-------------|
| Pareto MLE (n=1000) | ~5 | <10 |
| GMM Clustering (n=500) | ~50 | <20 |
| Full Analysis (n=1000) | ~100 | <30 |
| Live ETA Estimate | ~10 | <5 |

## License

MIT License
