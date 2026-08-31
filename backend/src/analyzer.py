"""
Crash Analyzer - Main analysis engine combining all mathematical models.
Provides unified interface for curve shape analysis, streak detection,
dry zone prediction, moonshot forecasting, and ETA estimation.
"""

import numpy as np
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import time

from src.lib.math_models import (
    ParetoDistribution, ExponentialCrashModel, MarkovChainStreakAnalyzer,
    GaussianMixtureClusterAnalyzer, ETAEstimator, CurveShapeClassifier,
    DryZonePredictor, MoonshotForecaster, analyze_crash_data
)
from src.db.database import DatabaseConnector, Round


@dataclass
class AnalysisResult:
    """Complete analysis result from all components"""
    timestamp: float
    rounds_analyzed: int
    curve_shape: Dict
    streak_analysis: Dict
    dry_zone_prediction: Dict
    moonshot_forecast: Dict
    eta_estimate: Optional[Dict]
    pareto_parameters: Dict
    basic_statistics: Dict


class CrashAnalyzer:
    """
    Main crash analysis engine.
    
    Combines multiple analytical components:
    1. Curve Shape Analyzer - Classifies distribution patterns
    2. Streak Detector - Tracks win/loss sequences with Markov chains
    3. Dry Zone Predictor - Forecasts low multiplier clusters
    4. Moonshot Forecaster - Predicts high multiplier events
    5. ETA Estimator - Real-time crash point estimation
    
    Usage:
        analyzer = CrashAnalyzer()
        result = analyzer.analyze(multipliers)
    """
    
    def __init__(self, db_path: str = "momento.db"):
        self.db = DatabaseConnector(db_path)
        
        # Initialize all analyzers
        self.curve_classifier = CurveShapeClassifier()
        self.streak_analyzer = MarkovChainStreakAnalyzer(threshold=2.0)
        self.dry_predictor = DryZonePredictor(low_threshold=2.0, window_size=50)
        self.moonshot_forecaster = MoonshotForecaster(moonshot_threshold=5.0, lookback_window=200)
        self.eta_estimator = ETAEstimator(prior_alpha=2.0, prior_xm=1.0)
        
        # Cache for recent analysis
        self._last_analysis: Optional[AnalysisResult] = None
        self._cache_timestamp: float = 0
        self._cache_validity_seconds: float = 5.0
    
    def get_multipliers(self, limit: int = 1000) -> np.ndarray:
        """Fetch multipliers from database"""
        return self.db.get_all_multipliers(limit=limit)
    
    def analyze(self, multipliers: Optional[np.ndarray] = None, 
                force_refresh: bool = False) -> AnalysisResult:
        """
        Perform comprehensive analysis on multiplier data.
        
        Args:
            multipliers: Optional numpy array of multipliers. If None, fetches from DB.
            force_refresh: If True, bypasses cache and reanalyzes.
        
        Returns:
            AnalysisResult with all component analyses
        """
        # Check cache validity
        current_time = time.time()
        if (self._last_analysis is not None and 
            not force_refresh and 
            current_time - self._cache_timestamp < self._cache_validity_seconds):
            return self._last_analysis
        
        # Get data if not provided
        if multipliers is None:
            multipliers = self.get_multipliers(limit=1000)
        
        if len(multipliers) < 10:
            raise ValueError("Need at least 10 data points for analysis")
        
        # Run all analyses
        basic_stats = self._compute_basic_statistics(multipliers)
        pareto_params = self._fit_pareto(multipliers)
        curve_shape = self._analyze_curve_shape(multipliers)
        streak_result = self._analyze_streaks(multipliers)
        dry_zone = self._predict_dry_zone(multipliers)
        moonshot = self._forecast_moonshot(multipliers)
        
        # Update ETA estimator with historical data
        self.eta_estimator.update(multipliers)
        
        result = AnalysisResult(
            timestamp=current_time,
            rounds_analyzed=len(multipliers),
            basic_statistics=basic_stats,
            pareto_parameters=pareto_params,
            curve_shape=curve_shape,
            streak_analysis=streak_result,
            dry_zone_prediction=dry_zone,
            moonshot_forecast=moonshot,
            eta_estimate=None  # Set separately during live rounds
        )
        
        # Cache result
        self._last_analysis = result
        self._cache_timestamp = current_time
        
        return result
    
    def analyze_live_round(self, current_multiplier: float) -> Dict:
        """
        Analyze a live round in progress.
        
        Args:
            current_multiplier: Current live multiplier value
        
        Returns:
            Dictionary with ETA estimate and survival probability
        """
        # Get recent historical data
        multipliers = self.get_multipliers(limit=500)
        
        # Update estimator
        self.eta_estimator.update(multipliers)
        
        # Estimate current round
        eta_result = self.eta_estimator.estimate_current_round(current_multiplier)
        
        return {
            'current_multiplier': current_multiplier,
            'estimated_crash_point': eta_result.estimated_crash_point,
            'confidence_interval': [eta_result.confidence_lower, eta_result.confidence_upper],
            'hazard_rate': eta_result.hazard_rate,
            'survival_probability': eta_result.survival_probability,
            'distribution_type': eta_result.distribution_type,
            'timestamp': time.time()
        }
    
    def _compute_basic_statistics(self, multipliers: np.ndarray) -> Dict:
        """Compute basic statistical measures"""
        return {
            'mean': float(np.mean(multipliers)),
            'median': float(np.median(multipliers)),
            'std': float(np.std(multipliers)),
            'min': float(np.min(multipliers)),
            'max': float(np.max(multipliers)),
            'count': len(multipliers),
            'coefficient_of_variation': float(np.std(multipliers) / np.mean(multipliers)) if np.mean(multipliers) > 0 else 0
        }
    
    def _fit_pareto(self, multipliers: np.ndarray) -> Dict:
        """Fit Pareto distribution and return parameters"""
        pareto = ParetoDistribution()
        xm_hat, alpha_hat = pareto.fit_mle(multipliers)
        
        # Goodness of fit test
        ks_stat, p_value = ParetoDistribution.kstest_pareto(multipliers)
        
        return {
            'x_m': float(xm_hat),
            'alpha': float(alpha_hat),
            'mean_theoretical': float(pareto.mean()) if alpha_hat > 1 else None,
            'variance_theoretical': float(pareto.variance()) if alpha_hat > 2 else None,
            'ks_statistic': float(ks_stat),
            'p_value': float(p_value),
            'is_good_fit': p_value > 0.05
        }
    
    def _analyze_curve_shape(self, multipliers: np.ndarray) -> Dict:
        """Classify curve shape using statistical fitting"""
        try:
            result = self.curve_classifier.classify(multipliers)
            return {
                'shape_type': result.shape_type,
                'r_squared': float(result.r_squared),
                'parameters': result.parameters,
                'confidence_interval': [float(result.confidence_interval[0]), 
                                       float(result.confidence_interval[1])],
                'log_likelihood': float(result.log_likelihood) if result.log_likelihood != float('-inf') else None
            }
        except Exception as e:
            return {
                'shape_type': 'unknown',
                'r_squared': 0.0,
                'error': str(e)
            }
    
    def _analyze_streaks(self, multipliers: np.ndarray) -> Dict:
        """Analyze win/loss streaks using Markov chains"""
        result = self.streak_analyzer.analyze_streak(multipliers)
        
        return {
            'current_streak': int(result.current_streak),
            'streak_type': result.streak_type,
            'expected_duration': float(result.expected_duration) if result.expected_duration != float('inf') else None,
            'probability_continuation': float(result.probability_continuation),
            'historical_max_streak': int(result.historical_max_streak),
            'transition_matrix': result.transition_matrix.tolist()
        }
    
    def _predict_dry_zone(self, multipliers: np.ndarray) -> Dict:
        """Predict upcoming dry zones"""
        result = self.dry_predictor.predict(multipliers)
        
        cluster_info = None
        if result.gmm_clusters:
            cluster_info = [
                {
                    'cluster_id': c['cluster_id'],
                    'mean_multiplier': float(c['mean_multiplier']),
                    'probability': float(c['probability_mass'])
                }
                for c in result.gmm_clusters
            ]
        
        return {
            'probability_low_zone': float(result.probability_low_zone),
            'expected_duration': int(result.expected_duration),
            'severity_score': float(result.severity_score),
            'confidence_interval': [float(result.confidence_interval[0]), 
                                   float(result.confidence_interval[1])],
            'clusters': cluster_info
        }
    
    def _forecast_moonshot(self, multipliers: np.ndarray) -> Dict:
        """Forecast next moonshot event"""
        result = self.moonshot_forecaster.forecast(multipliers)
        
        return {
            'probability_moonshot': float(result.probability_moonshot),
            'expected_value': float(result.expected_value),
            'time_to_next': int(result.time_to_next) if result.time_to_next else None,
            'cluster_id': int(result.cluster_id) if result.cluster_id else None,
            'risk_score': float(result.risk_score)
        }
    
    def save_analysis(self, result: AnalysisResult) -> int:
        """Save analysis results to database as forecasts"""
        forecast_ids = []
        
        # Save curve shape forecast
        if 'curve_shape' in result.curve_shape:
            fid = self.db.save_forecast(
                round_id=None,
                component_type='curve_shape',
                prediction=result.curve_shape,
                confidence=result.curve_shape.get('r_squared', 0.5)
            )
            forecast_ids.append(fid)
        
        # Save streak forecast
        fid = self.db.save_forecast(
            round_id=None,
            component_type='streak',
            prediction=result.streak_analysis,
            confidence=result.streak_analysis.get('probability_continuation', 0.5)
        )
        forecast_ids.append(fid)
        
        # Save dry zone forecast
        fid = self.db.save_forecast(
            round_id=None,
            component_type='dry_zone',
            prediction=result.dry_zone_prediction,
            confidence=result.dry_zone_prediction.get('probability_low_zone', 0.5)
        )
        forecast_ids.append(fid)
        
        # Save moonshot forecast
        fid = self.db.save_forecast(
            round_id=None,
            component_type='moonshot',
            prediction=result.moonshot_forecast,
            confidence=result.moonshot_forecast.get('probability_moonshot', 0.5)
        )
        forecast_ids.append(fid)
        
        return forecast_ids
    
    def quick_analysis(self, multipliers: Optional[np.ndarray] = None) -> Dict:
        """
        Quick analysis using convenience function.
        Less detailed but faster.
        """
        if multipliers is None:
            multipliers = self.get_multipliers(limit=500)
        
        return analyze_crash_data(multipliers)
    
    def generate_report(self, multipliers: Optional[np.ndarray] = None) -> str:
        """Generate human-readable analysis report"""
        result = self.analyze(multipliers)
        
        report = f"""
CRASH CURVE ANALYTICS REPORT
============================
Generated: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(result.timestamp))}
Rounds Analyzed: {result.rounds_analyzed}

BASIC STATISTICS
----------------
Mean Multiplier: {result.basic_statistics['mean']:.2f}x
Median: {result.basic_statistics['median']:.2f}x
Std Dev: {result.basic_statistics['std']:.2f}
Range: {result.basic_statistics['min']:.2f}x - {result.basic_statistics['max']:.2f}x

PARETO DISTRIBUTION FIT
-----------------------
Alpha (tail index): {result.pareto_parameters['alpha']:.3f}
X_min: {result.pareto_parameters['x_m']:.3f}
Goodness of Fit: {'✓ Good' if result.pareto_parameters['is_good_fit'] else '✗ Poor'} (p={result.pareto_parameters['p_value']:.3f})

CURVE SHAPE CLASSIFICATION
--------------------------
Shape Type: {result.curve_shape['shape_type']}
R² Score: {result.curve_shape['r_squared']:.3f}

STREAK ANALYSIS
---------------
Current Streak: {result.streak_analysis['current_streak']} {result.streak_analysis['streak_type']}s
Expected Duration: {result.streak_analysis['expected_duration']:.1f} rounds
Continuation Probability: {result.streak_analysis['probability_continuation']:.1%}
Historical Max: {result.streak_analysis['historical_max_streak']}

DRY ZONE PREDICTION
-------------------
Probability: {result.dry_zone_prediction['probability_low_zone']:.1%}
Expected Duration: {result.dry_zone_prediction['expected_duration']} rounds
Severity: {result.dry_zone_prediction['severity_score']:.2f}/1.00

MOONSHOT FORECAST
-----------------
Probability: {result.moonshot_forecast['probability_moonshot']:.1%}
Expected Value: {result.moonshot_forecast['expected_value']:.2f}x
Time to Next: {result.moonshot_forecast['time_to_next']} rounds
Risk Score: {result.moonshot_forecast['risk_score']:.2f}/1.00

============================
"""
        return report
