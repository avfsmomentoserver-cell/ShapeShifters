"""Engine test suite — mirrors backend/tests/test_math_models.py from ShapeShifters."""
import math

import pytest

from momento import math_models as mm, pipeline


def synth(n: int = 600, seed: int = 7) -> list:
    """Deterministic synthetic crash distribution (1% instant, exponential tail)."""
    import random

    rng = random.Random(seed)
    out = []
    for _ in range(n):
        u = rng.random()
        if u < 0.01:
            out.append(1.0)
        else:
            out.append(round(min(500, 0.99 / max(0.005, 1 - u ** 3.2)), 2))
    return out


# --- Pareto -----------------------------------------------------------------

def test_pareto_mle_recovers_alpha():
    xs = synth()
    fit = mm.pareto_fit(xs)
    assert fit.ok and 0.5 < fit.alpha < 8.0
    assert fit.survival(fit.xm) == 1.0
    assert 0 < fit.survival(50) < 1


def test_pareto_insufficient_data():
    assert not mm.pareto_fit([1.2, 1.3]).ok


# --- Exponential ------------------------------------------------------------

def test_exponential_survival_monotonic():
    fit = mm.exponential_fit(synth())
    prev = 1.0
    for x in (1.5, 2, 3, 5, 10):
        s = fit.survival(x)
        assert 0 <= s < prev
        prev = s


# --- Markov -----------------------------------------------------------------

def test_markov_transition_sums():
    a = mm.markov_streaks(synth())
    ww, wl, lw, ll = a.transition
    assert ww + wl > 0 and lw + ll > 0
    assert a.expected_duration >= 1.0
    assert a.streak_type in ("win", "loss")


# --- Clustering --------------------------------------------------------------

def test_clusters_partition():
    clusters = mm.cluster_log(synth())
    assert clusters and sum(c.count for c in clusters) == len(synth())
    assert [c.label for c in clusters] == ["floor", "mid", "moon"]
    assert clusters[0].mean_multiplier < clusters[-1].mean_multiplier


# --- Regimes ------------------------------------------------------------------

def test_regime_distribution_sums():
    r = mm.detect_regimes(synth())
    assert abs(sum(r.distribution.values()) - 1.0) < 1e-9
    assert r.current in r.distribution


# --- Curve shapes --------------------------------------------------------------

def test_curve_fit_prefers_exponential_for_exponential_data():
    pts = [1 + 9 * (math.exp(1.8 * t) - 1) / (math.exp(1.8) - 1) for t in [i / 11 for i in range(12)]]
    fit = mm.fit_curve_shape(pts)
    assert fit.shape in ("exponential", "logistic")
    assert fit.r2 > 0.9


# --- Pipeline -------------------------------------------------------------------

def test_candidates_normalized_and_ranked():
    xs = synth()
    a = pipeline.analyze(xs)
    cands = pipeline.candidates(xs, a)
    assert abs(sum(c["probability"] for c in cands) - 1.0) < 1e-6
    assert cands == sorted(cands, key=lambda c: c["probability"], reverse=True)
    for c in cands:
        lo, hi = c["range"]
        # The top band is open-ended; JSON has no infinity, so it serialises as null.
        assert hi is None or lo < hi
        assert c["drivers"]


def test_ladder_eta_bounds():
    l = pipeline.ladder_eta(synth())
    assert 0 <= l["pressure_score"] <= 1
    assert -10 <= l["eta_adjustment"] <= 0
    assert 0 <= l["moonshot_probability"] <= 0.95


def test_dna_match_shape():
    d = pipeline.dna_match(synth())
    assert 0 <= d["confidence"] <= 1
    assert 0 <= d["outcomes"]["p_next_moon_rate"] <= 1


def test_probability_above_bounds():
    xs = synth()
    for t in (2, 5, 10, 20):
        p = pipeline.probability_above(xs, t)
        assert 0.0 <= p <= 1.0
    # Calibrated survival must be monotone decreasing in the threshold.
    ps = [pipeline.probability_above(xs, t) for t in (1.5, 2, 5, 10, 20)]
    assert all(a >= b - 1e-9 for a, b in zip(ps, ps[1:]))


def test_full_analysis_payload():
    a = pipeline.analyze(synth())
    assert a["state"] in pipeline.STATES
    assert len(a["percentiles"]) == 6
    assert set(a["shape_distribution"]) == {"exponential", "power_law", "logistic"}


def test_empty_inputs_do_not_crash():
    assert pipeline.candidates([]) == []
    assert mm.cluster_log([]) == []
    assert mm.markov_streaks([2.0]).transition == (0, 0, 0, 0)
