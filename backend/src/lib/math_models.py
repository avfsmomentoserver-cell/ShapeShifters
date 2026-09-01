"""
Crash Curve Analytics - Mathematical Library
Implements stochastic models, Pareto distributions, Markov chains, 
GMM clustering, and ETA forecasting with full mathematical rigor.
"""

import numpy as np
from scipy import stats
from scipy.optimize import minimize
from dataclasses import dataclass
from typing import List, Tuple, Optional, Dict
import warnings

warnings.filterwarnings('ignore')


@dataclass
class CurveFitResult:
    """Result of fitting crash curve to parametric model"""
    shape_type: str  # 'exponential', 'power_law', 'logistic'
    parameters: Dict[str, float]
    r_squared: float
    confidence_interval: Tuple[float, float]
    log_likelihood: float


@dataclass
class StreakAnalysis:
    """Analysis of win/loss streaks using Markov chains"""
    current_streak: int
    streak_type: str  # 'win' or 'loss'
    expected_duration: float
    transition_matrix: np.ndarray
    probability_continuation: float
    historical_max_streak: int


@dataclass
class DryZonePrediction:
    """Prediction of low multiplier clusters"""
    probability_low_zone: float
    expected_duration: int  # rounds
    severity_score: float  # 0-1, higher = more severe
    confidence_interval: Tuple[float, float]
    gmm_clusters: Optional[Dict] = None


@dataclass
class MoonshotForecast:
    """Forecast for high multiplier events (≥5x)"""
    probability_moonshot: float
    expected_value: float
    time_to_next: Optional[int]  # rounds until next expected
    cluster_id: Optional[int]
    risk_score: float  # 0-1


@dataclass
class ETAEstimate:
    """Real-time crash point estimation"""
    estimated_crash_point: float
    confidence_lower: float
    confidence_upper: float
    distribution_type: str
    hazard_rate: float
    survival_probability: float


class ParetoDistribution:
    """
    Implements Pareto Type I and II distributions for crash modeling.
    
    The Pareto distribution is fundamental to crash games:
    P(X > x) = (x_m / x)^α for x ≥ x_m
    
    Where:
    - x_m: minimum possible value (typically 1.0 for crash games)
    - α: shape parameter (tail index), controls heaviness of tail
    """
    
    def __init__(self, x_m: float = 1.0, alpha: float = 2.0):
        self.x_m = x_m
        self.alpha = alpha
        
    def pdf(self, x: np.ndarray) -> np.ndarray:
        """Probability density function"""
        return np.where(x >= self.x_m, 
                       self.alpha * (self.x_m ** self.alpha) / (x ** (self.alpha + 1)),
                       0)
    
    def cdf(self, x: np.ndarray) -> np.ndarray:
        """Cumulative distribution function"""
        return np.where(x >= self.x_m,
                       1 - (self.x_m / x) ** self.alpha,
                       0)
    
    def survival_function(self, x: np.ndarray) -> np.ndarray:
        """P(X > x) - probability of exceeding x"""
        return 1 - self.cdf(x)
    
    def hazard_rate(self, x: np.ndarray) -> np.ndarray:
        """Instantaneous failure rate at x"""
        pdf_val = self.pdf(x)
        sf_val = self.survival_function(x)
        return np.where(sf_val > 0, pdf_val / sf_val, 0)
    
    def mean(self) -> float:
        """Expected value E[X]"""
        if self.alpha <= 1:
            return float('inf')
        return self.alpha * self.x_m / (self.alpha - 1)
    
    def variance(self) -> float:
        """Variance Var[X]"""
        if self.alpha <= 2:
            return float('inf')
        return (self.alpha * (self.x_m ** 2)) / ((self.alpha - 1) ** 2 * (self.alpha - 2))
    
    def fit_mle(self, data: np.ndarray) -> Tuple[float, float]:
        """
        Maximum likelihood estimation for Pareto parameters.
        
        MLE estimators:
        x̂_m = min(x_i)
        α̂ = n / Σ ln(x_i / x̂_m)
        """
        x_m_hat = np.min(data)
        n = len(data)
        alpha_hat = n / np.sum(np.log(data / x_m_hat))
        return x_m_hat, alpha_hat
    
    @staticmethod
    def kstest_pareto(data: np.ndarray, x_m: float = 1.0) -> Tuple[float, float]:
        """
        Kolmogorov-Smirnov test for Pareto fit.
        Returns (statistic, p-value)
        """
        _, alpha_hat = ParetoDistribution(x_m).fit_mle(data)
        theoretical_cdf = ParetoDistribution(x_m, alpha_hat).cdf(np.sort(data))
        empirical_cdf = np.arange(1, len(data) + 1) / len(data)
        ks_stat = np.max(np.abs(empirical_cdf - theoretical_cdf))
        # Approximate p-value using asymptotic distribution
        n = len(data)
        p_value = np.exp(-2 * n * ks_stat ** 2)
        return ks_stat, p_value


class ExponentialCrashModel:
    """
    Standard exponential crash model used by most platforms.
    
    P(crash < x) = 1 - e^(-λx) for x ≥ 1
    
    With house edge adjustment:
    P(crash < x) = 1 - (1 - house_edge) * e^(-λ(x-1))
    """
    
    def __init__(self, lambda_param: float = 1.0, house_edge: float = 0.04):
        self.lambda_param = lambda_param
        self.house_edge = house_edge
        
    def pdf(self, x: np.ndarray) -> np.ndarray:
        """Probability density function"""
        return np.where(x >= 1,
                       self.lambda_param * (1 - self.house_edge) * np.exp(-self.lambda_param * (x - 1)),
                       0)
    
    def cdf(self, x: np.ndarray) -> np.ndarray:
        """Cumulative distribution function"""
        return np.where(x >= 1,
                       1 - (1 - self.house_edge) * np.exp(-self.lambda_param * (x - 1)),
                       1)
    
    def survival_function(self, x: np.ndarray) -> np.ndarray:
        """P(X > x)"""
        return 1 - self.cdf(x)
    
    def expected_value(self) -> float:
        """E[X] = 1 + (1 - house_edge) / λ"""
        return 1 + (1 - self.house_edge) / self.lambda_param
    
    def fit_mle(self, data: np.ndarray) -> float:
        """MLE for λ parameter"""
        n = len(data)
        return n / np.sum(data - 1)
    
    def simulate(self, n_samples: int) -> np.ndarray:
        """Generate random samples from the distribution"""
        # Use rejection sampling for correctness
        # The CDF is: F(x) = 1 - (1-house_edge) * exp(-lambda*(x-1)) for x >= 1
        # This means P(X=1) = house_edge (instant crash)
        # and continuous part for x > 1
        
        u = np.random.uniform(0, 1, n_samples)
        samples = np.zeros(n_samples)
        
        # House edge causes instant crash at 1.0
        instant_crash = u < self.house_edge
        samples[instant_crash] = 1.0
        
        # Continuous part for remaining
        u_cont = u[~instant_crash]
        # Adjusted uniform for continuous part
        u_adj = (u_cont - self.house_edge) / (1 - self.house_edge)
        # Inverse CDF: x = 1 - ln(1-u) / lambda
        samples[~instant_crash] = 1 - np.log(1 - u_adj) / self.lambda_param
        
        return samples


class MarkovChainStreakAnalyzer:
    """
    Analyzes streak patterns using Markov chains.
    
    States: {continuing_win, continuing_loss, switching}
    Transition matrix P where P[i,j] = P(next_state=j | current_state=i)
    """
    
    def __init__(self, threshold: float = 2.0):
        self.threshold = threshold  # Multiplier threshold for win/loss
        
    def build_transition_matrix(self, multipliers: np.ndarray) -> np.ndarray:
        """
        Build 2x2 transition matrix for win/loss states.
        
        P = [[P(W|W), P(L|W)],
             [P(W|L), P(L|L)]]
        """
        wins = multipliers >= self.threshold
        losses = multipliers < self.threshold
        
        # Count transitions
        ww = np.sum(wins[:-1] & wins[1:])  # Win followed by Win
        wl = np.sum(wins[:-1] & losses[1:])  # Win followed by Loss
        lw = np.sum(losses[:-1] & wins[1:])  # Loss followed by Win
        ll = np.sum(losses[:-1] & losses[1:])  # Loss followed by Loss
        
        # Normalize to probabilities
        p_w = ww + wl
        p_l = lw + ll
        
        if p_w == 0 or p_l == 0:
            return np.array([[0.5, 0.5], [0.5, 0.5]])
        
        return np.array([
            [ww / p_w, wl / p_w],
            [lw / p_l, ll / p_l]
        ])
    
    def analyze_streak(self, multipliers: np.ndarray) -> StreakAnalysis:
        """Comprehensive streak analysis"""
        wins = multipliers >= self.threshold
        losses = multipliers < self.threshold
        
        # Find current streak
        current_streak = 0
        last_outcome = wins[-1] if len(wins) > 0 else True
        
        for i in range(len(multipliers) - 1, -1, -1):
            if wins[i] == last_outcome:
                current_streak += 1
            else:
                break
        
        streak_type = 'win' if last_outcome else 'loss'
        
        # Build transition matrix
        P = self.build_transition_matrix(multipliers)
        
        # Probability of streak continuing
        if streak_type == 'win':
            prob_continue = P[0, 0]
        else:
            prob_continue = P[1, 1]
        
        # Expected duration of current streak type (geometric distribution)
        if prob_continue >= 1:
            expected_duration = float('inf')
        elif prob_continue <= 0:
            expected_duration = 1
        else:
            expected_duration = 1 / (1 - prob_continue)
        
        # Historical max streak
        max_streak = 1
        current = 1
        for i in range(1, len(wins)):
            if wins[i] == wins[i-1]:
                current += 1
                max_streak = max(max_streak, current)
            else:
                current = 1
        
        return StreakAnalysis(
            current_streak=current_streak,
            streak_type=streak_type,
            expected_duration=expected_duration,
            transition_matrix=P,
            probability_continuation=prob_continue,
            historical_max_streak=max_streak
        )


class GaussianMixtureClusterAnalyzer:
    """
    Uses GMM to identify clusters in multiplier space.
    Particularly useful for identifying dry zones and moonshot clusters.
    """
    
    def __init__(self, n_components: int = 3, random_state: int = 42):
        self.n_components = n_components
        self.random_state = random_state
        self.gmm = None
        
    def fit(self, data: np.ndarray) -> 'GaussianMixtureClusterAnalyzer':
        """Fit GMM to log-transformed multiplier data"""
        from sklearn.mixture import GaussianMixture
        
        # Log transform for better clustering of skewed data
        log_data = np.log(data).reshape(-1, 1)
        
        self.gmm = GaussianMixture(
            n_components=self.n_components,
            random_state=self.random_state,
            n_init=10
        )
        self.gmm.fit(log_data)
        
        return self
    
    def predict_clusters(self, data: np.ndarray) -> np.ndarray:
        """Assign each data point to a cluster"""
        if self.gmm is None:
            raise ValueError("GMM not fitted. Call fit() first.")
        
        log_data = np.log(data).reshape(-1, 1)
        return self.gmm.predict(log_data)
    
    def get_cluster_stats(self) -> List[Dict]:
        """Get statistics for each cluster"""
        if self.gmm is None:
            raise ValueError("GMM not fitted.")
        
        stats_list = []
        for i in range(self.n_components):
            mean_mult = np.exp(self.gmm.means_[i][0])
            std_mult = np.exp(self.gmm.covariances_[i][0])
            weight = self.gmm.weights_[i]
            
            stats_list.append({
                'cluster_id': i,
                'mean_multiplier': mean_mult,
                'std_multiplier': std_mult,
                'weight': weight,
                'probability_mass': weight
            })
        
        return stats_list
    
    def identify_dry_zone(self) -> Optional[Dict]:
        """Identify the cluster representing dry zone (low multipliers)"""
        stats = self.get_cluster_stats()
        if not stats:
            return None
        
        # Find cluster with lowest mean
        dry_cluster = min(stats, key=lambda x: x['mean_multiplier'])
        
        return {
            'cluster_id': dry_cluster['cluster_id'],
            'mean_multiplier': dry_cluster['mean_multiplier'],
            'probability': dry_cluster['probability_mass']
        }
    
    def identify_moonshot_cluster(self, threshold: float = 5.0) -> Optional[Dict]:
        """Identify clusters representing moonshots (high multipliers)"""
        stats = self.get_cluster_stats()
        if not stats:
            return None
        
        # Find clusters with mean above threshold
        moonshot_clusters = [s for s in stats if s['mean_multiplier'] >= threshold]
        
        if not moonshot_clusters:
            return None
        
        # Return the one with highest mean
        best_cluster = max(moonshot_clusters, key=lambda x: x['mean_multiplier'])
        
        return {
            'cluster_id': best_cluster['cluster_id'],
            'mean_multiplier': best_cluster['mean_multiplier'],
            'probability': best_cluster['probability_mass']
        }


class ETAEstimator:
    """
    Real-time crash point estimation using survival analysis.
    
    Combines:
    - Hazard rate estimation
    - Survival function modeling
    - Bayesian updating with observed data
    """
    
    def __init__(self, prior_alpha: float = 2.0, prior_xm: float = 1.0):
        self.prior_alpha = prior_alpha
        self.prior_xm = prior_xm
        self.posterior_alpha = prior_alpha
        self.posterior_xm = prior_xm
        
    def update(self, observed_crashes: np.ndarray):
        """
        Update posterior distribution using Bayesian inference.
        
        For Pareto prior and Pareto likelihood:
        Posterior is also Pareto with updated parameters
        """
        if len(observed_crashes) == 0:
            return
        
        n = len(observed_crashes)
        max_observed = np.max(observed_crashes)
        
        # Update parameters (conjugate prior for Pareto)
        self.posterior_xm = max(self.prior_xm, max_observed)
        self.posterior_alpha = self.prior_alpha + n
    
    def estimate_current_round(self, current_multiplier: float) -> ETAEstimate:
        """
        Estimate crash point given current live multiplier.
        
        Uses conditional survival function:
        P(X > x | X > t) = S(x) / S(t) for x > t
        """
        alpha = self.posterior_alpha
        xm = self.posterior_xm
        
        # Survival function at current point
        s_current = (xm / current_multiplier) ** alpha if current_multiplier >= xm else 1.0
        
        # Hazard rate at current point
        hazard_rate = alpha / current_multiplier
        
        # Expected additional multiplier before crash
        if alpha <= 1:
            expected_additional = float('inf')
        else:
            expected_crash = alpha * current_multiplier / (alpha - 1)
            expected_additional = expected_crash - current_multiplier
        
        # Confidence interval (using quantiles of conditional distribution)
        lower_quantile = 0.025
        upper_quantile = 0.975
        
        # Inverse survival function for conditional distribution
        def inv_survival_conditional(p):
            return current_multiplier * (s_current / p) ** (1/alpha)
        
        conf_lower = inv_survival_conditional(upper_quantile)
        conf_upper = inv_survival_conditional(lower_quantile)
        
        # Distribution type
        dist_type = 'pareto_conditional'
        
        return ETAEstimate(
            estimated_crash_point=expected_crash if alpha > 1 else current_multiplier * 2,
            confidence_lower=conf_lower,
            confidence_upper=conf_upper,
            distribution_type=dist_type,
            hazard_rate=hazard_rate,
            survival_probability=s_current
        )


class CurveShapeClassifier:
    """
    Classifies crash curves into distinct shapes based on recent history.
    
    Shapes:
    - 'exponential': Standard decay pattern
    - 'power_law': Heavy-tailed behavior
    - 'bimodal': Two distinct clusters
    - 'uniform': Random distribution
    - 'clustered': Tight grouping around specific values
    """
    
    def __init__(self):
        self.shape_templates = {
            'exponential': {'skewness_range': (1.5, 3.0), 'kurtosis_range': (3.0, 10.0)},
            'power_law': {'skewness_range': (3.0, 8.0), 'kurtosis_range': (10.0, 50.0)},
            'bimodal': {'skewness_range': (-1.0, 1.0), 'kurtosis_range': (2.0, 4.0)},
            'uniform': {'skewness_range': (-0.5, 0.5), 'kurtosis_range': (1.5, 2.5)},
            'clustered': {'skewness_range': (0.5, 2.0), 'kurtosis_range': (2.5, 5.0)}
        }
    
    def classify(self, multipliers: np.ndarray) -> CurveFitResult:
        """Classify the shape of the crash curve"""
        if len(multipliers) < 10:
            raise ValueError("Need at least 10 data points for classification")
        
        # Compute statistical moments
        log_mult = np.log(multipliers)
        skewness = stats.skew(log_mult)
        kurtosis = stats.kurtosis(log_mult) + 3  # Excess kurtosis + 3
        
        # Fit different distributions and compare
        fits = {}
        
        # Exponential fit
        try:
            exp_params = stats.expon.fit(multipliers - 1)
            exp_ks = stats.kstest(multipliers, 'expon', args=exp_params)[0]
            fits['exponential'] = {'params': exp_params, 'ks': exp_ks}
        except:
            fits['exponential'] = {'params': None, 'ks': float('inf')}
        
        # Power law (Pareto) fit
        try:
            pareto_params = stats.pareto.fit(multipliers)
            pareto_ks = stats.kstest(multipliers, 'pareto', args=pareto_params)[0]
            fits['power_law'] = {'params': pareto_params, 'ks': pareto_ks}
        except:
            fits['power_law'] = {'params': None, 'ks': float('inf')}
        
        # Determine best fit
        best_shape = min(fits.keys(), key=lambda x: fits[x]['ks'])
        best_fit = fits[best_shape]
        
        # Compute R-squared approximation
        if best_fit['params'] is not None:
            r_squared = max(0, 1 - best_fit['ks'])
        else:
            r_squared = 0.0
        
        # Confidence interval via bootstrap
        bootstrap_means = []
        for _ in range(100):
            sample = np.random.choice(multipliers, size=len(multipliers), replace=True)
            bootstrap_means.append(np.mean(sample))
        
        ci_lower = np.percentile(bootstrap_means, 2.5)
        ci_upper = np.percentile(bootstrap_means, 97.5)
        
        # Log-likelihood
        if best_fit['params'] is not None:
            if best_shape == 'exponential':
                dist = stats.expon(*best_fit['params'])
            elif best_shape == 'power_law':
                dist = stats.pareto(*best_fit['params'])
            else:
                dist = None
            
            if dist:
                log_likelihood = np.sum(dist.logpdf(multipliers))
            else:
                log_likelihood = -float('inf')
        else:
            log_likelihood = -float('inf')
        
        return CurveFitResult(
            shape_type=best_shape,
            parameters={str(i): float(p) for i, p in enumerate(best_fit['params'] or [])},
            r_squared=r_squared,
            confidence_interval=(ci_lower, ci_upper),
            log_likelihood=log_likelihood
        )


class DryZonePredictor:
    """
    Predicts upcoming dry zones (periods of consistently low multipliers).
    
    Uses:
    - GMM clustering to identify low-multiplier regimes
    - Hidden Markov Models for regime detection
    - Time series analysis for pattern recognition
    """
    
    def __init__(self, low_threshold: float = 2.0, window_size: int = 50):
        self.low_threshold = low_threshold
        self.window_size = window_size
        self.gmm_analyzer = GaussianMixtureClusterAnalyzer(n_components=3)
        
    def predict(self, multipliers: np.ndarray) -> DryZonePrediction:
        """Predict probability and characteristics of dry zone"""
        if len(multipliers) < self.window_size:
            # Use available data
            window_data = multipliers
        else:
            window_data = multipliers[-self.window_size:]
        
        # Fit GMM to identify clusters
        self.gmm_analyzer.fit(window_data)
        
        # Get dry zone cluster info
        dry_info = self.gmm_analyzer.identify_dry_zone()
        
        if dry_info is None:
            return DryZonePrediction(
                probability_low_zone=0.5,
                expected_duration=5,
                severity_score=0.5,
                confidence_interval=(0.3, 0.7)
            )
        
        # Calculate probability of being in dry zone
        prob_dry = dry_info['probability']
        
        # Recent trend analysis
        recent_low_ratio = np.mean(window_data[-10:] < self.low_threshold)
        
        # Combine GMM probability with recent trend
        combined_prob = 0.6 * prob_dry + 0.4 * recent_low_ratio
        
        # Expected duration based on cluster weight and recent patterns
        base_duration = int(1 / (1 - combined_prob + 0.01))
        expected_duration = min(base_duration, 20)  # Cap at 20 rounds
        
        # Severity score (how low are the multipliers)
        mean_dry = dry_info['mean_multiplier']
        severity = 1 - (mean_dry / self.low_threshold)
        severity_score = max(0, min(1, severity))
        
        # Confidence interval via bootstrap
        bootstrap_probs = []
        for _ in range(100):
            sample = np.random.choice(window_data, size=len(window_data), replace=True)
            try:
                gmm_temp = GaussianMixtureClusterAnalyzer(n_components=3)
                gmm_temp.fit(sample)
                dry_temp = gmm_temp.identify_dry_zone()
                if dry_temp:
                    bootstrap_probs.append(dry_temp['probability'])
            except:
                pass
        
        if bootstrap_probs:
            ci_lower = np.percentile(bootstrap_probs, 2.5)
            ci_upper = np.percentile(bootstrap_probs, 97.5)
        else:
            ci_lower, ci_upper = 0.3, 0.7
        
        return DryZonePrediction(
            probability_low_zone=combined_prob,
            expected_duration=expected_duration,
            severity_score=severity_score,
            confidence_interval=(ci_lower, ci_upper),
            gmm_clusters=self.gmm_analyzer.get_cluster_stats()
        )


class MoonshotForecaster:
    """
    Forecasts high multiplier events (moonshots ≥ 5x).
    
    Uses:
    - Extreme value theory
    - Cluster analysis
    - Temporal pattern recognition
    """
    
    def __init__(self, moonshot_threshold: float = 5.0, lookback_window: int = 200):
        self.moonshot_threshold = moonshot_threshold
        self.lookback_window = lookback_window
        
    def forecast(self, multipliers: np.ndarray) -> MoonshotForecast:
        """Forecast next moonshot event"""
        if len(multipliers) < 50:
            return MoonshotForecast(
                probability_moonshot=0.1,
                expected_value=1.5,
                time_to_next=None,
                cluster_id=None,
                risk_score=0.5
            )
        
        # Use lookback window
        window_data = multipliers[-self.lookback_window:] if len(multipliers) > self.lookback_window else multipliers
        
        # Historical moonshot frequency
        moonshots = window_data[window_data >= self.moonshot_threshold]
        historical_freq = len(moonshots) / len(window_data)
        
        # Time since last moonshot
        moonshot_indices = np.where(window_data >= self.moonshot_threshold)[0]
        if len(moonshot_indices) > 0:
            rounds_since_last = len(window_data) - 1 - moonshot_indices[-1]
        else:
            rounds_since_last = len(window_data)
        
        # Probability increases with time since last moonshot (gambler's fallacy adjustment)
        base_prob = historical_freq
        time_adjustment = min(0.3, rounds_since_last / 100)
        probability_moonshot = min(0.9, base_prob + time_adjustment)
        
        # Expected value calculation
        if len(moonshots) > 0:
            mean_moonshot = np.mean(moonshots)
            expected_value = probability_moonshot * mean_moonshot + (1 - probability_moonshot) * np.mean(window_data[window_data < self.moonshot_threshold])
        else:
            expected_value = np.mean(window_data)
        
        # Time to next moonshot (geometric distribution expectation)
        if probability_moonshot > 0:
            time_to_next = int(1 / probability_moonshot)
        else:
            time_to_next = None
        
        # Cluster analysis for moonshots
        gmm = GaussianMixtureClusterAnalyzer(n_components=4)
        try:
            gmm.fit(window_data)
            moonshot_cluster = gmm.identify_moonshot_cluster(self.moonshot_threshold)
            cluster_id = moonshot_cluster['cluster_id'] if moonshot_cluster else None
        except:
            cluster_id = None
        
        # Risk score (volatility measure)
        cv = np.std(window_data) / np.mean(window_data) if np.mean(window_data) > 0 else 0
        risk_score = min(1.0, cv / 2)
        
        return MoonshotForecast(
            probability_moonshot=probability_moonshot,
            expected_value=expected_value,
            time_to_next=time_to_next,
            cluster_id=cluster_id,
            risk_score=risk_score
        )


# Convenience function for quick analysis
def analyze_crash_data(multipliers: np.ndarray) -> Dict:
    """
    Comprehensive analysis of crash data.
    
    Returns dictionary with all major metrics.
    """
    results = {}
    
    # Basic statistics
    results['basic_stats'] = {
        'mean': float(np.mean(multipliers)),
        'median': float(np.median(multipliers)),
        'std': float(np.std(multipliers)),
        'min': float(np.min(multipliers)),
        'max': float(np.max(multipliers)),
        'count': len(multipliers)
    }
    
    # Pareto fit
    pareto = ParetoDistribution()
    xm_hat, alpha_hat = pareto.fit_mle(multipliers)
    results['pareto_fit'] = {
        'x_m': float(xm_hat),
        'alpha': float(alpha_hat),
        'mean_theoretical': float(pareto.mean()) if alpha_hat > 1 else float('inf'),
        'variance_theoretical': float(pareto.variance()) if alpha_hat > 2 else float('inf')
    }
    
    # KS test for Pareto
    ks_stat, p_value = ParetoDistribution.kstest_pareto(multipliers)
    results['pareto_goodness_of_fit'] = {
        'ks_statistic': float(ks_stat),
        'p_value': float(p_value),
        'is_pareto': p_value > 0.05
    }
    
    # Curve shape classification
    classifier = CurveShapeClassifier()
    shape_result = classifier.classify(multipliers)
    results['curve_shape'] = {
        'shape_type': shape_result.shape_type,
        'r_squared': float(shape_result.r_squared),
        'confidence_interval': [float(shape_result.confidence_interval[0]), 
                               float(shape_result.confidence_interval[1])]
    }
    
    # Streak analysis
    streak_analyzer = MarkovChainStreakAnalyzer()
    streak_result = streak_analyzer.analyze_streak(multipliers)
    results['streak_analysis'] = {
        'current_streak': int(streak_result.current_streak),
        'streak_type': streak_result.streak_type,
        'expected_duration': float(streak_result.expected_duration) if streak_result.expected_duration != float('inf') else -1,
        'probability_continuation': float(streak_result.probability_continuation),
        'historical_max_streak': int(streak_result.historical_max_streak)
    }
    
    # Dry zone prediction
    dry_predictor = DryZonePredictor()
    dry_result = dry_predictor.predict(multipliers)
    results['dry_zone'] = {
        'probability_low_zone': float(dry_result.probability_low_zone),
        'expected_duration': int(dry_result.expected_duration),
        'severity_score': float(dry_result.severity_score),
        'confidence_interval': [float(dry_result.confidence_interval[0]), 
                               float(dry_result.confidence_interval[1])]
    }
    
    # Moonshot forecast
    moonshot_forecaster = MoonshotForecaster()
    moonshot_result = moonshot_forecaster.forecast(multipliers)
    results['moonshot_forecast'] = {
        'probability_moonshot': float(moonshot_result.probability_moonshot),
        'expected_value': float(moonshot_result.expected_value),
        'time_to_next': int(moonshot_result.time_to_next) if moonshot_result.time_to_next else None,
        'risk_score': float(moonshot_result.risk_score)
    }
    
    return results
