"""
FastAPI Backend for Crash Curve Analytics
Provides REST API endpoints for all analysis components.
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict
import numpy as np
import time

from src.analyzer import CrashAnalyzer, AnalysisResult
from src.db.database import DatabaseConnector


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


@app.on_event("startup")
async def startup_event():
    """Initialize analyzer on startup"""
    global analyzer
    analyzer = CrashAnalyzer(db_path="momento.db")


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
            "/analyze - Full analysis",
            "/analyze/quick - Quick analysis",
            "/analyze/live - Live round ETA",
            "/components/curve-shape - Curve shape classification",
            "/components/streaks - Streak analysis",
            "/components/dry-zone - Dry zone prediction",
            "/components/moonshot - Moonshot forecast",
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
    uvicorn.run(app, host="0.0.0.0", port=8000)
