"""
Expected value, staking and bankroll mathematics.

Closed-form facts this module encodes (see crashedge.com/guides/crash-gambling-maths):

    P(reach m)      = (1 - h) / m
    EV(stake s)     = -h * s          for every target m
    median crash    = 2 * (1 - h)
    expected loss   = rounds * stake * h        (turnover * edge)
    Kelly fraction  = edge / odds, which is <= 0 whenever h > 0

Because EV is target-independent and negative, the only levers a player
actually controls are turnover, variance and session limits. This module
computes all three honestly instead of pretending an edge exists.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

DEFAULT_EDGE = 0.03  # Spribe Aviator: 97% RTP

HOUSE_EDGE_PRESETS = [
    {"id": "aviator", "label": "Aviator / Spribe", "edge": 0.03, "rtp": 0.97},
    {"id": "stake", "label": "Stake Crash", "edge": 0.01, "rtp": 0.99},
    {"id": "bustabit", "label": "Bustabit (1/101)", "edge": 1 / 101, "rtp": 1 - 1 / 101},
    {"id": "jetx", "label": "JetX / SmartSoft", "edge": 0.03, "rtp": 0.97},
    {"id": "spaceman", "label": "Spaceman / Pragmatic", "edge": 0.038, "rtp": 0.962},
    {"id": "generic5", "label": "Generic 95% RTP", "edge": 0.05, "rtp": 0.95},
]


def probability_above(target: float, house_edge: float = DEFAULT_EDGE) -> float:
    if target <= 1.0:
        return 1.0
    return max(0.0, min(1.0, (1.0 - house_edge) / target))


def median_crash(house_edge: float = DEFAULT_EDGE) -> float:
    return 2.0 * (1.0 - house_edge)


def ev_table(
    targets: Optional[Sequence[float]] = None,
    stake: float = 1.0,
    house_edge: float = DEFAULT_EDGE,
) -> Dict[str, Any]:
    """The table that ends the argument: every target has identical EV."""
    targets = list(targets or [1.2, 1.3, 1.5, 1.75, 2.0, 2.5, 3.0, 5.0, 10.0, 25.0, 100.0])
    rows = []
    for t in targets:
        p = probability_above(t, house_edge)
        profit = (t - 1.0) * stake
        ev = p * profit - (1 - p) * stake
        # variance of per-round P&L
        var = p * (profit - ev) ** 2 + (1 - p) * (-stake - ev) ** 2
        rows.append({
            "target": t,
            "win_probability": p,
            "profit_if_win": profit,
            "ev": ev,
            "ev_per_unit": ev / stake if stake else 0.0,
            "std_dev": math.sqrt(max(0.0, var)),
            "median_rounds_between_wins": math.log(0.5) / math.log(1 - p) if 0 < p < 1 else None,
        })
    return {
        "house_edge": house_edge,
        "rtp": 1 - house_edge,
        "stake": stake,
        "median_crash_point": median_crash(house_edge),
        "rows": rows,
        "conclusion": (
            f"Every cash-out target returns the same expected value of {-house_edge * stake:.4f} "
            f"per {stake:g} staked. Choosing a target changes how the losses arrive, not how large "
            f"they are."
        ),
    }


def kelly(target: float, house_edge: float = DEFAULT_EDGE, model_probability: Optional[float] = None) -> Dict[str, Any]:
    """
    Kelly stake fraction. `model_probability` lets a forecast engine assert a
    probability higher than fair; the result is only positive if that assertion
    beats the fair price, which requires the game to be broken.
    """
    fair_p = probability_above(target, house_edge)
    p = fair_p if model_probability is None else max(0.0, min(1.0, model_probability))
    b = target - 1.0  # net odds
    if b <= 0:
        return {"fraction": 0.0, "edge": 0.0, "note": "target must exceed 1.0x"}
    edge = p * b - (1 - p)
    frac = edge / b
    return {
        "target": target,
        "fair_probability": fair_p,
        "model_probability": p,
        "net_odds": b,
        "edge": edge,
        "fraction": frac,
        "fraction_clamped": max(0.0, frac),
        "note": (
            "Kelly returns zero or negative — the mathematically optimal stake is nothing."
            if frac <= 0 else
            f"Positive only because the model claims {p:.4f} against a fair price of {fair_p:.4f}. "
            "Verify that claim out of sample before staking anything on it."
        ),
    }


def expected_loss(rounds: int, stake: float, house_edge: float = DEFAULT_EDGE) -> Dict[str, Any]:
    turnover = rounds * stake
    return {
        "rounds": rounds,
        "stake": stake,
        "turnover": turnover,
        "house_edge": house_edge,
        "expected_loss": turnover * house_edge,
        "expected_loss_pct_of_turnover": house_edge,
    }


def risk_of_ruin(
    bankroll: float,
    stake: float,
    target: float,
    house_edge: float = DEFAULT_EDGE,
    rounds: int = 500,
    trials: int = 4000,
    seed: int = 7,
) -> Dict[str, Any]:
    """Monte-Carlo ruin probability and bankroll distribution for a flat-stake plan."""
    if stake <= 0 or bankroll <= 0:
        return {"error": "bankroll and stake must be positive"}
    p = probability_above(target, house_edge)
    rng = np.random.default_rng(seed)
    wins = rng.random((trials, rounds)) < p
    pnl = np.where(wins, (target - 1.0) * stake, -stake)
    equity = bankroll + np.cumsum(pnl, axis=1)
    broke = equity <= 0
    ruined = np.any(broke, axis=1)
    # A ruined player stops: the naive cumulative sum keeps staking money the
    # path no longer has, which pushes the lower percentiles below zero and
    # understates ruin. Absorb the path at zero from its first-passage round on.
    first_passage = np.argmax(broke, axis=1)
    after_ruin = ruined[:, None] & (np.arange(rounds)[None, :] >= first_passage[:, None])
    equity = np.where(after_ruin, 0.0, equity)
    finals = equity[:, -1]
    troughs = np.min(equity, axis=1)
    ruin_round = np.full(trials, -1)
    ruin_round[ruined] = first_passage[ruined]
    return {
        "bankroll": bankroll,
        "stake": stake,
        "stake_pct": stake / bankroll,
        "target": target,
        "rounds": rounds,
        "trials": trials,
        "win_probability": p,
        "risk_of_ruin": float(np.mean(ruined)),
        "median_final_bankroll": float(np.median(finals)),
        "p05_final_bankroll": float(np.percentile(finals, 5)),
        "p95_final_bankroll": float(np.percentile(finals, 95)),
        "probability_in_profit": float(np.mean(finals > bankroll)),
        "median_max_drawdown_pct": float(np.median((bankroll - troughs) / bankroll)),
        "median_rounds_to_ruin": (
            float(np.median(ruin_round[ruined])) if ruined.any() else None
        ),
        "mean_final_bankroll": float(np.mean(finals)),
        "expected_final_bankroll": bankroll - rounds * stake * house_edge,
        "note": (
            "Expected bankroll declines linearly with turnover regardless of target. "
            "Lower stake percentages buy survival time, never profit. The analytic "
            "expectation assumes every round is played; the simulated mean is lower "
            "because ruined paths stop early, and both are below the starting bankroll."
        ),
    }


def martingale_analysis(
    bankroll: float,
    base_stake: float,
    target: float = 2.0,
    house_edge: float = DEFAULT_EDGE,
) -> Dict[str, Any]:
    """How many doublings a bankroll affords, and the probability of hitting that wall."""
    if base_stake <= 0 or bankroll <= 0:
        return {"error": "bankroll and stake must be positive"}
    p = probability_above(target, house_edge)
    q = 1 - p
    steps: List[Dict[str, Any]] = []
    spent = 0.0
    stake = base_stake
    n = 0
    while spent + stake <= bankroll and n < 40:
        spent += stake
        n += 1
        steps.append({"step": n, "stake": stake, "cumulative_risk": spent,
                      "probability_of_reaching": q ** (n - 1)})
        stake *= target / (target - 1.0)  # stake needed to recover all prior losses
    bust_p = q ** n
    return {
        "bankroll": bankroll,
        "base_stake": base_stake,
        "target": target,
        "max_steps": n,
        "steps": steps,
        "probability_of_busting_the_sequence": bust_p,
        "expected_sequences_before_bust": (1 / bust_p) if bust_p > 0 else None,
        "note": (
            f"The sequence survives {n} consecutive losses. A run of {n} losses happens with "
            f"probability {bust_p:.5f} — roughly once every {1 / bust_p:,.0f} sequences. When it "
            f"happens it costs {spent:,.2f}, which is every unit of recovery the sequence ever made. "
            "Martingale converts many small wins into one total loss; it does not change EV."
        ),
    }


def bankroll_plan(
    bankroll: float,
    session_loss_limit_pct: float = 0.15,
    max_risk_per_round_pct: float = 0.02,
    target: float = 2.0,
    house_edge: float = DEFAULT_EDGE,
) -> Dict[str, Any]:
    """A concrete, arithmetic session plan — the only genuinely useful output."""
    stake = bankroll * max_risk_per_round_pct
    budget = bankroll * session_loss_limit_pct
    p = probability_above(target, house_edge)
    exp_loss_per_round = stake * house_edge
    return {
        "bankroll": bankroll,
        "stake_per_round": stake,
        "session_loss_limit": budget,
        "target": target,
        "win_probability": p,
        "expected_loss_per_round": exp_loss_per_round,
        "expected_rounds_to_hit_loss_limit": budget / exp_loss_per_round if exp_loss_per_round else None,
        "rounds_of_pure_losing_streak_affordable": math.floor(budget / stake) if stake else 0,
        "probability_of_that_streak": (1 - p) ** math.floor(budget / stake) if stake else 0.0,
        "rules": [
            f"Flat stake of {stake:,.2f} — never size up after a loss.",
            f"Stop for the day at -{budget:,.2f}, no exceptions, no recovery attempts.",
            "Stop after any 3 consecutive losses and take a break before resuming.",
            "Set the auto-cash-out before the round starts; never decide mid-flight.",
            "Treat the session budget as an entertainment cost that is already spent.",
        ],
    }
