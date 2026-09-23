"""Momento forecast pipeline — states, ladders, DNA matching, ensemble candidates.

Port of MomentoV5 forecast.py / analysis.py: Markov state transitions,
ladder pressure & release conditions, DNA analogue matching, ranked candidates.
"""
from __future__ import annotations

import math
import statistics
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import math_models as mm
from . import survival as sv

STATES = ["Collapse", "Shelf", "Normal", "Ignition", "Moonshot"]

# Bands partition the multiplier line, so candidate probabilities sum to 1 and
# each one can be scored against what actually happened.
STATE_BOUNDS: Dict[str, Tuple[float, float]] = {
    "Collapse": (1.0, 2.0),
    "Shelf": (2.0, 3.0),
    "Normal": (3.0, 5.0),
    "Ignition": (5.0, 10.0),
    "Moonshot": (10.0, float("inf")),
}


# ---------------------------------------------------------------------------
# ladders & ceilings (analysis.py)
# ---------------------------------------------------------------------------

def detect_ladders(multipliers: Sequence[float], min_length: int = 4) -> List[Dict[str, Any]]:
    ladders: List[Dict[str, Any]] = []
    run, direction = 1, None  # 'asc' | 'desc'
    for i in range(1, len(multipliers)):
        step = multipliers[i] - multipliers[i - 1]
        d = "asc" if step > 0 else "desc" if step < 0 else None
        if d and d == direction:
            run += 1
        else:
            run, direction = 1, d
        if run >= min_length and direction:
            ladders.append({
                "start": i - run + 1, "length": run,
                "direction": "ascending" if direction == "asc" else "collapsing",
            })
            run, direction = 1, None
    return ladders


def detect_ceilings(multipliers: Sequence[float], bin_size: float = 0.25) -> List[float]:
    if len(multipliers) < 20:
        return []
    s = sorted(multipliers)
    top = mm.quantile(s, 0.85)
    buckets: Dict[float, int] = {}
    for m in multipliers:
        if top * 0.6 <= m <= top * 1.6:
            key = round(m / bin_size) * bin_size
            buckets[key] = buckets.get(key, 0) + 1
    hits = sorted(((v, k) for k, v in buckets.items() if v >= 3), reverse=True)
    return [k for _, k in hits[:3]]


# ---------------------------------------------------------------------------
# state machine (analysis.py classify_state)
# ---------------------------------------------------------------------------

def classify_state(window: Sequence[float]) -> str:
    if len(window) < 5:
        return "Normal"
    w = list(window)
    p50 = mm.quantile(sorted(w), 0.5)
    last = w[-1]
    recent = w[-5:]
    recent_mean = mm.mean(recent)
    vol = mm.stdev(w) / max(1.0, p50)
    ladders = detect_ladders(w, 4)
    asc = sum(1 for l in ladders if l["direction"] == "ascending")
    col = sum(1 for l in ladders if l["direction"] == "collapsing")

    if last >= 10:
        return "Moonshot"
    if recent_mean > p50 * 1.6 or (asc >= 1 and vol > 0.5):
        return "Ignition"
    if col >= 2 and recent_mean < p50:
        return "Collapse"
    if abs(recent_mean - p50) < p50 * 0.12 and vol < 0.35:
        return "Shelf"
    return "Normal"


def state_sequence(multipliers: Sequence[float]) -> List[str]:
    labels: List[str] = []
    for i in range(len(multipliers)):
        labels.append(classify_state(multipliers[: i + 1]))
    return labels


def transition_matrix(labels: Sequence[str]) -> Dict[str, Dict[str, float]]:
    counts = {a: {b: 0.0 for b in STATES} for a in STATES}
    for cur, nxt in zip(labels, labels[1:]):
        if cur in counts and nxt in counts[cur]:
            counts[cur][nxt] += 1.0
    matrix: Dict[str, Dict[str, float]] = {}
    for state, row in counts.items():
        total = sum(row.values())
        if total == 0:
            matrix[state] = {b: round(1 / len(STATES), 4) for b in STATES}
            continue
        smoothed = {b: row[b] + 0.5 for b in STATES}  # Laplace smoothing (forecast.py)
        st = sum(smoothed.values())
        matrix[state] = {b: round(smoothed[b] / st, 4) for b in STATES}
    return matrix


# ---------------------------------------------------------------------------
# ladder pressure & ETA adjustment (forecast.py ladder_eta_adjustment)
# ---------------------------------------------------------------------------

def ladder_eta(multipliers: Sequence[float]) -> Dict[str, Any]:
    if len(multipliers) < 10:
        return {"pressure_score": 0.0, "eta_adjustment": 0.0, "compression_release": False,
                "nearest_ceiling": None, "moonshot_probability": 0.15}
    ladders = detect_ladders(multipliers, 4)
    ceilings = detect_ceilings(multipliers)
    last = multipliers[-1]
    above = [c for c in ceilings if c > last]
    nearest = min(above) if above else last + 3 if ceilings else None

    lookback = multipliers[-30:]
    since_high = len(lookback)
    for i in range(len(lookback) - 1, -1, -1):
        if lookback[i] >= 5:
            since_high = len(lookback) - i
            break
    pressure = mm.clamp(since_high / 30, 0.0, 1.0)
    longest = max((l["length"] for l in ladders), default=0)
    release = nearest is not None and pressure > 0.6
    eta_adj = -pressure * 5 - longest * 0.3 + (-2 if release else 0)
    moon_p = mm.clamp(0.05 + pressure * 0.55 + (0.15 if release else 0), 0.0, 0.95)
    return {"pressure_score": pressure, "eta_adjustment": eta_adj, "compression_release": release,
            "nearest_ceiling": nearest, "moonshot_probability": moon_p}


# ---------------------------------------------------------------------------
# DNA — analogue tape matching
# ---------------------------------------------------------------------------

def _znorm(xs: Sequence[float]) -> List[float]:
    m, s = mm.mean(xs), mm.stdev(xs) or 1.0
    return [(x - m) / s for x in xs]


def _dist(a: Sequence[float], b: Sequence[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def dna_match(multipliers: Sequence[float], pattern_len: int = 8, top_k: int = 6) -> Dict[str, Any]:
    if len(multipliers) < pattern_len * 4:
        return {"confidence": 0.0, "matches": [],
                "outcomes": {"mean": 0.0, "p25": 0.0, "p75": 0.0, "p_next_moon_rate": 0.0}}
    pattern = _znorm(multipliers[-pattern_len:])
    scored = []
    for i in range(len(multipliers) - pattern_len - 3 + 1):
        cand = _znorm(multipliers[i:i + pattern_len])
        scored.append((i, _dist(cand, pattern)))
    scored.sort(key=lambda p: p[1])
    best = scored[:top_k]
    afters, moon_hits = [], 0
    for idx, _ in best:
        after = multipliers[idx + pattern_len]
        nxt3 = multipliers[idx + pattern_len: idx + pattern_len + 3]
        afters.append(after)
        if max([after, *nxt3]) >= 10:
            moon_hits += 1
    conf = mm.clamp(1 - best[0][1] / 2, 0.05, 1.0) * mm.clamp(len(afters) / top_k, 0.0, 1.0)
    sa = sorted(afters)
    return {"confidence": conf, "matches": [i for i, _ in best],
            "outcomes": {"mean": mm.mean(afters), "p25": mm.quantile(sa, 0.25),
                         "p75": mm.quantile(sa, 0.75),
                         "p_next_moon_rate": moon_hits / (len(afters) or 1)}}


# ---------------------------------------------------------------------------
# full analysis + candidates (forecast.py candidates)
# ---------------------------------------------------------------------------

def analyze(multipliers: Sequence[float]) -> Dict[str, Any]:
    s = sorted(multipliers)
    states = state_sequence(multipliers)
    return {
        "state": states[-1] if states else "Normal",
        "percentiles": {f"p{q}": round(mm.quantile(s, q / 100), 4) for q in (10, 25, 50, 75, 90, 95)},
        "markov": mm.markov_streaks(multipliers).__dict__,
        "state_matrix": transition_matrix(states[-300:]),
        "clusters": [c.__dict__ for c in mm.cluster_log(multipliers[-500:])],
        "regimes": {"current": (r := mm.detect_regimes(multipliers)).current,
                    "stay_probability": r.stay_probability,
                    "distribution": r.distribution,
                    "transition_detected": r.transition_detected},
        "pareto": mm.pareto_fit(multipliers).__dict__,
        "exponential": {"lambda": mm.exponential_fit(multipliers).lam,
                        "expected": mm.exponential_fit(multipliers).expected},
        "eta": {k: v for k, v in mm.eta_estimate(multipliers).__dict__.items() if k != "survival_at"},
        "ladder": ladder_eta(multipliers),
        "dna": dna_match(multipliers),
        "shape_distribution": mm.curve_shape_distribution(multipliers),
    }


def _band_for(state: str, _p: Optional[Dict[str, float]] = None) -> Tuple[float, float]:
    return STATE_BOUNDS.get(state, (1.0, 2.0))


def candidates(multipliers: Sequence[float], payload: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    if len(multipliers) < 8:
        return []
    a = payload or analyze(multipliers)
    row = a["state_matrix"][a["state"]]
    dna_w = mm.clamp(a["dna"]["confidence"] * 0.35, 0.0, 0.35)
    overdue = mm.clamp(a["ladder"]["pressure_score"] * 0.2, 0.0, 0.2)
    ladder_tilt = (mm.clamp((a["ladder"]["moonshot_probability"] - 0.6) * 0.5, 0.0, 0.25)
                   if a["ladder"]["moonshot_probability"] > 0.6 else 0.0)
    moon_rate = a["dna"]["outcomes"]["p_next_moon_rate"]

    raw: List[Tuple[str, float, List[str]]] = []
    for st in STATES:
        p, drivers = row[st], [f"Markov {a['state']}→{st}: {row[st]}"]
        if st in ("Moonshot", "Ignition"):
            tilt = overdue + ladder_tilt + moon_rate * dna_w
            p += tilt
            if overdue > 0.05:
                drivers.append(f"Ladder pressure +{round(overdue, 3)}")
            if ladder_tilt > 0:
                drivers.append(f"Release pattern +{round(ladder_tilt, 3)}")
            if moon_rate > 0.2:
                drivers.append(f"DNA analogue moon-rate {round(moon_rate, 3)}")
        if st == "Collapse" and a["regimes"]["current"] == "high_vol":
            p += 0.06
            drivers.append("High-vol regime")
        raw.append((st, p, drivers))

    # Signal score: the Markov / ladder / DNA tilt, normalised. This is what the
    # pattern engines *believe*. It is reported separately from the calibrated
    # probability so the two can be compared on the Accuracy page.
    total = sum(max(0.0, p) for _, p, _ in raw) or 1.0
    window = list(multipliers[-600:])
    tail = sv.hill_alpha(window)

    out = []
    for st, p, drivers in raw:
        lo, hi = _band_for(st)
        calibrated = sv.band_probability(window, lo, hi, tail)
        signal = max(0.0, p) / total
        out.append({
            "state": st,
            "probability": calibrated,
            "signalScore": signal,
            "tilt": signal - calibrated,
            "range": [lo, None if hi == float("inf") else hi],
            "drivers": drivers,
        })
    norm = sum(c["probability"] for c in out) or 1.0
    for c in out:
        c["probability"] = c["probability"] / norm
    return sorted(out, key=lambda c: c["probability"], reverse=True)


def probability_above(multipliers: Sequence[float], threshold: float) -> float:
    """Calibrated P(next round reaches threshold) from the observed tape."""
    return sv.survival(list(multipliers[-600:]), threshold)


def survival_curve(multipliers: Sequence[float], maximum: float = 20.0, steps: int = 60,
                   house_edge: float = 0.03) -> List[Dict[str, float]]:
    """P(next round survives past x), empirical bulk with a Hill-estimated Pareto tail."""
    return sv.curve(list(multipliers[-600:]), maximum, steps, house_edge)
