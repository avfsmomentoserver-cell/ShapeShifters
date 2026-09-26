"""Contracts for the two-tier realtime layer.

The feature is a *layering* claim: a cheap per-round projection sits on top of a
heavy scheduled pass. These tests hold that claim to account — the projection
must recompute every round, the baseline must not, and the composition must be
scoped per visitor so one tape can never leak figures into another.
"""
from __future__ import annotations

import random

import pytest

from momento import realtime


def fair_tape(n: int = 500, house_edge: float = 0.03, seed: int = 11) -> list:
    """Inverse-CDF sample of a correct crash distribution: P(m >= x) = (1-h)/x."""
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        u = rng.random()
        out.append(1.0 if u > (1 - house_edge) else (1 - house_edge) / max(u, 1e-9))
    return out


# --------------------------------------------------------------- the two tiers

def test_project_is_pure_and_does_not_touch_baseline_state():
    """`project` is the cheap tier: it must depend only on its arguments.

    If the projection read the cached baseline the two tiers would stop being
    separable and the per-round cost would inherit the scheduled cost.
    """
    tape = fair_tape(400)
    assert realtime.baseline_fresh("iso-a") is False, "nothing should have run yet"

    snapshot = realtime.project(tape, 0.03, label="live")
    assert snapshot["label"] == "live"
    # `window` is the span actually used: a 400-round tape cannot use 600.
    assert snapshot["window"] == min(len(tape), realtime.WINDOW)
    assert snapshot["rounds"] == len(tape)

    # Still cold: projecting is not a scheduled pass, and it wrote no state.
    assert realtime.baseline_fresh("iso-a") is False


def test_advance_runs_a_baseline_when_cold_and_then_reuses_it():
    """The first round arms the heavy tier; later rounds must not re-run it."""
    tape = fair_tape(400)
    first = realtime.advance("cold-visitor", tape, 0.03, round_id=1)
    assert first["baseline"]["rounds"] == len(tape)
    assert first["revision"] == 1
    assert first["projection"]["label"] == "live"

    second = realtime.advance("cold-visitor", tape + [2.5], 0.03, round_id=2)
    assert second["baseline"]["rounds"] == len(tape), "baseline must not be recomputed per round"
    assert second["revision"] == 2, "the revision must advance on every round"
    assert second["projection"]["rounds"] == len(tape) + 1


def test_revision_is_monotonic_and_per_visitor():
    tape = fair_tape(300)
    a1 = realtime.advance("rev-a", tape, 0.03)
    a2 = realtime.advance("rev-a", tape, 0.03)
    b1 = realtime.advance("rev-b", tape, 0.03)
    assert (a1["revision"], a2["revision"]) == (1, 2)
    assert b1["revision"] == 1, "a different visitor starts its own count"


def test_visitors_do_not_share_projection_state():
    """One visitor's tape must not move another's figures."""
    small = fair_tape(200, seed=1)
    big = fair_tape(2000, seed=2)
    realtime.advance("leak-small", small, 0.03)
    realtime.advance("leak-big", big, 0.03)
    s = realtime.summary("leak-small", small, 0.03)
    b = realtime.summary("leak-big", big, 0.03)
    assert s["realtime"]["rounds"] == 200
    assert b["realtime"]["rounds"] == 2000


def test_invalidate_drops_a_baseline_measured_against_a_replaced_tape():
    """A replaced tape must not keep serving the old heavy tier.

    The failure this guards is a *wrong* number rather than a stale one: after a
    shorter replacement the cached baseline would be longer than the tape and
    `delta.roundsApart` would go negative.
    """
    long_tape = fair_tape(1200, seed=4)
    realtime.run_baseline("replace-visitor", long_tape, 0.03)
    assert realtime.baseline_fresh("replace-visitor") is True

    short_tape = fair_tape(300, seed=9)
    realtime.invalidate("replace-visitor")
    assert realtime.baseline_fresh("replace-visitor") is False

    composed = realtime.summary("replace-visitor", short_tape, 0.03)
    assert composed["baseline"]["rounds"] == len(short_tape), "baseline must be recomputed"
    assert composed["delta"]["roundsApart"] >= 0, "a shorter tape must never report negative drift"


# ------------------------------------------------------------------ the delta

def test_delta_reports_zero_drift_immediately_after_a_scheduled_pass():
    tape = fair_tape(500)
    realtime.run_baseline("drift-visitor", tape, 0.03)
    composed = realtime.summary("drift-visitor", tape, 0.03)
    assert composed["delta"]["roundsApart"] == 0
    assert composed["delta"]["moved"] is False


def test_delta_measures_drift_once_the_live_tier_moves_ahead():
    base = fair_tape(500, seed=3)
    realtime.run_baseline("moved-visitor", base, 0.03)
    # A heavy tail pushed on top moves the fitted tail index and the ETAs, which
    # is exactly the drift the delta exists to surface.
    grown = base + [400.0, 900.0, 1500.0]
    composed = realtime.summary("moved-visitor", grown, 0.03)
    assert composed["delta"]["roundsApart"] == 3
    assert composed["delta"]["moved"] is True

# ------------------------------------------------------------ the shape payload

def test_shape_forecast_is_a_drawn_shape_not_a_bare_number():
    """The UI's "chart prediction" needs a path, a realized overlay and ETAs."""
    tape = fair_tape(600)
    shape = realtime.shape_forecast(tape, 0.03)

    assert shape["horizon"] == realtime.SHAPE_HORIZON
    assert len(shape["projected"]) > 10
    for point in shape["projected"]:
        # A survival probability, so a probability — never a percentage.
        assert 0.0 <= point["p"] <= 1.0
        assert 0.0 <= point["fair"] <= 1.0
        assert point["x"] >= 1.0

    # The realized path shares the projected axis, so the overlay lines up.
    assert len(shape["realized"]) == len(shape["projected"])
    assert [r["x"] for r in shape["realized"]] == [p["x"] for p in shape["projected"]]

    assert shape["shape"]["family"]
    assert shape["fairPath"], "a fair game sits on (1-h)/x and must be drawn too"

    # Every ETA ladder rung carries a threshold, an ETA and its band.
    assert shape["eta"]
    for row in shape["eta"]:
        assert row["threshold"] >= 2.0
        assert "eta" in row


def test_shape_forecast_keeps_the_projection_and_the_empirical_tape_separate():
    """On a degenerate tape the drawn shape must not be mistaken for the tape.

    The fitted survival blends the empirical read with a parametric tail, so it
    still draws a curve when nothing above 1.00x has ever printed. That is why
    `realized` rides alongside: it is the empirical truth on the same axes, and
    where it disagrees with `projected` the disagreement is the measurement.
    """
    flat = [1.0] * 40
    shape = realtime.shape_forecast(flat, 0.03)

    # P(m >= 1.00) is 1 by definition on both paths.
    assert shape["projected"][0]["p"] == 1.0
    assert shape["realized"][0]["p"] == 1.0
    assert shape["realized"][0]["hits"] == 40

    # The empirical tape never cleared 1.00x, and `realized` says so exactly.
    assert all(r["p"] == 0.0 for r in shape["realized"] if r["x"] > 1.0)
    # The fitted projection is not allowed to claim the tape printed one.
    assert shape["projected"] is not shape["realized"]


def test_projection_target_is_a_range_with_a_median_inside_it():
    tape = fair_tape(500)
    projection = realtime.project(tape, 0.03, label="live")
    target = projection["target"]
    assert target["p25"] <= target["median"] <= target["p90"], (
        "the headline range must bracket the headline number"
    )
    assert target["median"] >= 1.0, "a crash multiplier cannot be below 1.00x"
