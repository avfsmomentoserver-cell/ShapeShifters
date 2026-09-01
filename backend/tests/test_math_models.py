"""
Comprehensive test suite for Crash Curve Analytics.
Validates mathematical models, database operations, and API endpoints.
Uses pytest with synthetic data generation for reproducible testing.
"""

import pytest
import numpy as np
from scipy import stats
import sys
import os

# Add src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend', 'src'))

from lib.math_models import (
    ParetoDistribution, ExponentialCrashModel, MarkovChainStreakAnalyzer,
    GaussianMixtureClusterAnalyzer, ETAEstimator, CurveShapeClassifier,
    DryZonePredictor, MoonshotForecaster, analyze_crash_data,
    CurveFitResult, StreakAnalysis, DryZonePrediction, MoonshotForecast, ETAEstimate
)


# ==================== FIXTURES ====================

@pytest.fixture
def pareto_sample():
    """Generate sample from Pareto distribution"""
    np.random.seed(42)
    alpha = 2.5
    x_m = 1.0
    samples = x_m / (np.random.pareto(alpha, 1000) + 1) ** (1/alpha)
    return samples[samples >= x_m]  # Filter valid samples


@pytest.fixture
def exponential_sample():
    """Generate sample from exponential crash model"""
    np.random.seed(42)
    model = ExponentialCrashModel(lambda_param=1.0, house_edge=0.04)
    return model.simulate(1000)


@pytest.fixture
def mixed_sample():
    """Generate mixed distribution sample"""
    np.random.seed(42)
    # Mix of low and high multipliers
    low = np.random.exponential(1.3, 800) + 1
    high = np.random.pareto(2, 200) + 1
    return np.concatenate([low, high])


@pytest.fixture
def streak_data():
    """Generate data with streak patterns"""
    np.random.seed(42)
    data = []
    # Create streaks
    for _ in range(10):
        streak_length = np.random.randint(3, 8)
        value = np.random.choice([1.2, 3.5])  # Low or high
        data.extend([value] * streak_length)
    return np.array(data)


# ==================== PARETO DISTRIBUTION TESTS ====================

class TestParetoDistribution:
    """Test Pareto distribution implementation"""
    
    def test_initialization(self):
        """Test default and custom initialization"""
        p1 = ParetoDistribution()
        assert p1.x_m == 1.0
        assert p1.alpha == 2.0
        
        p2 = ParetoDistribution(x_m=1.5, alpha=3.0)
        assert p2.x_m == 1.5
        assert p2.alpha == 3.0
    
    def test_pdf_properties(self, pareto_sample):
        """Test PDF properties"""
        p = ParetoDistribution(x_m=1.0, alpha=2.5)
        
        # PDF should be zero below x_m
        assert p.pdf(np.array([0.5]))[0] == 0
        
        # PDF should be positive above x_m
        assert p.pdf(np.array([2.0]))[0] > 0
        
        # PDF should decrease with x (monotonically decreasing)
        x = np.linspace(1, 10, 100)
        pdf_vals = p.pdf(x)
        assert np.all(np.diff(pdf_vals) <= 0)
    
    def test_cdf_properties(self, pareto_sample):
        """Test CDF properties"""
        p = ParetoDistribution(x_m=1.0, alpha=2.5)
        
        # CDF at x_m should be 0
        assert abs(p.cdf(np.array([1.0]))[0]) < 1e-10
        
        # CDF should approach 1 as x increases
        assert p.cdf(np.array([1000]))[0] > 0.99
        
        # CDF should be monotonically increasing
        x = np.linspace(1, 10, 100)
        cdf_vals = p.cdf(x)
        assert np.all(np.diff(cdf_vals) >= 0)
    
    def test_survival_function(self, pareto_sample):
        """Test survival function S(x) = P(X > x)"""
        p = ParetoDistribution(x_m=1.0, alpha=2.5)
        
        x = np.array([2.0])
        sf = p.survival_function(x)[0]
        expected = (1.0 / 2.0) ** 2.5
        
        assert abs(sf - expected) < 1e-10
    
    def test_mean_variance(self):
        """Test theoretical mean and variance"""
        # Alpha > 2 for finite variance
        p = ParetoDistribution(x_m=1.0, alpha=3.0)
        
        expected_mean = 3.0 * 1.0 / (3.0 - 1)  # α*xm/(α-1)
        expected_var = (3.0 * 1.0**2) / ((3.0-1)**2 * (3.0-2))
        
        assert abs(p.mean() - expected_mean) < 1e-10
        assert abs(p.variance() - expected_var) < 1e-10
        
        # Alpha <= 1 should give infinite mean
        p_inf = ParetoDistribution(x_m=1.0, alpha=0.5)
        assert p_inf.mean() == float('inf')
    
    def test_mle_fitting(self, pareto_sample):
        """Test maximum likelihood estimation"""
        p = ParetoDistribution()
        xm_hat, alpha_hat = p.fit_mle(pareto_sample)
        
        # x_m estimate should be close to minimum
        assert abs(xm_hat - np.min(pareto_sample)) < 1e-10
        
        # Alpha estimate should be reasonable (within 20% for n=1000)
        true_alpha = 2.5
        assert abs(alpha_hat - true_alpha) / true_alpha < 0.2
    
    def test_ks_test(self, pareto_sample):
        """Test Kolmogorov-Smirnov goodness of fit"""
        ks_stat, p_value = ParetoDistribution.kstest_pareto(pareto_sample)
        
        # KS statistic should be between 0 and 1
        assert 0 <= ks_stat <= 1
        
        # For good fit, p-value should be > 0.05
        assert p_value > 0.05


# ==================== EXPONENTIAL CRASH MODEL TESTS ====================

class TestExponentialCrashModel:
    """Test exponential crash model"""
    
    def test_initialization(self):
        """Test model initialization"""
        model = ExponentialCrashModel(lambda_param=1.0, house_edge=0.04)
        assert model.lambda_param == 1.0
        assert model.house_edge == 0.04
    
    def test_expected_value(self):
        """Test expected value calculation"""
        model = ExponentialCrashModel(lambda_param=1.0, house_edge=0.04)
        expected = 1 + (1 - 0.04) / 1.0
        
        assert abs(model.expected_value() - expected) < 1e-10
    
    def test_simulation(self):
        """Test random sample generation"""
        model = ExponentialCrashModel(lambda_param=1.0, house_edge=0.04)
        samples = model.simulate(1000)
        
        # All samples should be >= 1
        assert np.all(samples >= 1)
        
        # Mean should be close to theoretical
        sample_mean = np.mean(samples)
        theoretical_mean = model.expected_value()
        assert abs(sample_mean - theoretical_mean) / theoretical_mean < 0.1


# ==================== MARKOV CHAIN STREAK ANALYZER TESTS ====================

class TestMarkovChainStreakAnalyzer:
    """Test Markov chain streak analysis"""
    
    def test_transition_matrix(self, streak_data):
        """Test transition matrix construction"""
        analyzer = MarkovChainStreakAnalyzer(threshold=2.0)
        P = analyzer.build_transition_matrix(streak_data)
        
        # Should be 2x2 matrix
        assert P.shape == (2, 2)
        
        # Rows should sum to 1
        assert abs(P[0].sum() - 1.0) < 1e-10
        assert abs(P[1].sum() - 1.0) < 1e-10
        
        # All elements should be between 0 and 1
        assert np.all(P >= 0) and np.all(P <= 1)
    
    def test_streak_analysis(self, streak_data):
        """Test comprehensive streak analysis"""
        analyzer = MarkovChainStreakAnalyzer(threshold=2.0)
        result = analyzer.analyze_streak(streak_data)
        
        assert isinstance(result, StreakAnalysis)
        assert result.current_streak >= 1
        assert result.streak_type in ['win', 'loss']
        assert 0 <= result.probability_continuation <= 1
        assert result.historical_max_streak >= result.current_streak


# ==================== GAUSSIAN MIXTURE CLUSTER ANALYZER TESTS ====================

class TestGaussianMixtureClusterAnalyzer:
    """Test GMM clustering"""
    
    def test_fit_and_predict(self, mixed_sample):
        """Test GMM fitting and prediction"""
        gmm = GaussianMixtureClusterAnalyzer(n_components=3)
        gmm.fit(mixed_sample)
        
        # Should be able to predict clusters
        clusters = gmm.predict_clusters(mixed_sample)
        assert len(clusters) == len(mixed_sample)
        assert all(c in [0, 1, 2] for c in clusters)
    
    def test_cluster_stats(self, mixed_sample):
        """Test cluster statistics extraction"""
        gmm = GaussianMixtureClusterAnalyzer(n_components=3)
        gmm.fit(mixed_sample)
        
        stats = gmm.get_cluster_stats()
        assert len(stats) == 3
        
        for cluster in stats:
            assert 'cluster_id' in cluster
            assert 'mean_multiplier' in cluster
            assert 'probability_mass' in cluster
            assert cluster['mean_multiplier'] > 0
            assert 0 <= cluster['probability_mass'] <= 1
    
    def test_dry_zone_identification(self, mixed_sample):
        """Test dry zone cluster identification"""
        gmm = GaussianMixtureClusterAnalyzer(n_components=3)
        gmm.fit(mixed_sample)
        
        dry_zone = gmm.identify_dry_zone()
        
        if dry_zone:
            assert 'cluster_id' in dry_zone
            assert 'mean_multiplier' in dry_zone
            assert dry_zone['mean_multiplier'] < 3.0  # Should be low


# ==================== ETA ESTIMATOR TESTS ====================

class TestETAEstimator:
    """Test ETA estimation"""
    
    def test_bayesian_update(self, pareto_sample):
        """Test Bayesian parameter updating"""
        estimator = ETAEstimator(prior_alpha=2.0, prior_xm=1.0)
        
        initial_alpha = estimator.posterior_alpha
        estimator.update(pareto_sample)
        
        # Posterior alpha should increase with data
        assert estimator.posterior_alpha > initial_alpha
    
    def test_live_estimation(self, pareto_sample):
        """Test live round estimation"""
        estimator = ETAEstimator(prior_alpha=2.5, prior_xm=1.0)
        estimator.update(pareto_sample)
        
        result = estimator.estimate_current_round(current_multiplier=2.0)
        
        assert isinstance(result, ETAEstimate)
        assert result.estimated_crash_point > 2.0  # Should be above current
        assert result.confidence_lower >= 2.0
        assert result.confidence_upper > result.confidence_lower
        assert 0 <= result.survival_probability <= 1
        assert result.hazard_rate > 0


# ==================== CURVE SHAPE CLASSIFIER TESTS ====================

class TestCurveShapeClassifier:
    """Test curve shape classification"""
    
    def test_classification(self, mixed_sample):
        """Test shape classification"""
        classifier = CurveShapeClassifier()
        result = classifier.classify(mixed_sample)
        
        assert isinstance(result, CurveFitResult)
        assert result.shape_type in ['exponential', 'power_law', 'bimodal', 'uniform', 'clustered']
        assert 0 <= result.r_squared <= 1
    
    def test_small_sample_error(self):
        """Test error handling for small samples"""
        classifier = CurveShapeClassifier()
        small_sample = np.array([1.1, 1.5, 2.0])
        
        with pytest.raises(ValueError):
            classifier.classify(small_sample)


# ==================== DRY ZONE PREDICTOR TESTS ====================

class TestDryZonePredictor:
    """Test dry zone prediction"""
    
    def test_prediction(self, mixed_sample):
        """Test dry zone prediction"""
        predictor = DryZonePredictor(low_threshold=2.0, window_size=50)
        result = predictor.predict(mixed_sample)
        
        assert isinstance(result, DryZonePrediction)
        assert 0 <= result.probability_low_zone <= 1
        assert result.expected_duration > 0
        assert 0 <= result.severity_score <= 1


# ==================== MOONSHOT FORECASTER TESTS ====================

class TestMoonshotForecaster:
    """Test moonshot forecasting"""
    
    def test_forecast(self, mixed_sample):
        """Test moonshot forecast"""
        forecaster = MoonshotForecaster(moonshot_threshold=5.0, lookback_window=200)
        result = forecaster.forecast(mixed_sample)
        
        assert isinstance(result, MoonshotForecast)
        assert 0 <= result.probability_moonshot <= 1
        assert result.expected_value > 0
        assert 0 <= result.risk_score <= 1


# ==================== COMPREHENSIVE ANALYSIS TEST ====================

class TestComprehensiveAnalysis:
    """Test complete analysis pipeline"""
    
    def test_analyze_crash_data(self, mixed_sample):
        """Test comprehensive analysis function"""
        results = analyze_crash_data(mixed_sample)
        
        # Check all expected keys
        expected_keys = [
            'basic_stats', 'pareto_fit', 'pareto_goodness_of_fit',
            'curve_shape', 'streak_analysis', 'dry_zone', 'moonshot_forecast'
        ]
        
        for key in expected_keys:
            assert key in results
        
        # Validate basic stats
        assert results['basic_stats']['count'] == len(mixed_sample)
        assert results['basic_stats']['mean'] > 0
        
        # Validate Pareto fit
        assert results['pareto_fit']['alpha'] > 0
        assert results['pareto_fit']['x_m'] > 0
        
        # Validate curve shape
        assert results['curve_shape']['shape_type'] in [
            'exponential', 'power_law', 'bimodal', 'uniform', 'clustered'
        ]
        
        # Validate streak analysis
        assert results['streak_analysis']['current_streak'] >= 1
        
        # Validate dry zone
        assert 0 <= results['dry_zone']['probability_low_zone'] <= 1
        
        # Validate moonshot
        assert 0 <= results['moonshot_forecast']['probability_moonshot'] <= 1


# ==================== MATHEMATICAL CORRECTNESS TESTS ====================

class TestMathematicalCorrectness:
    """Test mathematical correctness of implementations"""
    
    def test_pareto_tail_behavior(self):
        """Test that Pareto exhibits heavy tail behavior"""
        p = ParetoDistribution(x_m=1.0, alpha=2.0)
        
        # Ratio P(X > 10x) / P(X > x) should equal 10^(-alpha)
        x = 2.0
        ratio_theoretical = 10 ** (-2.0)
        ratio_empirical = p.survival_function(np.array([10*x]))[0] / p.survival_function(np.array([x]))[0]
        
        assert abs(ratio_empirical - ratio_theoretical) < 1e-10
    
    def test_exponential_memoryless_property(self):
        """Test memoryless property of exponential distribution"""
        model = ExponentialCrashModel(lambda_param=1.0, house_edge=0.0)
        
        # P(X > s+t | X > s) = P(X > t)
        s, t = 2.0, 3.0
        
        sf_s = model.survival_function(np.array([s]))[0]
        sf_s_t = model.survival_function(np.array([s+t]))[0]
        sf_t = model.survival_function(np.array([t]))[0]
        
        conditional_prob = sf_s_t / sf_s
        
        assert abs(conditional_prob - sf_t) / sf_t < 0.01  # Within 1%
    
    def test_markov_stationary_distribution(self, streak_data):
        """Test stationary distribution of Markov chain"""
        analyzer = MarkovChainStreakAnalyzer(threshold=2.0)
        P = analyzer.build_transition_matrix(streak_data)
        
        # Find stationary distribution π where πP = π
        eigenvalues, eigenvectors = np.linalg.eig(P.T)
        
        # Find eigenvector with eigenvalue 1
        idx = np.argmin(np.abs(eigenvalues - 1))
        pi = eigenvectors[:, idx].real
        pi = pi / pi.sum()  # Normalize
        
        # Verify πP = π
        pi_P = pi @ P
        
        assert np.allclose(pi, pi_P, atol=1e-10)


# ==================== RUN ALL TESTS ====================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
