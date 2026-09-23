"""
Tests for the four modules that make this build honest: seed verification,
the randomness battery, calibrated survival, and expected-value arithmetic.

Everything here is checked against closed-form crash identities rather than
against the code's own output, so a regression in the maths fails the test
instead of quietly moving the goalposts.
"""
import math

import pytest

from momento import ev, fairness, randomness, survival

SERVER = "momento-demo-server-seed-2f9c41a7b6e5"
CLIENT = "momento-demo-client"
EDGE = 0.03


@pytest.fixture(scope="module")
def tape():
    """A genuinely provably-fair tape. Large enough for the battery to be meaningful."""
    return fairness.generate_provable_tape(SERVER, CLIENT, count=4000, house_edge=EDGE)


# --- Fairness -------------------------------------------------------------------

def test_crash_point_is_deterministic_and_reproducible():
    a = fairness.crash_point_stake(SERVER, CLIENT, 4, EDGE)
    b = fairness.crash_point_stake(SERVER, CLIENT, 4, EDGE)
    assert a["crash_point"] == b["crash_point"]
    assert a["digest"] == b["digest"]
    assert a["message"] == f"{CLIENT}:4"


def test_crash_point_matches_the_published_construction():
    """crash = floor(max(1, 2^32/(i+1) * (1-h)) * 100) / 100, i = first 4 digest bytes."""
    r = fairness.crash_point_stake(SERVER, CLIENT, 17, EDGE)
    digest = fairness.hmac_sha256_hex(SERVER, f"{CLIENT}:17")
    i = int(digest[:8], 16)
    expected = math.floor(max(1.0, (2**32 / (i + 1)) * (1 - EDGE)) * 100) / 100
    assert r["digest"] == digest
    assert r["integer"] == i
    assert r["crash_point"] == expected


def test_crash_point_never_below_one():
    for n in range(1, 400):
        assert fairness.crash_point_stake(SERVER, CLIENT, n, EDGE)["crash_point"] >= 1.0


def test_verify_round_accepts_the_truth_and_rejects_a_tampered_value():
    truth = fairness.crash_point_stake(SERVER, CLIENT, 9, EDGE)["crash_point"]
    ok = fairness.verify_round(SERVER, CLIENT, 9, truth, house_edge=EDGE)
    bad = fairness.verify_round(SERVER, CLIENT, 9, truth + 1.0, house_edge=EDGE)
    assert ok["match"] is True
    assert bad["match"] is False


def test_seed_chain_commitment():
    revealed = "abc123"
    committed = fairness.sha256_hex(revealed)
    assert fairness.verify_seed_chain(revealed, committed)["valid"] is True
    assert fairness.verify_seed_chain(revealed, fairness.sha256_hex("other"))["valid"] is False


def test_solve_convention_recovers_the_generating_convention():
    truth = fairness.crash_point_stake(SERVER, CLIENT, 12, EDGE)["crash_point"]
    res = fairness.solve_convention(SERVER, CLIENT, 12, truth)
    assert res["matches"], "the convention that produced the round must be found"
    assert res["conclusive"] is True
    assert any(abs(m["house_edge"] - EDGE) < 1e-9 for m in res["matches"])


# --- Survival / calibration -----------------------------------------------------

def test_survival_is_monotone_and_bounded(tape):
    xs = [1.2, 1.5, 2.0, 3.0, 5.0, 10.0, 25.0]
    ps = [survival.survival(tape, x) for x in xs]
    assert all(0.0 <= p <= 1.0 for p in ps)
    assert all(a >= b - 1e-9 for a, b in zip(ps, ps[1:]))


def test_survival_agrees_with_the_fair_price(tape):
    """P(reach m) = (1-h)/m. A 4000-round provable tape should land close."""
    for m in (2.0, 3.0, 5.0):
        fair = (1 - EDGE) / m
        got = survival.survival(tape, m)
        assert abs(got - fair) < 0.035, f"m={m}: {got} vs fair {fair}"


def test_hill_tail_index_of_a_fair_tape_is_near_one(tape):
    """The crash tail is Pareto with alpha = 1. This is the fairness fingerprint."""
    alpha = survival.hill_alpha(tape)["alpha"]
    assert 0.7 < alpha < 1.4, alpha


def test_empirical_survival_handles_an_empty_window():
    assert survival.empirical_survival([], 2.0) is None


# --- Randomness battery ---------------------------------------------------------

def test_battery_passes_a_genuinely_fair_tape(tape):
    out = randomness.full_battery(tape, house_edge=EDGE)
    assert out["overall"]["verdict"] == "consistent", out["overall"]
    assert out["overall"]["flagged"] == []


def test_battery_rejects_an_obviously_rigged_tape():
    """A tape with a hard ceiling cannot be a fair crash tape, and must be flagged."""
    rigged = [1.0 + (i % 7) * 0.1 for i in range(1500)]
    out = randomness.full_battery(rigged, house_edge=EDGE)
    assert out["overall"]["verdict"] in ("suspect", "reject")
    assert len(out["overall"]["flagged"]) > 0


def test_estimate_house_edge_recovers_the_generating_edge(tape):
    est = randomness.estimate_house_edge(tape)
    # Instant-crash rate is the direct read on the edge: P(crash <= 1) = h.
    assert abs(est["edge_from_instant_crashes"] - EDGE) < 0.02, est["edge_from_instant_crashes"]
    # And the tail exponent of a fair tape is 1, so it must not look significant.
    assert est["alpha_p_value"] > 0.01, est["alpha_p_value"]


def test_battery_does_not_crash_on_a_short_tape():
    randomness.full_battery([1.5, 2.0, 1.1], house_edge=EDGE)


# --- Expected value -------------------------------------------------------------

def test_probability_above_is_the_fair_price():
    for m in (2.0, 4.0, 10.0):
        assert abs(ev.probability_above(m, EDGE) - (1 - EDGE) / m) < 1e-12


def test_median_crash_identity():
    assert abs(ev.median_crash(EDGE) - 2 * (1 - EDGE)) < 1e-12


def test_ev_per_unit_staked_is_minus_the_edge_at_every_target():
    """The central claim of the EV page: no cash-out target escapes the edge."""
    rows = ev.ev_table(house_edge=EDGE)["rows"]
    assert rows
    for r in rows:
        assert abs(r["ev_per_unit"] - -EDGE) < 1e-9, r


def test_kelly_declines_to_bet_a_negative_edge():
    k = ev.kelly(2.0, EDGE)
    assert k["fraction"] <= 0.0
    assert k["fraction_clamped"] == 0.0


def test_ruin_simulation_never_reports_a_negative_bankroll():
    """A ruined path stops staking; percentiles below zero would be a bug."""
    r = ev.risk_of_ruin(1000, 20, 2.0, house_edge=EDGE, rounds=400, trials=800, seed=3)
    assert 0.0 <= r["risk_of_ruin"] <= 1.0
    for key in ("p05_final_bankroll", "median_final_bankroll", "mean_final_bankroll"):
        assert r[key] >= 0.0, (key, r[key])


def test_ruin_simulation_mean_tracks_the_analytic_expectation():
    rounds, stake = 400, 20
    r = ev.risk_of_ruin(100_000, stake, 2.0, house_edge=EDGE, rounds=rounds, trials=600, seed=5)
    analytic = 100_000 - EDGE * stake * rounds
    assert abs(r["mean_final_bankroll"] - analytic) < 0.05 * analytic


def test_risk_of_ruin_rejects_nonsense_input():
    assert "error" in ev.risk_of_ruin(0, 10, 2.0)
    assert "error" in ev.risk_of_ruin(100, 0, 2.0)
