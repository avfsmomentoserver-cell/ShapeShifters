"""Momento mathematical core — validated crash-game engines.

Ported from MomentoV5 / ShapeShifters with the original mathematical rigor:
Pareto MLE tails, exponential house-edge model, Markov streaks, GMM clustering,
regime detection (HMM fallback), curve-shape fitting, ensemble, ETA.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

HOUSE_EDGE = 0.04


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def mean(xs: Sequence[float]) -> float:
    return float(np.mean(xs)) if len(xs) else 0.0


def stdev(xs: Sequence[float]) -> float:
    return float(np.std(xs, ddof=1)) if len(xs) > 1 else 0.0


def clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def quantile(sorted_xs: Sequence[float], q: float) -> float:
    if not sorted_xs:
        return 0.0
    pos = (len(sorted_xs) - 1) * q
    base = int(math.floor(pos))
    rest = pos - base
    if base + 1 < len(sorted_xs):
        return float(sorted_xs[base] + rest * (sorted_xs[base + 1] - sorted_xs[base]))
    return float(sorted_xs[base])


# ---------------------------------------------------------------------------
# Pareto tail model
# ---------------------------------------------------------------------------

@dataclass
class ParetoFit:
    xm: float
    alpha: float
    ok: bool

    def survival(self, x: float) -> float:
        if not self.ok or x <= self.xm:
            return 1.0
        return float((self.xm / x) ** self.alpha)


def pareto_fit(multipliers: Sequence[float]) -> ParetoFit:
    """MLE: x_m = min(x); alpha = n / sum(ln(x_i / x_m))."""
    if len(multipliers) < 10:
        return ParetoFit(1.0, 1.5, False)
    xm = min(multipliers)
    if xm <= 0:
        return ParetoFit(1.0, 1.5, False)
    logs = [math.log(x / xm) for x in multipliers if x > 0]
    s = sum(logs)
    alpha = len(multipliers) / s if s > 0 else 1.5
    return ParetoFit(xm, clamp(alpha, 0.2, 12.0), True)


# ---------------------------------------------------------------------------
# Exponential crash model with house edge
# ---------------------------------------------------------------------------

@dataclass
class ExpFit:
    lam: float
    expected: float

    def survival(self, x: float) -> float:
        if x <= 1:
            return 1.0
        return (1 - HOUSE_EDGE) * math.exp(-self.lam * (x - 1))


def exponential_fit(multipliers: Sequence[float]) -> ExpFit:
    tail_mean = mean([max(0.0, x - 1) for x in multipliers]) or 1.0
    lam = clamp(-math.log(1 - HOUSE_EDGE) / tail_mean, 0.02, 8.0)
    return ExpFit(lam, 1 + (1 - HOUSE_EDGE) / lam)


# ---------------------------------------------------------------------------
# Markov streak engine
# ---------------------------------------------------------------------------

@dataclass
class StreakAnalysis:
    current_streak: int
    streak_type: str          # 'win' | 'loss'
    p_continue: float
    expected_duration: float
    transition: Tuple[int, int, int, int]   # WW, WL, LW, LL
    historical_max: int


def markov_streaks(multipliers: Sequence[float], threshold: float = 2.0) -> StreakAnalysis:
    states = [1 if m >= threshold else 0 for m in multipliers]
    ww = wl = lw = ll = 0
    for a, b in zip(states, states[1:]):
        if a == 1 and b == 1: ww += 1
        elif a == 1 and b == 0: wl += 1
        elif a == 0 and b == 1: lw += 1
        else: ll += 1

    def max_run(side: int) -> int:
        best = run = 0
        for s in states:
            run = run + 1 if s == side else 0
            best = max(best, run)
        return best

    current_streak = 0
    current_type = states[-1] if states else 0
    for s in reversed(states):
        if s == current_type:
            current_streak += 1
        else:
            break

    from_win, from_loss = ww + wl, lw + ll
    p_continue = (ww / from_win if from_win else 0.5) if current_type == 1 else (ll / from_loss if from_loss else 0.5)
    return StreakAnalysis(
        current_streak=current_streak,
        streak_type="win" if current_type == 1 else "loss",
        p_continue=p_continue,
        expected_duration=1.0 / max(0.01, 1 - p_continue),
        transition=(ww, wl, lw, ll),
        historical_max=max_run(current_type),
    )


# ---------------------------------------------------------------------------
# GMM-lite clustering (k-means on log multipliers)
# ---------------------------------------------------------------------------

@dataclass
class Cluster:
    id: int
    label: str                # floor | mid | moon
    count: int
    proportion: float
    mean_multiplier: float
    min_multiplier: float
    max_multiplier: float


def cluster_log(multipliers: Sequence[float], k: int = 3, iterations: int = 24) -> List[Cluster]:
    if len(multipliers) < k * 3:
        return []
    logs = np.log(np.maximum(np.asarray(multipliers, dtype=float), 1.001))
    order = np.argsort(logs)
    centers = np.array([logs[order[int((i + 0.5) / k * len(logs))]] for i in range(k)])
    assign = np.zeros(len(logs), dtype=int)
    for _ in range(iterations):
        assign = np.argmin(np.abs(logs[:, None] - centers[None, :]), axis=1)
        new = np.array([logs[assign == i].mean() if (assign == i).any() else centers[i] for i in range(k)])
        if np.allclose(new, centers):
            break
        centers = new

    rank = {idx: rank for rank, idx in enumerate(np.argsort(centers))}
    labels = ["floor", "mid", "moon"]
    out: List[Cluster] = []
    for i in range(k):
        members = np.asarray(multipliers)[assign == i]
        if len(members) == 0:
            continue
        out.append(Cluster(
            id=i, label=labels[rank[i]], count=int(len(members)),
            proportion=float(len(members) / len(multipliers)),
            mean_multiplier=float(members.mean()),
            min_multiplier=float(members.min()), max_multiplier=float(members.max()),
        ))
    return sorted(out, key=lambda c: c.mean_multiplier)


# ---------------------------------------------------------------------------
# Regime detection — rolling volatility bands (HMM fallback)
# ---------------------------------------------------------------------------

@dataclass
class RegimeReport:
    current: str
    stay_probability: float
    distribution: Dict[str, float]
    transition_detected: bool


def detect_regimes(multipliers: Sequence[float], window: int = 50) -> RegimeReport:
    w = int(clamp(len(multipliers) // 2, 5, window))
    if len(multipliers) < w + 1:
        return RegimeReport("moderate", 0.5, {"low_vol": 0.33, "moderate": 0.34, "high_vol": 0.33}, False)
    arr = np.asarray(multipliers, dtype=float)
    vols = np.array([arr[i - w + 1:i + 1].std(ddof=1) for i in range(w - 1, len(arr))])
    vm, vs = float(vols.mean()), float(vols.std(ddof=1))

    def classify(v: float) -> str:
        return "low_vol" if v < vm - vs else "high_vol" if v > vm + vs else "moderate"

    regimes = [classify(float(v)) for v in vols]
    cur = regimes[-1]
    dist = {r: regimes.count(r) / len(regimes) for r in ("low_vol", "moderate", "high_vol")}
    stays = total = 0
    for prev, nxt in zip(regimes, regimes[1:]):
        if prev == cur:
            total += 1
            stays += nxt == cur
    tail = regimes[-5:]
    transition = len(tail) == 5 and all(r == cur for r in tail) and regimes[-6] != cur
    return RegimeReport(cur, stays / total if total else 0.5, dist, transition)


# ---------------------------------------------------------------------------
# Curve-shape fitting
# ---------------------------------------------------------------------------

def _linreg(xs: np.ndarray, ys: np.ndarray) -> Tuple[float, float, float]:
    n = len(xs)
    mx, my = xs.mean(), ys.mean()
    den = float(((xs - mx) ** 2).sum())
    slope = float(((xs - mx) * (ys - my)).sum() / den) if den else 0.0
    intercept = float(my - slope * mx)
    pred = slope * xs + intercept
    ss_res = float(((ys - pred) ** 2).sum())
    ss_tot = float(((ys - my) ** 2).sum())
    return slope, intercept, 1 - ss_res / ss_tot if ss_tot else 0.0


@dataclass
class CurveFit:
    shape: str                # exponential | power_law | logistic
    r2: float
    params: Dict[str, float]


def fit_curve_shape(points: Sequence[float]) -> CurveFit:
    n = len(points)
    if n < 6:
        return CurveFit("exponential", 0.0, {})
    t = np.linspace(0.0, 1.0, n)
    eps = 1e-6
    y = np.maximum(np.asarray(points, dtype=float), eps)
    y_norm = np.clip(y / max(y.max(), eps), 0.01, 0.99)

    _, _, r_exp = _linreg(t, np.log(y))
    _, _, r_pow = _linreg(np.log(t + eps), np.log(y))
    slope, intercept, r_log = _linreg(t, np.log(y_norm / (1 - y_norm)))

    best_shape, best_r2 = max(
        (("exponential", r_exp), ("power_law", r_pow), ("logistic", r_log)),
        key=lambda p: p[1],
    )
    params: Dict[str, float] = {}
    if best_shape == "exponential":
        params = {"growth": float(math.exp(min(20.0, slope))), "base": float(math.exp(min(50.0, intercept)))}
    elif best_shape == "logistic":
        params = {"steepness": float(slope), "midpoint": float(clamp(-intercept / (slope or 1.0), 0, 1))}
    return CurveFit(best_shape, float(best_r2), params)


def curve_shape_distribution(multipliers: Sequence[float], sample_count: int = 40) -> Dict[str, float]:
    dist = {"exponential": 0, "power_law": 0, "logistic": 0}
    sample = list(multipliers)[-sample_count:]
    for m in sample:
        steps = 12
        pts = [1 + (m - 1) * (i / (steps - 1)) ** 1.6 for i in range(steps)]
        dist[fit_curve_shape(pts).shape] += 1
    total = len(sample) or 1
    return {k: v / total for k, v in dist.items()}


# ---------------------------------------------------------------------------
# ETA — survival blending exponential bulk with Pareto tail
# ---------------------------------------------------------------------------

@dataclass
class ETAReport:
    estimated_crash_point: float
    confidence_lower: float
    confidence_upper: float
    hazard_rate: float
    survival_at: Callable[[float], float] = field(repr=False, default=lambda x: 1.0)


def eta_estimate(multipliers: Sequence[float]) -> ETAReport:
    exp = exponential_fit(multipliers)
    par = pareto_fit(multipliers)
    sorted_xs = sorted(multipliers)

    def survival_at(x: float) -> float:
        if x <= 1:
            return 1.0
        bulk = exp.survival(x)
        tail = par.survival(x) if x > 4 else bulk
        w = clamp((x - 2) / 4, 0.0, 1.0)
        return bulk * (1 - w) + tail * w

    return ETAReport(
        estimated_crash_point=quantile(sorted_xs, 0.5),
        confidence_lower=quantile(sorted_xs, 0.25),
        confidence_upper=quantile(sorted_xs, 0.90),
        hazard_rate=exp.lam,
        survival_at=survival_at,
    )
