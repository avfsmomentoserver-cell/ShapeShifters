"""
Walk-forward evaluation, calibration and paper-trading strategies.

Every function here is strictly causal: at index i only multipliers[:i] are
visible. That is the only way a backtest means anything.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from . import ev
from . import survival as sv

STATES = ["Collapse", "Shelf", "Normal", "Ignition", "Moonshot"]
STATE_BOUNDS = {
    "Collapse": (1.0, 2.0), "Shelf": (2.0, 3.0), "Normal": (3.0, 5.0),
    "Ignition": (5.0, 10.0), "Moonshot": (10.0, float("inf")),
}


def realized_state(m: float) -> str:
    if m >= 10:
        return "Moonshot"
    if m >= 5:
        return "Ignition"
    if m >= 3:
        return "Normal"
    if m >= 2:
        return "Shelf"
    return "Collapse"


def _blended_survival(window: Sequence[float], x: float) -> float:
    """Calibrated P(next >= x): empirical bulk, Hill-estimated Pareto tail."""
    return sv.survival(window, x)


# ---------------------------------------------------------------------------
# calibration — are the stated probabilities honest?
# ---------------------------------------------------------------------------

def calibration(
    multipliers: Sequence[float],
    threshold: float = 2.0,
    warmup: int = 120,
    bins: int = 10,
    house_edge: float = ev.DEFAULT_EDGE,
) -> Dict[str, Any]:
    """
    Reliability diagram. For each round the engine states P(next >= threshold)
    using only prior data; predictions are bucketed and compared to what
    actually happened. A well-calibrated-but-edgeless engine produces a
    diagonal that sits on the fair price, not above it.
    """
    xs = list(multipliers)
    n = len(xs)
    if n < warmup + 40:
        return {"error": f"need >= {warmup + 40} rounds", "rounds": n}

    preds: List[float] = []
    outcomes: List[int] = []
    for i in range(warmup, n):
        window = xs[max(0, i - 400):i]
        p = _blended_survival(window, threshold)
        preds.append(p)
        outcomes.append(1 if xs[i] >= threshold else 0)

    pa = np.asarray(preds)
    oa = np.asarray(outcomes, dtype=float)
    brier = float(np.mean((pa - oa) ** 2))
    base = float(oa.mean())
    brier_base = float(np.mean((base - oa) ** 2))
    skill = 1 - brier / brier_base if brier_base > 0 else 0.0
    fair = ev.probability_above(threshold, house_edge)

    buckets: List[Dict[str, Any]] = []
    edges = np.linspace(pa.min(), pa.max() + 1e-9, bins + 1)
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (pa >= lo) & (pa < hi)
        if mask.sum() < 5:
            continue
        buckets.append({
            "predictedLow": float(lo), "predictedHigh": float(hi),
            "predictedMean": float(pa[mask].mean()),
            "observedRate": float(oa[mask].mean()),
            "samples": int(mask.sum()),
        })

    # log-loss vs a constant fair-price forecaster
    eps = 1e-9
    ll_model = float(-np.mean(oa * np.log(pa + eps) + (1 - oa) * np.log(1 - pa + eps)))
    ll_fair = float(-np.mean(oa * math.log(fair + eps) + (1 - oa) * math.log(1 - fair + eps)))

    return {
        "threshold": threshold,
        "scored": len(preds),
        "brierScore": brier,
        "brierBaseline": brier_base,
        "brierSkillScore": skill,
        "logLossModel": ll_model,
        "logLossFairPrice": ll_fair,
        "beatsFairPrice": ll_model < ll_fair,
        "observedHitRate": base,
        "fairHitRate": fair,
        "meanPrediction": float(pa.mean()),
        "buckets": buckets,
        "verdict": (
            "The engine is well calibrated but carries no skill over the fair price — exactly what "
            "an unbeatable game produces."
            if skill <= 0.01 else
            f"Brier skill score {skill:.4f} above the base rate. Re-run on a different tape before "
            "believing it; walk-forward skill this small is usually sampling noise."
        ),
    }


# ---------------------------------------------------------------------------
# backtest — flat, Kelly-fraction and threshold strategies
# ---------------------------------------------------------------------------

def backtest(
    multipliers: Sequence[float],
    target: float = 2.0,
    start_bankroll: float = 1000.0,
    staking: str = "flat",           # flat | kelly | percent | martingale
    stake: float = 10.0,
    kelly_fraction: float = 0.25,
    min_edge: float = 0.02,
    warmup: int = 120,
    house_edge: float = ev.DEFAULT_EDGE,
) -> Dict[str, Any]:
    xs = list(multipliers)
    n = len(xs)
    if n < warmup + 40:
        return {"error": f"need >= {warmup + 40} rounds", "rounds": n}

    bankroll = start_bankroll
    peak = bankroll
    equity: List[Dict[str, float]] = [{"i": warmup, "bankroll": bankroll}]
    bets = hits = 0
    staked_total = 0.0
    max_dd = 0.0
    loss_run = longest_loss_run = 0
    fair = ev.probability_above(target, house_edge)
    martingale_stake = stake
    skipped_no_edge = 0

    for i in range(warmup, n):
        window = xs[max(0, i - 400):i]
        p_model = _blended_survival(window, target)
        edge = p_model * (target - 1.0) - (1 - p_model)

        if staking == "kelly":
            frac = max(0.0, edge / (target - 1.0)) * kelly_fraction
            size = bankroll * frac
            if edge < min_edge:
                size = 0.0
        elif staking == "percent":
            size = bankroll * (stake / 100.0)
        elif staking == "martingale":
            size = martingale_stake
        else:
            size = stake
            if edge < min_edge:
                size = 0.0

        if size <= 0 or size > bankroll:
            if size > 0:
                size = bankroll
            else:
                skipped_no_edge += 1
                equity.append({"i": i, "bankroll": bankroll})
                continue

        won = xs[i] >= target
        pnl = (target - 1.0) * size if won else -size
        bankroll += pnl
        bets += 1
        staked_total += size
        hits += int(won)
        if won:
            loss_run = 0
            martingale_stake = stake
        else:
            loss_run += 1
            longest_loss_run = max(longest_loss_run, loss_run)
            martingale_stake = min(martingale_stake * target / (target - 1.0), max(0.0, bankroll))
        peak = max(peak, bankroll)
        max_dd = max(max_dd, (peak - bankroll) / peak if peak > 0 else 0.0)
        equity.append({"i": i, "bankroll": bankroll})
        if bankroll <= 0:
            break

    # thin the equity curve for transport
    step = max(1, len(equity) // 600)
    return {
        "config": {"target": target, "staking": staking, "stake": stake,
                   "kellyFraction": kelly_fraction, "minEdge": min_edge,
                   "startBankroll": start_bankroll, "warmup": warmup, "houseEdge": house_edge},
        "rounds": n,
        "roundsScored": n - warmup,
        "bets": bets,
        "skippedNoEdge": skipped_no_edge,
        "hits": hits,
        "hitRate": hits / bets if bets else 0.0,
        "fairHitRate": fair,
        "finalBankroll": bankroll,
        "roi": (bankroll - start_bankroll) / start_bankroll,
        "turnover": staked_total,
        "avgStake": staked_total / bets if bets else 0.0,
        "maxDrawdown": max_dd,
        "longestLossRun": longest_loss_run,
        "busted": bankroll <= 0,
        "expectedLossFromEdge": staked_total * house_edge,
        "actualPnl": bankroll - start_bankroll,
        "equity": equity[::step],
        "verdict": (
            f"Turnover of {staked_total:,.0f} at a {house_edge:.1%} edge has an expected cost of "
            f"{staked_total * house_edge:,.0f}. This run landed at {bankroll - start_bankroll:+,.0f}, "
            f"which is that expectation plus variance. No staking scheme changes the first number."
        ),
    }


def strategy_grid(
    multipliers: Sequence[float],
    targets: Optional[Sequence[float]] = None,
    stakings: Optional[Sequence[str]] = None,
    start_bankroll: float = 1000.0,
    house_edge: float = ev.DEFAULT_EDGE,
) -> Dict[str, Any]:
    """Sweep the strategy space so the flatness of the result is visible at a glance."""
    targets = list(targets or [1.5, 2.0, 3.0, 5.0, 10.0])
    stakings = list(stakings or ["flat", "percent", "kelly", "martingale"])
    rows: List[Dict[str, Any]] = []
    for t in targets:
        for s in stakings:
            r = backtest(multipliers, target=t, staking=s, start_bankroll=start_bankroll,
                         house_edge=house_edge, min_edge=0.0 if s != "flat" else 0.0)
            if "error" in r:
                return r
            rows.append({"target": t, "staking": s, "roi": r["roi"], "bets": r["bets"],
                         "hitRate": r["hitRate"], "maxDrawdown": r["maxDrawdown"],
                         "busted": r["busted"], "turnover": r["turnover"],
                         "finalBankroll": r["finalBankroll"]})
    rois = [r["roi"] for r in rows]
    return {
        "rows": rows,
        "bestByRoi": max(rows, key=lambda r: r["roi"]),
        "worstByRoi": min(rows, key=lambda r: r["roi"]),
        "meanRoi": sum(rois) / len(rois),
        "bustedCount": sum(1 for r in rows if r["busted"]),
        "verdict": (
            "The spread across this grid is variance, not skill. The mean ROI tracks the house edge "
            "times turnover; the winner of any single grid is the luckiest cell, not the best strategy."
        ),
    }


# ---------------------------------------------------------------------------
# live signal context (feeds alerts + the dashboard strip)
# ---------------------------------------------------------------------------

def live_context(multipliers: Sequence[float], house_edge: float = ev.DEFAULT_EDGE) -> Dict[str, Any]:
    xs = list(multipliers)
    if len(xs) < 10:
        return {"rounds": len(xs)}
    dry = 0
    for m in reversed(xs):
        if m < 2.0:
            dry += 1
        else:
            break
    dry10 = 0
    for m in reversed(xs):
        if m < 10.0:
            dry10 += 1
        else:
            break
    tail = xs[-50:]
    fair2 = ev.probability_above(2.0, house_edge)
    # "pressure": how far the recent 2x hit rate sits below the fair rate, scaled 0-1.
    recent_rate = sum(1 for m in tail if m >= 2.0) / len(tail)
    pressure = max(0.0, min(1.0, (fair2 - recent_rate) / max(1e-6, fair2) + dry / 25.0))
    return {
        "rounds": len(xs),
        "last": xs[-1],
        "dryStreak": dry,
        "dryStreak10x": dry10,
        "recentHitRate2x": recent_rate,
        "fairHitRate2x": fair2,
        "pressure": pressure,
        "meanLast50": float(np.mean(tail)),
        "medianLast50": float(np.median(tail)),
        "maxLast50": float(np.max(tail)),
        "volatility": float(np.std(np.log(np.maximum(1.0, tail)))),
        "expectedDryStreakLength": 1 / fair2 if fair2 else None,
        "dryStreakProbability": (1 - fair2) ** dry,
        "gamblersFallacyWarning": (
            f"A {dry}-round dry spell under 2× has probability {(1 - fair2) ** dry:.4f} of occurring "
            f"from any starting point. It does not raise the chance that the next round clears 2× — "
            f"that stays at {fair2:.2%}."
        ) if dry >= 5 else None,
    }
