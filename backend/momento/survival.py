"""
Calibrated survival estimation.

The original engine estimated P(next >= x) with a fitted exponential. Crash
multipliers are not exponential — they are heavy tailed, with the fair law
P(X >= x) = (1 - h) / x. Fitting an exponential to that produces survival
estimates near 1.0 for every realistic target, which is why the shipped
forecast claimed ~94% for 2x when the truth is ~48.5%.

This module replaces it with an estimator that is honest by construction:

  * empirical (Kaplan-Meier trivial case) survival wherever the tape has
    enough observations above the threshold,
  * a Hill / peaks-over-threshold Pareto tail beyond the empirical support,
  * a smooth blend between the two so the curve has no discontinuity.

Calibration is then measurable — see strategies.calibration — and it lands on
the fair price, because there is nothing else for it to land on.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

MIN_EXCEEDANCES = 8       # below this the empirical estimate is noise
TAIL_FRACTION = 0.15      # top 15% of the tape defines the tail


def empirical_survival(window: Sequence[float], x: float) -> Optional[float]:
    n = len(window)
    if n == 0:
        return None
    above = sum(1 for m in window if m >= x)
    if above < MIN_EXCEEDANCES:
        return None
    return above / n


def hill_alpha(window: Sequence[float], tail_fraction: float = TAIL_FRACTION) -> Dict[str, float]:
    """Hill estimator for the Pareto tail index above a high threshold u."""
    xs = sorted(m for m in window if m > 1.0)
    n = len(xs)
    if n < 40:
        return {"alpha": 1.0, "u": 2.0, "p_u": 0.5, "k": 0}
    k = max(10, int(n * tail_fraction))
    k = min(k, n - 1)
    u = xs[n - k]
    logs = [math.log(m / u) for m in xs[n - k:] if m > u]
    if not logs:
        return {"alpha": 1.0, "u": u, "p_u": k / n, "k": k}
    alpha = 1.0 / (sum(logs) / len(logs))
    # the fair tail index is exactly 1.0; clamp away from absurd fits
    alpha = max(0.55, min(2.5, alpha))
    return {"alpha": alpha, "u": u, "p_u": k / len(xs), "k": k}


def tail_survival(window: Sequence[float], x: float,
                  tail: Optional[Dict[str, float]] = None) -> float:
    t = tail or hill_alpha(window)
    u, p_u, alpha = t["u"], t["p_u"], t["alpha"]
    if x <= u or u <= 0:
        return min(1.0, max(0.0, p_u))
    return max(0.0, min(1.0, p_u * (u / x) ** alpha))


def survival(window: Sequence[float], x: float,
             tail: Optional[Dict[str, float]] = None) -> float:
    """Best available estimate of P(next round reaches x)."""
    if x <= 1.0:
        return 1.0
    emp = empirical_survival(window, x)
    t = tail or hill_alpha(window)
    par = tail_survival(window, x, t)
    if emp is None:
        return par
    # blend once we are inside the tail region where the empirical count thins out
    n = len(window)
    above = emp * n
    w = 0.0 if above >= 4 * MIN_EXCEEDANCES else 1 - (above - MIN_EXCEEDANCES) / (3 * MIN_EXCEEDANCES)
    w = max(0.0, min(1.0, w))
    return max(0.0, min(1.0, (1 - w) * emp + w * par))


def curve(window: Sequence[float], maximum: float = 20.0, steps: int = 60,
          house_edge: float = 0.03) -> List[Dict[str, float]]:
    tail = hill_alpha(window)
    out: List[Dict[str, float]] = []
    for i in range(steps):
        x = round(1 + (maximum - 1) * i / (steps - 1), 2)
        out.append({
            "x": x,
            "p": round(survival(window, x, tail), 5),
            "fair": round(min(1.0, (1 - house_edge) / x) if x > 1 else 1.0, 5),
        })
    return out


def band_probability(window: Sequence[float], lo: float, hi: float,
                     tail: Optional[Dict[str, float]] = None) -> float:
    t = tail or hill_alpha(window)
    s_lo = survival(window, lo, t)
    s_hi = 0.0 if hi == float("inf") else survival(window, hi, t)
    return max(0.0, min(1.0, s_lo - s_hi))


def diagnostics(window: Sequence[float], house_edge: float = 0.03) -> Dict[str, Any]:
    t = hill_alpha(window)
    checks = []
    for x in (1.5, 2.0, 3.0, 5.0, 10.0, 25.0, 50.0):
        est = survival(window, x, t)
        fair = min(1.0, (1 - house_edge) / x)
        checks.append({"target": x, "estimate": round(est, 5), "fair": round(fair, 5),
                       "deviation": round(est - fair, 5)})
    worst = max(abs(c["deviation"]) for c in checks) if checks else 0.0
    return {
        "tail": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in t.items()},
        "fairTailIndex": 1.0,
        "checks": checks,
        "maxDeviation": round(worst, 5),
        "verdict": "calibrated" if worst <= 0.06 else ("drifting" if worst <= 0.15 else "miscalibrated"),
        "note": ("A calibrated estimator on a fair tape must sit on (1-h)/x. Any persistent "
                 "positive deviation is overconfidence, not edge."),
    }
