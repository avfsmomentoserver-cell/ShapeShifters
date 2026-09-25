"""
FastAPI Backend for Crash Curve Analytics
Provides REST API endpoints for all analysis components.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List, Dict
import numpy as np
import time
import math
import os

from src.analyzer import CrashAnalyzer, AnalysisResult
from src.db.database import DatabaseConnector
from src.lib.grouped_eta_predictor import GroupedETAPredictor, RegimeDetector


# Initialize FastAPI app
app = FastAPI(
    title="Crash Curve Analytics API",
    description="Mathematical analysis engine for crash game prediction using stochastic models, Pareto distributions, Markov chains, and GMM clustering",
    version="1.0.0"
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global analyzer instance
analyzer = None


import os

# Path to the database relative to the project root
_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "momento.db")

@app.on_event("startup")
async def startup_event():
    """Initialize analyzer on startup"""
    global analyzer
    db_path = _DB_PATH if os.path.exists(_DB_PATH) else "momento.db"
    analyzer = CrashAnalyzer(db_path=db_path)


# Pydantic models for request/response validation
class MultiplierInput(BaseModel):
    multipliers: List[float]


class LiveRoundInput(BaseModel):
    current_multiplier: float


class RoundInput(BaseModel):
    timestamp: float
    multiplier: float
    hash: str
    server_seed: Optional[str] = ""
    client_seed: Optional[str] = ""
    nonce: Optional[int] = 0


# ==================== MAIN ANALYSIS ENDPOINTS ====================

@app.get("/")
async def root():
    """API health check and info"""
    return {
        "service": "Crash Curve Analytics API",
        "version": "1.0.0",
        "status": "running",
        "endpoints": [
            "/forecast/summary - Unified commercial forecast summary",
            "/analyze - Full analysis",
            "/analyze/quick - Quick analysis",
            "/analyze/live - Live round ETA",
            "/components/curve-shape - Curve shape classification",
            "/components/streaks - Streak analysis",
            "/components/dry-zone - Dry zone prediction",
            "/components/moonshot - Moonshot forecast",
            "/components/grouped-eta - Grouped ETA trajectory",
            "/data/rounds - Get historical rounds",
            "/data/stats - Get statistics"
        ]
    }


@app.get("/analyze", response_model=Dict)
async def full_analysis(limit: int = Query(1000, ge=10, le=10000)):
    """
    Perform comprehensive analysis on historical data.
    
    Returns all components:
    - Basic statistics
    - Pareto distribution fit
    - Curve shape classification
    - Streak analysis (Markov chains)
    - Dry zone prediction (GMM)
    - Moonshot forecast
    """
    try:
        result = analyzer.analyze(force_refresh=True)
        
        return {
            "success": True,
            "timestamp": result.timestamp,
            "rounds_analyzed": result.rounds_analyzed,
            "basic_statistics": result.basic_statistics,
            "pareto_parameters": result.pareto_parameters,
            "curve_shape": result.curve_shape,
            "streak_analysis": result.streak_analysis,
            "dry_zone_prediction": result.dry_zone_prediction,
            "moonshot_forecast": result.moonshot_forecast
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze/custom")
async def custom_analysis(data: MultiplierInput):
    """
    Analyze custom multiplier array.
    
    Useful for testing with synthetic data or external sources.
    """
    try:
        multipliers = np.array(data.multipliers)
        result = analyzer.analyze(multipliers=multipliers, force_refresh=True)
        
        return {
            "success": True,
            "timestamp": result.timestamp,
            "rounds_analyzed": result.rounds_analyzed,
            "basic_statistics": result.basic_statistics,
            "pareto_parameters": result.pareto_parameters,
            "curve_shape": result.curve_shape,
            "streak_analysis": result.streak_analysis,
            "dry_zone_prediction": result.dry_zone_prediction,
            "moonshot_forecast": result.moonshot_forecast
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/analyze/quick")
async def quick_analysis(limit: int = Query(500, ge=10, le=5000)):
    """
    Quick analysis with reduced computation.
    Faster but less detailed than full analysis.
    """
    try:
        multipliers = analyzer.get_multipliers(limit=limit)
        result = analyzer.quick_analysis(multipliers)
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/analyze/live")
async def live_analysis(data: LiveRoundInput):
    """
    Analyze a live round in progress.
    
    Provides real-time ETA estimation using survival analysis.
    """
    try:
        result = analyzer.analyze_live_round(data.current_multiplier)
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== COMPONENT ENDPOINTS ====================

@app.get("/components/curve-shape")
async def get_curve_shape(limit: int = Query(1000, ge=10)):
    """
    Get curve shape classification.
    
    Identifies distribution pattern:
    - exponential: Standard decay
    - power_law: Heavy-tailed
    - bimodal: Two clusters
    - uniform: Random
    - clustered: Tight grouping
    """
    try:
        multipliers = analyzer.get_multipliers(limit=limit)
        result = analyzer._analyze_curve_shape(multipliers)
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/components/streaks")
async def get_streaks(limit: int = Query(1000, ge=10)):
    """
    Get streak analysis using Markov chains.
    
    Returns:
    - Current streak length and type
    - Expected duration
    - Continuation probability
    - Transition matrix
    - Historical max streak
    """
    try:
        multipliers = analyzer.get_multipliers(limit=limit)
        result = analyzer._analyze_streaks(multipliers)
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/components/dry-zone")
async def get_dry_zone(limit: int = Query(500, ge=50)):
    """
    Get dry zone prediction using GMM clustering.
    
    Predicts periods of consistently low multipliers (<2x).
    """
    try:
        multipliers = analyzer.get_multipliers(limit=limit)
        result = analyzer._predict_dry_zone(multipliers)
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/components/moonshot")
async def get_moonshot(limit: int = Query(500, ge=50)):
    """
    Get moonshot forecast for high multipliers (≥5x).
    
    Uses extreme value theory and cluster analysis.
    """
    try:
        multipliers = analyzer.get_multipliers(limit=limit)
        result = analyzer._forecast_moonshot(multipliers)
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/components/eta")
async def get_eta(current_multiplier: float = Query(ge=1.0)):
    """
    Get ETA estimate for current live round.
    
    Real-time crash point estimation using Bayesian updating.
    """
    try:
        result = analyzer.analyze_live_round(current_multiplier)
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== DATA ENDPOINTS ====================

@app.get("/data/rounds")
async def get_rounds(count: int = Query(100, ge=1, le=1000)):
    """Get recent historical rounds"""
    try:
        rounds = analyzer.db.get_recent_rounds(count=count)
        
        return {
            "success": True,
            "count": len(rounds),
            "rounds": [
                {
                    "id": r.id,
                    "timestamp": r.timestamp,
                    "multiplier": r.multiplier,
                    "hash": r.hash
                }
                for r in rounds
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/data/stats")
async def get_statistics():
    """Get aggregate database statistics"""
    try:
        stats = analyzer.db.get_statistics()
        
        return {
            "success": True,
            "data": stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/data/round")
async def add_round(data: RoundInput):
    """Add a new round to database"""
    try:
        round_id = analyzer.db.insert_round(
            timestamp=data.timestamp,
            multiplier=data.multiplier,
            hash=data.hash,
            server_seed=data.server_seed,
            client_seed=data.client_seed,
            nonce=data.nonce
        )
        
        return {
            "success": True,
            "round_id": round_id
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/data/rounds/batch")
async def add_rounds_batch(rounds: List[RoundInput]):
    """Add multiple rounds efficiently"""
    try:
        round_tuples = [
            (r.timestamp, r.multiplier, r.hash, r.server_seed, r.client_seed, r.nonce)
            for r in rounds
        ]
        
        count = analyzer.db.insert_rounds_batch(round_tuples)
        
        return {
            "success": True,
            "inserted_count": count
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/components/grouped-eta")
async def get_grouped_eta(horizon: int = Query(100, ge=10, le=500), n_groups: int = Query(3, ge=1, le=10)):
    """
    Get grouped ETA trajectory predictions.
    
    Smart clustering-based prediction with:
    - Regime detection (6 market states)
    - Ensemble forecasting (5 models)
    - Adaptive model weighting
    - Bootstrap confidence intervals
    - Risk scoring and recommendations
    """
    try:
        from src.lib.grouped_eta_predictor import GroupedETAPredictor
        
        # Use database or synthetic data if DB not available
        try:
            multipliers = analyzer.get_multipliers(limit=500)
        except:
            # Fallback to synthetic data for testing
            import numpy as np
            np.random.seed(42)
            multipliers = []
            for i in range(200):
                u = np.random.uniform(0, 1)
                if u < 0.03:
                    mult = 1.0
                elif u < 0.30:
                    mult = np.random.uniform(1.0, 2.0)
                elif u < 0.70:
                    mult = np.random.uniform(2.0, 5.0)
                elif u < 0.90:
                    mult = np.random.uniform(5.0, 10.0)
                else:
                    mult = np.random.uniform(10.0, 50.0)
                multipliers.append(round(mult, 2))
        
        predictor = GroupedETAPredictor()
        predictions = predictor.predict_grouped_eta(
            multipliers=multipliers,
            horizon=horizon,
            n_groups=n_groups
        )
        
        # Convert to JSON-serializable format
        result = []
        for pred in predictions:
            result.append({
                "group_id": pred.group_id,
                "regime": pred.regime.value,
                "predicted_crash_point": float(pred.predicted_crash_point),
                "confidence_interval": [float(pred.confidence_interval[0]), float(pred.confidence_interval[1])],
                "risk_score": float(pred.risk_score),
                "recommended_action": pred.recommended_action,
                "supporting_clusters": pred.supporting_clusters,
                "model_confidence": float(pred.model_confidence),
                "trajectory": [
                    {
                        "time_step": int(p.time_step),
                        "eta_estimate": float(p.eta_estimate),
                        "confidence_lower": float(p.confidence_lower),
                        "confidence_upper": float(p.confidence_upper),
                        "probability_above_2x": float(p.probability_above_2x),
                        "probability_above_5x": float(p.probability_above_5x),
                        "probability_above_10x": float(p.probability_above_10x),
                        "regime": p.regime.value
                    }
                    for p in pred.trajectory[:20]  # First 20 steps
                ]
            })
        
        return {
            "success": True,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== UNIFIED FORECAST SUMMARY ====================

@app.get("/forecast/summary")
async def forecast_summary(limit: int = Query(1000, ge=50, le=10000)):
    """
    Unified forecast summary combining all backend prediction intelligence.
    
    Produces a commercial-grade, user-friendly forecast with:
    - Next round target multiplier (ensemble of all models)
    - Confidence level and range (low-high)
    - Market regime classification
    - Moonshot / Mega ETA countdown
    - Risk score and recommended action
    - Per-signal contribution breakdown
    """
    try:
        multipliers = analyzer.get_multipliers(limit=limit)
        if len(multipliers) < 10:
            raise ValueError("Need at least 10 rounds for forecasting")
        
        # --- Run all analysis components ---
        full_result = analyzer.analyze(multipliers=multipliers, force_refresh=True)
        
        # --- Grouped ETA predictor (regime + ensemble) ---
        grouped_predictor = GroupedETAPredictor()
        grouped_predictions = grouped_predictor.predict_grouped_eta(
            multipliers=list(multipliers),
            horizon=50,
            n_groups=3
        )
        overall_group = grouped_predictions[0] if grouped_predictions else None
        
        # --- Regime detection ---
        regime_detector = RegimeDetector()
        current_regime = regime_detector.detect_regime(list(multipliers))
        
        # --- Extract component signals ---
        basic = full_result.basic_statistics
        pareto = full_result.pareto_parameters
        curve = full_result.curve_shape
        streak = full_result.streak_analysis
        dry_zone = full_result.dry_zone_prediction
        moonshot = full_result.moonshot_forecast
        
        # --- Build ensemble target multiplier ---
        # Weight each model's prediction by its confidence
        signals = []
        
        # 1. Pareto expected value
        pareto_mean = pareto.get('mean_theoretical')
        if pareto_mean and not math.isinf(pareto_mean):
            pareto_conf = 1.0 - min(pareto.get('ks_statistic', 0.5), 1.0)
            signals.append({
                'model': 'Pareto Distribution',
                'estimate': float(pareto_mean),
                'weight': 0.20 * pareto_conf,
                'confidence': float(pareto_conf),
                'detail': f"alpha={pareto.get('alpha', 0):.3f}"
            })
        
        # 2. Historical mean (with regime adjustment)
        hist_mean = float(basic['mean'])
        hist_conf = min(1.0, len(multipliers) / 500)
        signals.append({
            'model': 'Historical Mean',
            'estimate': hist_mean,
            'weight': 0.15 * hist_conf,
            'confidence': float(hist_conf),
            'detail': f"n={len(multipliers)}"
        })
        
        # 3. Grouped ETA ensemble prediction
        if overall_group:
            grouped_conf = float(overall_group.model_confidence)
            signals.append({
                'model': 'Ensemble ETA',
                'estimate': float(overall_group.predicted_crash_point),
                'weight': 0.25 * grouped_conf,
                'confidence': grouped_conf,
                'detail': f"{current_regime.value}"
            })
        
        # 4. Moonshot forecast expected value
        moonshot_ev = float(moonshot.get('expected_value', hist_mean))
        moonshot_conf = float(moonshot.get('probability_moonshot', 0))
        signals.append({
            'model': 'Moonshot Forecast',
            'estimate': moonshot_ev,
            'weight': 0.15 * max(moonshot_conf, 0.1),
            'confidence': moonshot_conf,
            'detail': f"prob={moonshot_conf:.1%}"
        })
        
        # 5. Markov chain streak continuation
        streak_prob = float(streak.get('probability_continuation', 0.5))
        streak_type = streak.get('streak_type', 'win')
        if streak_type == 'win':
            streak_estimate = hist_mean * (0.8 + 0.4 * streak_prob)
        else:
            streak_estimate = hist_mean * (0.6 + 0.4 * (1 - streak_prob))
        signals.append({
            'model': 'Markov Streak',
            'estimate': float(streak_estimate),
            'weight': 0.15 * max(streak_prob, 0.3),
            'confidence': float(max(streak_prob, 0.3)),
            'detail': f"{streak.get('current_streak', 0)} {streak_type}s"
        })
        
        # 6. Dry zone adjustment
        dry_prob = float(dry_zone.get('probability_low_zone', 0.3))
        dry_severity = float(dry_zone.get('severity_score', 0.3))
        dry_adjustment = 1.0 - (dry_prob * dry_severity * 0.3)
        signals.append({
            'model': 'Dry Zone Adjust',
            'estimate': hist_mean * dry_adjustment,
            'weight': 0.10 * (1 - dry_prob),
            'confidence': float(1 - dry_prob),
            'detail': f"prob={dry_prob:.1%}"
        })
        
        # --- Compute weighted ensemble target ---
        total_weight = sum(s['weight'] for s in signals)
        if total_weight > 0:
            target_multiplier = sum(s['estimate'] * s['weight'] for s in signals) / total_weight
        else:
            target_multiplier = hist_mean
        
        # --- Confidence interval ---
        estimates = [s['estimate'] for s in signals]
        if len(estimates) >= 2:
            ci_low = float(min(estimates))
            ci_high = float(max(estimates))
            # Tighten with standard deviation
            std_est = float(np.std(estimates))
            ci_low = max(1.0, target_multiplier - 1.96 * std_est)
            ci_high = target_multiplier + 1.96 * std_est
        else:
            ci_low = max(1.0, target_multiplier * 0.5)
            ci_high = target_multiplier * 1.5
        
        # --- Overall confidence ---
        overall_confidence = sum(s['confidence'] * s['weight'] for s in signals) / max(total_weight, 0.01)
        overall_confidence = min(0.99, max(0.1, overall_confidence))
        
        # --- Moonshot & Mega ETA ---
        moonshot_eta = moonshot.get('time_to_next')
        moonshot_prob = float(moonshot.get('probability_moonshot', 0))
        
        # Mega = 10x+ events
        mega_threshold = 10.0
        mega_events = multipliers[multipliers >= mega_threshold]
        if len(mega_events) > 0 and len(multipliers) > 0:
            mega_freq = len(mega_events) / len(multipliers)
            mega_eta = int(1 / mega_freq) if mega_freq > 0 else None
            mega_prob = min(0.95, mega_freq * (1 + min(0.5, len(multipliers) / 2000)))
        else:
            mega_eta = None
            mega_prob = 0.0
        
        # --- Risk score ---
        if overall_group:
            risk_score = float(overall_group.risk_score)
            recommended_action = overall_group.recommended_action
        else:
            cv = float(basic.get('coefficient_of_variation', 0.5))
            risk_score = min(1.0, cv / 2)
            if risk_score > 0.7:
                recommended_action = "HIGH_RISK: Conservative strategy recommended"
            elif risk_score > 0.5:
                recommended_action = "MODERATE_RISK: Standard risk management"
            else:
                recommended_action = "FAVORABLE: Normal strategy applies"
        
        # --- Confidence label ---
        if overall_confidence >= 0.75:
            confidence_label = "high"
        elif overall_confidence >= 0.5:
            confidence_label = "medium"
        else:
            confidence_label = "low"
        
        # --- Build signal breakdown ---
        signal_breakdown = []
        for s in signals:
            signal_breakdown.append({
                'model': s['model'],
                'estimate': round(s['estimate'], 2),
                'confidence': round(s['confidence'], 3),
                'weight': round(s['weight'] / max(total_weight, 0.01), 3),
                'detail': s['detail']
            })
        
        return {
            'success': True,
            'timestamp': time.time(),
            'rounds_analyzed': len(multipliers),
            'forecast': {
                'target_multiplier': round(float(target_multiplier), 2),
                'confidence': round(float(overall_confidence), 3),
                'confidence_label': confidence_label,
                'range_low': round(float(ci_low), 2),
                'range_high': round(float(ci_high), 2),
                'regime': current_regime.value,
                'risk_score': round(float(risk_score), 3),
                'recommended_action': recommended_action,
                'model_confidence': round(float(overall_group.model_confidence if overall_group else 0.5), 3)
            },
            'moonshot_ETA': {
                'rounds_until_moonshot': moonshot_eta,
                'probability': round(moonshot_prob, 3),
                'expected_value': round(float(moonshot.get('expected_value', 0)), 2),
                'threshold': 5.0
            },
            'mega_ETA': {
                'rounds_until_mega': mega_eta,
                'probability': round(float(mega_prob), 3),
                'threshold': 10.0
            },
            'market_context': {
                'mean_multiplier': round(float(basic['mean']), 2),
                'median_multiplier': round(float(basic['median']), 2),
                'std_dev': round(float(basic['std']), 2),
                'min': round(float(basic['min']), 2),
                'max': round(float(basic['max']), 2),
                'current_streak': streak.get('current_streak'),
                'streak_type': streak.get('streak_type'),
                'streak_continuation_prob': round(float(streak.get('probability_continuation', 0)), 3),
                'dry_zone_probability': round(float(dry_zone.get('probability_low_zone', 0)), 3),
                'curve_shape': curve.get('shape_type', 'unknown'),
                'pareto_alpha': round(float(pareto.get('alpha', 0)), 3),
                'pareto_fit': 'good' if pareto.get('is_good_fit') else 'poor'
            },
            'signal_breakdown': signal_breakdown,
            'grouped_predictions': [
                {
                    'group_id': p.group_id,
                    'regime': p.regime.value,
                    'predicted_crash_point': round(float(p.predicted_crash_point), 2),
                    'confidence_interval': [round(float(p.confidence_interval[0]), 2), round(float(p.confidence_interval[1]), 2)],
                    'risk_score': round(float(p.risk_score), 3),
                    'recommended_action': p.recommended_action,
                    'model_confidence': round(float(p.model_confidence), 3)
                }
                for p in grouped_predictions
            ]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== UTILITY ENDPOINTS ====================

@app.get("/report")
async def generate_report(limit: int = Query(1000, ge=10)):
    """Generate human-readable analysis report"""
    try:
        multipliers = analyzer.get_multipliers(limit=limit)
        report = analyzer.generate_report(multipliers)
        
        return {
            "success": True,
            "report": report
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """Detailed health check"""
    try:
        # Test database connection
        stats = analyzer.db.get_statistics()
        
        # Test analysis pipeline
        multipliers = analyzer.get_multipliers(limit=50)
        if len(multipliers) >= 10:
            _ = analyzer.quick_analysis(multipliers)
        
        return {
            "status": "healthy",
            "database": "connected",
            "total_rounds": stats.get('total_rounds', 0),
            "analysis_pipeline": "operational"
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


if __name__ == "__main__":
    import uvicorn
    # Serve frontend static files from dist
    frontend_dist = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "frontend", "dist")
    if os.path.exists(frontend_dist):
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
    uvicorn.run(app, host="0.0.0.0", port=8000)
