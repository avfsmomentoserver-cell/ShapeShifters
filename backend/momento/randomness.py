"""
Randomness & independence test battery.

The honest core of the product. Every pattern engine in Momento assumes the
tape carries exploitable structure; this module tests that assumption against
the null hypothesis of a correctly implemented crash game:

    P(M >= m) = (1 - h) / m     for m >= 1
    point mass h at exactly 1.00x   (the instant crash)
    rounds independent and identically distributed

If these tests do not reject the null, no pattern engine can have an edge and
the app says so out loud. That is a feature, not a caveat.
"""
from __future__ import annotations

import math
from collections import Counter
from typing import Any, Dict, List, Sequence

import numpy as np

try:  # scipy is preferred but the module degrades gracefully without it
    from scipy import stats as _st
except Exception:  # pragma: no cover
    _st = None


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _norm_sf(z: float) -> float:
    """Two-sided normal tail probability without scipy."""
    return math.erfc(abs(z) / math.sqrt(2))


def _chi2_sf(x: float, df: int) -> float:
    """Upper tail of the chi-square distribution (regularised gamma Q)."""
    if _st is not None:
        return float(_st.chi2.sf(x, df))
    if x <= 0 or df <= 0:
        return 1.0
    # Wilson-Hilferty cube-root normal approximation
    z = (((x / df) ** (1 / 3)) - (1 - 2 / (9 * df))) / math.sqrt(2 / (9 * df))
    return 0.5 * math.erfc(z / math.sqrt(2))


def theoretical_survival(m: float, house_edge: float) -> float:
    """P(crash point >= m)."""
    if m <= 1.0:
        return 1.0
    return max(0.0, min(1.0, (1.0 - house_edge) / m))


def _verdict(p: float) -> str:
    if p < 0.001:
        return "reject"
    if p < 0.05:
        return "suspect"
    return "consistent"


# ---------------------------------------------------------------------------
# 1. distribution fit
# ---------------------------------------------------------------------------

def estimate_house_edge(multipliers: Sequence[float]) -> Dict[str, Any]:
    """
    Two independent estimators of the house edge:
      * instant-crash frequency (rounds at exactly 1.00x)
      * implied RTP from the harmonic structure, E[1/M] = 1 for a fair tail
    """
    xs = np.asarray([m for m in multipliers if m >= 1.0], dtype=float)
    n = xs.size
    if n < 30:
        return {"error": "need >= 30 rounds", "rounds": int(n)}

    instant = float(np.mean(xs <= 1.001))
    # Implied RTP: a flat 1-unit bet at target t returns t with prob P(M>=t).
    # Averaged across the observed tape, empirical RTP at target t is
    # t * hitrate(t); a fair game gives (1-h) at every t.
    targets = [1.2, 1.5, 2.0, 3.0, 5.0, 10.0]
    rtps = [t * float(np.mean(xs >= t)) for t in targets]
    implied_rtp = float(np.mean(rtps))

    # MLE of the tail exponent for f(m) = a / m^(a+1) on m > 1; fair game => a = 1
    tail = xs[xs > 1.001]
    alpha = float(tail.size / np.sum(np.log(tail))) if tail.size > 5 else float("nan")
    se_alpha = alpha / math.sqrt(tail.size) if tail.size > 5 else float("nan")
    z_alpha = (alpha - 1.0) / se_alpha if se_alpha and se_alpha > 0 else float("nan")

    return {
        "rounds": int(n),
        "instant_crash_rate": instant,
        "edge_from_instant_crashes": instant,
        "implied_rtp": implied_rtp,
        "edge_from_rtp": 1.0 - implied_rtp,
        "rtp_by_target": {str(t): r for t, r in zip(targets, rtps)},
        "tail_exponent_alpha": alpha,
        "tail_exponent_se": se_alpha,
        "alpha_z_vs_fair": z_alpha,
        "alpha_p_value": _norm_sf(z_alpha) if z_alpha == z_alpha else None,
        "alpha_note": "a correctly implemented crash game has alpha = 1.000 exactly",
    }


def chi_square_fit(multipliers: Sequence[float], house_edge: float = 0.03) -> Dict[str, Any]:
    """Binned goodness-of-fit against P(M >= m) = (1-h)/m."""
    xs = [m for m in multipliers if m >= 1.0]
    n = len(xs)
    if n < 100:
        return {"error": "need >= 100 rounds", "rounds": n}

    edges = [1.0, 1.01, 1.2, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 50.0, float("inf")]
    observed: List[int] = []
    expected: List[float] = []
    labels: List[str] = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        if lo == 1.0:
            obs = sum(1 for m in xs if m <= 1.001)
            p = house_edge
            label = "1.00 (instant)"
        else:
            obs = sum(1 for m in xs if lo <= m < hi)
            p = theoretical_survival(lo, house_edge) - theoretical_survival(hi, house_edge)
            label = f"{lo:g}–{'∞' if hi == float('inf') else f'{hi:g}'}"
        observed.append(obs)
        expected.append(p * n)
        labels.append(label)

    # pool bins with expected < 5 into the previous bin (chi-square validity)
    stat = 0.0
    used = 0
    pooled_o, pooled_e, pooled_l = [], [], []
    acc_o, acc_e, acc_l = 0, 0.0, []
    for o, e, lb in zip(observed, expected, labels):
        acc_o += o
        acc_e += e
        acc_l.append(lb)
        if acc_e >= 5:
            pooled_o.append(acc_o)
            pooled_e.append(acc_e)
            pooled_l.append(acc_l[0] if len(acc_l) == 1 else f"{acc_l[0]}…{acc_l[-1]}")
            acc_o, acc_e, acc_l = 0, 0.0, []
    if acc_e > 0 and pooled_e:
        pooled_o[-1] += acc_o
        pooled_e[-1] += acc_e

    for o, e in zip(pooled_o, pooled_e):
        stat += (o - e) ** 2 / e
        used += 1
    df = max(1, used - 1)
    p_value = _chi2_sf(stat, df)

    return {
        "test": "chi-square goodness of fit",
        "rounds": n,
        "house_edge": house_edge,
        "statistic": stat,
        "df": df,
        "p_value": p_value,
        "verdict": _verdict(p_value),
        "bins": [
            {"band": lb, "observed": o, "expected": round(e, 2),
             "residual": round((o - e) / math.sqrt(e), 2)}
            for lb, o, e in zip(pooled_l, pooled_o, pooled_e)
        ],
        "interpretation": (
            "Tape is consistent with a fair crash distribution — no distributional edge exists."
            if p_value >= 0.05 else
            "Tape deviates from the fair crash distribution. Check the house edge setting before "
            "concluding anything about the operator."
        ),
    }


def ks_test(multipliers: Sequence[float], house_edge: float = 0.03) -> Dict[str, Any]:
    """Kolmogorov-Smirnov test on the continuous part (m > 1)."""
    xs = sorted(m for m in multipliers if m > 1.001)
    n = len(xs)
    if n < 50:
        return {"error": "need >= 50 non-instant rounds", "rounds": n}
    # Conditional CDF given m > 1: F(m) = 1 - 1/m
    d = 0.0
    for i, m in enumerate(xs, start=1):
        f = 1.0 - 1.0 / m
        d = max(d, abs(f - i / n), abs(f - (i - 1) / n))
    lam = (math.sqrt(n) + 0.12 + 0.11 / math.sqrt(n)) * d
    p = 2.0 * sum((-1) ** (k - 1) * math.exp(-2.0 * k * k * lam * lam) for k in range(1, 100))
    p = max(0.0, min(1.0, p))
    return {
        "test": "Kolmogorov-Smirnov vs 1 - 1/m",
        "rounds": n,
        "statistic": d,
        "p_value": p,
        "verdict": _verdict(p),
    }


# ---------------------------------------------------------------------------
# 2. independence
# ---------------------------------------------------------------------------

def runs_test(multipliers: Sequence[float], threshold: float = 2.0) -> Dict[str, Any]:
    """Wald-Wolfowitz runs test on above/below-threshold coding."""
    seq = [1 if m >= threshold else 0 for m in multipliers]
    n = len(seq)
    n1, n0 = sum(seq), n - sum(seq)
    if n1 < 10 or n0 < 10:
        return {"error": "need >= 10 observations on each side", "rounds": n}
    runs = 1 + sum(1 for i in range(1, n) if seq[i] != seq[i - 1])
    exp_runs = 1 + 2 * n1 * n0 / n
    var = 2 * n1 * n0 * (2 * n1 * n0 - n) / (n * n * (n - 1))
    z = (runs - exp_runs) / math.sqrt(var) if var > 0 else 0.0
    p = _norm_sf(z)
    return {
        "test": f"Wald-Wolfowitz runs test at {threshold:g}x",
        "rounds": n,
        "runs_observed": runs,
        "runs_expected": exp_runs,
        "z": z,
        "p_value": p,
        "verdict": _verdict(p),
        "interpretation": (
            "Streak structure is what independent rounds produce. Streak-chasing has no edge."
            if p >= 0.05 else
            "Streaks occur more or less often than independence predicts — worth a second look."
        ),
    }


def autocorrelation(multipliers: Sequence[float], max_lag: int = 20) -> Dict[str, Any]:
    """Autocorrelation of log multipliers plus a Ljung-Box portmanteau test."""
    xs = np.log(np.asarray([max(1.0, m) for m in multipliers], dtype=float))
    n = xs.size
    if n < 60:
        return {"error": "need >= 60 rounds", "rounds": int(n)}
    xs = xs - xs.mean()
    denom = float(np.dot(xs, xs))
    lags = min(max_lag, n // 4)
    acf: List[Dict[str, Any]] = []
    q = 0.0
    for k in range(1, lags + 1):
        r = float(np.dot(xs[:-k], xs[k:]) / denom) if denom > 0 else 0.0
        q += r * r / (n - k)
        acf.append({"lag": k, "r": r, "significant": abs(r) > 1.96 / math.sqrt(n)})
    q *= n * (n + 2)
    p = _chi2_sf(q, lags)
    return {
        "test": "Ljung-Box on log multipliers",
        "rounds": int(n),
        "lags": lags,
        "ci95": 1.96 / math.sqrt(n),
        "acf": acf,
        "ljung_box_q": q,
        "p_value": p,
        "verdict": _verdict(p),
        "interpretation": (
            "No serial correlation. The previous round tells you nothing about the next one."
            if p >= 0.05 else
            "Serial correlation detected at the tested lags."
        ),
    }


def conditional_dependence(multipliers: Sequence[float], threshold: float = 2.0) -> Dict[str, Any]:
    """
    The decisive test for every pattern engine in this app: does the band of
    round n predict whether round n+1 clears the threshold? A chi-square test
    of independence on the contingency table answers it directly.
    """
    bands = [(1.0, 1.5, "dust <1.5x"), (1.5, 2.0, "floor 1.5–2x"),
             (2.0, 5.0, "mid 2–5x"), (5.0, 10.0, "high 5–10x"), (10.0, float("inf"), "moon 10x+")]

    def band_of(m: float) -> str:
        for lo, hi, name in bands:
            if lo <= m < hi:
                return name
        return bands[-1][2]

    table: Dict[str, List[int]] = {name: [0, 0] for _, _, name in bands}
    for prev, nxt in zip(multipliers[:-1], multipliers[1:]):
        table[band_of(prev)][1 if nxt >= threshold else 0] += 1

    rows = [(k, v) for k, v in table.items() if sum(v) >= 20]
    if len(rows) < 2:
        return {"error": "not enough data per band", "rounds": len(multipliers)}

    total = sum(sum(v) for _, v in rows)
    col = [sum(v[0] for _, v in rows), sum(v[1] for _, v in rows)]
    stat = 0.0
    detail = []
    for name, v in rows:
        rt = sum(v)
        for j in (0, 1):
            e = rt * col[j] / total
            if e > 0:
                stat += (v[j] - e) ** 2 / e
        detail.append({
            "previous_band": name,
            "samples": rt,
            "hit_rate": v[1] / rt,
            "expected_rate": col[1] / total,
            "lift": (v[1] / rt) / (col[1] / total) if col[1] else 0.0,
        })
    df = (len(rows) - 1) * 1
    p = _chi2_sf(stat, df)
    return {
        "test": f"chi-square independence: previous band -> P(next >= {threshold:g}x)",
        "rounds": len(multipliers),
        "statistic": stat,
        "df": df,
        "p_value": p,
        "verdict": _verdict(p),
        "baseline_hit_rate": col[1] / total,
        "rows": detail,
        "interpretation": (
            "Previous-round band carries no information about the next round. Every pattern, "
            "ladder, streak and DNA signal in this app is describing noise."
            if p >= 0.05 else
            "A dependence was detected. Re-test on fresh out-of-sample rounds before trusting it — "
            "multiple testing across many engines produces false positives easily."
        ),
    }


def digit_uniformity(multipliers: Sequence[float]) -> Dict[str, Any]:
    """Chi-square on the second decimal digit — catches rounding or capture bugs."""
    digits = [int(round(m * 100)) % 10 for m in multipliers if m > 1.001]
    n = len(digits)
    if n < 200:
        return {"error": "need >= 200 rounds", "rounds": n}
    counts = Counter(digits)
    e = n / 10
    stat = sum((counts.get(d, 0) - e) ** 2 / e for d in range(10))
    p = _chi2_sf(stat, 9)
    return {
        "test": "second-decimal digit uniformity",
        "rounds": n,
        "counts": {str(d): counts.get(d, 0) for d in range(10)},
        "statistic": stat,
        "df": 9,
        "p_value": p,
        "verdict": _verdict(p),
    }


def full_battery(multipliers: Sequence[float], house_edge: float = 0.03) -> Dict[str, Any]:
    """Run every test and produce a single plain-language conclusion."""
    tests = {
        "house_edge": estimate_house_edge(multipliers),
        "chi_square_fit": chi_square_fit(multipliers, house_edge),
        "ks": ks_test(multipliers, house_edge),
        "runs": runs_test(multipliers),
        "autocorrelation": autocorrelation(multipliers),
        "conditional_dependence": conditional_dependence(multipliers),
        "digit_uniformity": digit_uniformity(multipliers),
    }
    verdicts = [t.get("verdict") for t in tests.values() if isinstance(t, dict) and t.get("verdict")]
    rejected = [k for k, t in tests.items()
                if isinstance(t, dict) and t.get("verdict") in ("reject", "suspect")]
    passed = sum(1 for v in verdicts if v == "consistent")
    return {
        "tests": tests,
        "overall": {
            "verdict": "consistent" if not rejected else ("suspect" if len(rejected) == 1 else "reject"),
            "passed": passed,
            "total": len(verdicts),
            "flagged": rejected,
            "summary": (
                f"{passed} of {len(verdicts)} tests are consistent with independent, fairly "
                "distributed rounds."
                if not rejected else
                f"{passed} of {len(verdicts)} tests passed; flagged: " + ", ".join(rejected) + "."
            ),
        },
        "summary": {
            "tests_run": len(verdicts),
            "consistent_with_fair_random": passed,
            "flagged": rejected,
            "conclusion": (
                "Every test is consistent with independent, fairly distributed rounds. "
                "No forecasting engine — in this app or any other — can produce a positive "
                "expected value against this tape. Treat all signals as descriptive only."
                if not rejected else
                "Some tests flagged: " + ", ".join(rejected) +
                ". This usually means the house-edge setting is wrong, the sample is small, or the "
                "capture is incomplete — not that the game is beatable. Re-test out of sample."
            ),
        },
    }
