"""Reality checks for the window-odds / exceedance / drought engine.

Every test here asserts a property that must hold for the maths to be honest,
not just that the code returns something.
"""
from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone

import pytest

from momento import windows


def fair_tape(n: int = 4000, house_edge: float = 0.03, seed: int = 7) -> list:
    """Inverse-CDF sample of a correct crash distribution: P(m >= x) = (1-h)/x."""
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        u = rng.random()
        # no rounding: two-decimal rounding would nudge low thresholds upward and
        # make the fixture itself fail the fairness check it is used to verify
        out.append(1.0 if u > (1 - house_edge) else (1 - house_edge) / max(u, 1e-9))
    return out


def stamped(multipliers, step_seconds: int = 20, start_hour: int = 0):
    base = datetime(2026, 3, 1, start_hour, tzinfo=timezone.utc)
    return [
        {"id": i + 1, "multiplier": m,
         "ts": (base + timedelta(seconds=i * step_seconds)).isoformat().replace("+00:00", "Z")}
        for i, m in enumerate(multipliers)
    ]


# --------------------------------------------------------------------- wilson

def test_wilson_brackets_the_point_estimate_and_narrows_with_n():
    lo, hi = windows.wilson(0.5, 100)
    assert lo < 0.5 < hi
    lo2, hi2 = windows.wilson(0.5, 10_000)
    assert (hi2 - lo2) < (hi - lo)


def test_wilson_stays_inside_zero_one_at_the_extremes():
    for n in (1, 10, 1000):
        for p in (0.0, 1.0):
            lo, hi = windows.wilson(p, n)
            assert 0.0 <= lo <= hi <= 1.0


def test_wilson_of_no_data_is_degenerate():
    assert windows.wilson(0.3, 0) == (0.0, 0.0)


# ----------------------------------------------------------------- wait times

def test_median_wait_matches_the_geometric_definition():
    for rate in (0.5, 0.1, 0.02, 0.001):
        w = windows.median_wait(rate)
        assert w is not None
        # at the median wait the chance of having seen a hit must have passed 50%
        assert 1 - (1 - rate) ** w >= 0.5
        assert 1 - (1 - rate) ** (w - 1) < 0.5 or w == 1


def test_percentile_wait_is_monotone_in_q():
    a = windows.median_wait(0.05)
    b = windows.percentile_wait(0.05, 0.9)
    c = windows.percentile_wait(0.05, 0.99)
    assert a is not None and b is not None and c is not None
    assert a < b < c


def test_waits_are_undefined_for_impossible_rates():
    assert windows.median_wait(0.0) is None
    assert windows.median_wait(1.0) is None
    assert windows.percentile_wait(0.1, 1.0) is None


# ------------------------------------------------------------ window maths

def test_window_probability_is_the_complement_of_never_hitting():
    assert windows.window_probability(0.1, 10) == pytest.approx(1 - 0.9 ** 10, abs=1e-9)
    assert windows.window_probability(0.5, 1) == pytest.approx(0.5, abs=1e-6)
    assert windows.window_probability(0.1, 0) == pytest.approx(0.0, abs=1e-9)


def test_window_probability_rises_with_exposure_and_never_reaches_one():
    prev = 0.0
    for n in (1, 10, 100, 1000):
        p = windows.window_probability(0.01, n)
        assert p > prev
        prev = p
    assert prev < 1.0


def test_current_run_counts_rounds_since_the_last_hit():
    assert windows.current_run([5.0, 1.2, 1.5, 1.1], 2.0) == 3
    assert windows.current_run([1.2, 1.5, 9.0], 2.0) == 0
    assert windows.current_run([1.1, 1.2], 2.0) == 2


# ------------------------------------------------------------- exceedance

def test_exceedance_grid_brackets_the_fair_rate_on_a_fair_tape():
    grid = windows.exceedance_grid(fair_tape(6000), 0.03)
    measurable = [r for r in grid["rows"] if r["hits"] >= 20]
    assert len(measurable) >= 5
    # nested thresholds share the same rounds, so their errors move together and a
    # single lucky tape can push one or two rows out. No row may be badly off.
    inside = sum(1 for r in measurable if r["insideInterval"])
    assert inside >= len(measurable) - 2
    assert all(abs(r["z"]) < 3.5 for r in measurable)


def test_exceedance_rates_are_monotone_decreasing_in_threshold():
    rows = windows.exceedance_grid(fair_tape(3000), 0.03)["rows"]
    rates = [r["rate"] for r in rows]
    assert rates == sorted(rates, reverse=True)


def test_exceedance_flags_a_rigged_tape():
    # a tape with the 2x rate halved must fail at 2x
    tape = fair_tape(4000)
    rigged = [1.1 if (m >= 2.0 and i % 2 == 0) else m for i, m in enumerate(tape)]
    row = next(r for r in windows.exceedance_grid(rigged, 0.03)["rows"] if r["threshold"] == 2.0)
    assert not row["insideInterval"]
    assert row["z"] < -3


def test_exceedance_fair_price_is_the_reciprocal_of_the_fair_rate():
    row = next(r for r in windows.exceedance_grid(fair_tape(1000), 0.03)["rows"] if r["threshold"] == 10.0)
    assert row["fairPrice"] == pytest.approx(10 / 0.97, abs=0.05)


# ---------------------------------------------------------------- droughts

def test_drought_probability_matches_the_geometric_tail():
    tape = fair_tape(3000)
    row = next(r for r in windows.droughts(tape)["rows"] if r["threshold"] == 10.0)
    if row["since"] > 0 and 0 < row["rate"] < 1:
        assert row["pAtLeastThisLong"] == pytest.approx((1 - row["rate"]) ** row["since"], abs=1e-3)


def test_longest_gap_is_at_least_the_current_gap():
    for row in windows.droughts(fair_tape(3000))["rows"]:
        assert row["longestGap"] >= row["since"]


def test_a_typical_gap_is_not_flagged_as_unusual():
    # tape ending immediately after a 10x: no drought at all
    tape = fair_tape(2000) + [12.0]
    row = next(r for r in windows.droughts(tape)["rows"] if r["threshold"] == 10.0)
    assert row["since"] == 0
    assert row["unusual"] is False


# ------------------------------------------------------------------ phases

def test_hour_phases_finds_no_time_effect_on_a_shuffled_fair_tape():
    rounds = stamped(fair_tape(4000), step_seconds=60)
    out = windows.hour_phases(rounds, 2.0)
    assert out["rounds"] == 4000
    assert out["pValue"] > 0.01
    assert out["significant"] is False


def test_hour_phases_detects_a_planted_time_effect():
    tape = fair_tape(4000)
    rounds = stamped(tape, step_seconds=60)
    for r in rounds:
        if int(r["ts"][11:13]) in (3, 4):
            r["multiplier"] = 9.0  # every round in those hours clears 2x
    out = windows.hour_phases(rounds, 2.0)
    assert out["significant"] is True
    assert out["best"]["rate"] > out["overallRate"]


def test_hour_phases_ignores_rounds_without_usable_timestamps():
    rounds = stamped(fair_tape(200), step_seconds=60)
    rounds += [{"id": 999, "multiplier": 3.0, "ts": None}]
    out = windows.hour_phases(rounds, 2.0)
    assert out["rounds"] == 200


# ------------------------------------------------------------------ cadence

def test_median_interval_is_measured_from_timestamps():
    out = windows.median_interval_ms(stamped(fair_tape(300), step_seconds=15))
    assert out["measured"] is True
    assert out["ms"] == pytest.approx(15_000, abs=1)


def test_median_interval_rejects_bunched_import_timestamps():
    """Rounds imported in one sitting sit milliseconds apart; that is not a cadence."""
    out = windows.median_interval_ms(stamped(fair_tape(300), step_seconds=0.05))
    assert out["measured"] is False
    assert out["ms"] == 20_000.0
    assert "bunched" in out["note"]


def test_phases_are_not_testable_within_a_single_hour():
    out = windows.hour_phases(stamped(fair_tape(100), step_seconds=1), 2.0)
    assert out["hoursCovered"] == 1
    assert out["testable"] is False
    assert out["significant"] is False
    assert "Not testable" in out["verdict"]


def test_median_interval_falls_back_when_timestamps_are_missing():
    out = windows.median_interval_ms([{"id": 1, "multiplier": 2.0, "ts": None}])
    assert out["measured"] is False
    assert out["ms"] == 20_000.0


# --------------------------------------------------------- earned skill

def test_no_component_earns_skill_on_a_fair_tape():
    s = windows.earned_skill(fair_tape(4000), 2.0)
    assert s["scored"] > 1000
    # on an i.i.d. tape nothing should beat the running base rate by any margin
    assert all(v < 0.01 for v in s["skill"].values())


def test_a_component_earns_skill_on_a_deterministic_alternating_tape():
    tape = [5.0 if i % 2 == 0 else 1.1 for i in range(1500)]
    s = windows.earned_skill(tape, 2.0)
    assert s["skill"]["markov"] > 0.5
    assert s["anySkill"] is True


def test_baseline_keeps_full_weight_when_nothing_has_skill():
    pr = windows.per_round_probability(fair_tape(3000), 2.0)
    weights = {c["model"]: c["weight"] for c in pr["components"]}
    assert weights["baseline"] == pytest.approx(1.0, abs=1e-6)
    assert pr["p"] == pytest.approx(pr["baseRate"], abs=1e-3)


def test_per_round_probability_reports_a_wilson_interval_around_the_base_rate():
    pr = windows.per_round_probability(fair_tape(3000), 2.0)
    assert pr["ciLow"] < pr["baseRate"] < pr["ciHigh"]


def test_per_round_probability_survives_an_empty_tape():
    pr = windows.per_round_probability([], 2.0)
    assert pr["p"] == 0.0 and pr["components"] == []


# ------------------------------------------------------------ window odds

def test_window_odds_are_monotone_in_window_length():
    tape = fair_tape(3000)
    out = windows.window_odds(tape, stamped(tape, step_seconds=20), 0.03)
    for t_index in range(len(out["windows"][0]["predictions"])):
        probs = [w["predictions"][t_index]["probability"] for w in out["windows"]]
        assert probs == sorted(probs)
    rounds_per_window = [w["expectedRounds"] for w in out["windows"]]
    assert rounds_per_window == sorted(rounds_per_window)


def test_window_odds_interval_brackets_the_point_estimate():
    tape = fair_tape(3000)
    out = windows.window_odds(tape, stamped(tape, step_seconds=20), 0.03)
    for w in out["windows"]:
        for p in w["predictions"]:
            assert p["ciLow"] <= p["probability"] <= p["ciHigh"]


def test_window_odds_match_the_fair_model_on_a_fair_tape():
    tape = fair_tape(6000)
    out = windows.window_odds(tape, stamped(tape, step_seconds=20), 0.03)
    hour = next(w for w in out["windows"] if w["id"] == "1h")
    for p in hour["predictions"]:
        if p["threshold"] <= 10:
            assert p["ciLow"] <= p["fairProbability"] <= p["ciHigh"]


def test_expected_rounds_follow_the_measured_cadence():
    tape = fair_tape(1000)
    fast = windows.window_odds(tape, stamped(tape, step_seconds=10), 0.03)
    slow = windows.window_odds(tape, stamped(tape, step_seconds=40), 0.03)
    fast_hour = next(w for w in fast["windows"] if w["id"] == "1h")["expectedRounds"]
    slow_hour = next(w for w in slow["windows"] if w["id"] == "1h")["expectedRounds"]
    assert fast_hour == pytest.approx(360, abs=2)
    assert slow_hour == pytest.approx(90, abs=2)


# ------------------------------------------------------------- leaderboard

def test_leaderboard_reports_no_skill_across_thresholds_on_a_fair_tape():
    out = windows.leaderboard(fair_tape(4000))
    assert len(out["rows"]) == 6
    assert out["withSkill"] <= 1  # multiple testing may hand one threshold a fluke


def test_leaderboard_handles_a_threshold_that_never_prints():
    out = windows.leaderboard([1.1] * 400, thresholds=(2.0,))
    row = out["rows"][0]
    assert row["scored"] is not None
    assert all(math.isfinite(v) for v in (row["skill"] or {}).values())
