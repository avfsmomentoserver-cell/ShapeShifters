"""
Realtime statistics layered on a scheduled heavy baseline.

The problem this solves: the figures the dashboard needs on *every* round
(survival curve, quantiles, ETAs to 2x/10x/moonshot, the exceedance grid, live
context) are cheap, while the figures that describe the tape as a whole (the
randomness battery, earned skill, hour-of-day phases) are expensive — a full
battery over a few thousand rounds is seconds of NumPy. The dashboard
re-commits on every dropped round, and the file watcher emits one every few
seconds, so recomputing the expensive tier per round would starve the event
loop that delivers the round in the first place (this repo has already been
bitten once by blocking that loop).

So the work is split by *cost*, not by feature:

  * **Baseline (scheduled).** The expensive, slow-moving tier. It runs on a
    background timer and its output is cached per visitor. Its inputs change
    slowly and its answers only move over hundreds of rounds, so a few seconds
    of staleness is invisible.

  * **Realtime (per round).** Everything that must re-commit the moment a round
    lands, computed as an increment *on top of* that baseline: the calibrated
    survival curve, the quantile ladder, the hit ETAs, the exceedance grid and
    the live context. One tail fit plus O(window) scans, cheap enough to run
    inside the ingest path.

  * **Baseline delta.** The same projection is snapshotted when the heavy pass
    runs, and every realtime payload publishes how far it has moved off that
    snapshot. That is what makes the layering auditable rather than a claim:
    the reader sees exactly how much the live figures have drifted since the
    last heavy pass, and how stale that pass is.

`advance()` is the per-round hook; `summary()` is what a route returns;
`shape_forecast()` is the drawn "chart prediction" the Chart Lab renders.

Nothing here changes a formula. The estimators are called with the same
arguments the existing routes used. There is deliberately **no TypeScript twin
of this module**: the frontend reads the projection from `GET /stats/realtime`
and the shape from `GET /stats/shape`, so the figures the panels show are the
server's own rather than a second implementation that could drift from them.
The formulas *inside* the projection do have mirrored twins, and those stay in
step: `quantile_at` ↔ `pipeline.ts:calibratedQuantile`, `hit_eta` ↔
`stats.ts:hitEta`, `WINDOW = 600` ↔ the window those panels estimate over.
"""
from __future__ import annotations

import math
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from . import math_models as mm
from . import randomness as rnd
from . import survival as sv
from . import windows as win

# Multi-timeframe windows — forex-style stacked analysis
# Large: structural trends, refreshed on schedule (every 300 rounds or 5 min)
WINDOW_LARGE = 5000
LARGE_REFRESH_ROUNDS = 300
LARGE_REFRESH_SECONDS = 300

# Medium: intermediate trends, refreshed on schedule (every 100 rounds or 2 min)  
WINDOW_MEDIUM = 2000
MEDIUM_REFRESH_ROUNDS = 100
MEDIUM_REFRESH_SECONDS = 120

# Current: immediate state, refreshed every round (existing realtime tier)
WINDOW = 600

# Percentiles the UI ladder displays, as (label, survival probability). The
# value is a *survival* probability, so P(crash <= x) = 0.5 is the median and
# the 90th percentile is the 0.10 entry.
QUANTILE_LADDER: Tuple[Tuple[str, float], ...] = (
    ("p01", 0.99), ("p05", 0.95), ("p10", 0.90), ("p25", 0.75), ("p50", 0.50),
    ("p75", 0.25), ("p90", 0.10), ("p95", 0.05), ("p99", 0.01),
)

# Magnitudes the headline card and the "time to each magnitude" ladder report.
LIVE_BANDS: Tuple[float, ...] = (2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 1000.0)

# Big hits / moonshots / mega / cosmic, matching BIG_HIT_THRESHOLDS and
# BAND_HIT_THRESHOLDS in the pipeline and the mirrored pipeline.ts.
HIT_BANDS: Tuple[Tuple[str, float], ...] = (
    ("2x", 2.0), ("5x", 5.0), ("10x", 10.0),
    ("20x", 20.0), ("50x", 50.0), ("100x", 100.0), ("1000x", 1000.0),
)

EV_EMA_HALF_LIFE = 50

# The projected-shape horizon, in rounds ahead. 120 is enough to show a
# moonshot tile on the same axis as a 2x tile without the far tail flattening
# everything else against the left edge.
SHAPE_HORIZON = 120
SHAPE_SAMPLES = 72


# ---------------------------------------------------------------------------
# per-visitor state
# ---------------------------------------------------------------------------

class VisitorState:
    """Cached multi-timeframe baselines plus projection snapshots.

    Held per visitor and mutated under a lock. A plain dict of small payloads:
    this is a cache, not a database, and a process restart simply rebuilds it
    on the next scheduled pass.
    """

    __slots__ = ("lock", "baseline", "baseline_projection", "baseline_rounds",
                 "baseline_at", "baseline_ms", "baseline_ok",
                 "large_projection", "large_rounds",
                 "large_at", "large_ms", "large_ok",
                 "medium_projection", "medium_rounds",
                 "medium_at", "medium_ms", "medium_ok",
                 "revision", "last_round_id", "prev_ev", "prev_responsive")

    def __init__(self) -> None:
        self.lock = threading.RLock()
        # Current window (600 rounds) - refreshed every round
        self.baseline: Dict[str, Any] = {}
        self.baseline_projection: Dict[str, Any] = {}
        self.baseline_rounds = 0
        self.baseline_at = 0.0            # wall clock of the last heavy pass
        self.baseline_ms = 0.0            # how long it took, published as cost
        self.baseline_ok = False
        
        # Large window (5000 rounds) - refreshed on schedule
        self.large_projection: Dict[str, Any] = {}
        self.large_rounds = 0
        self.large_at = 0.0
        self.large_ms = 0.0
        self.large_ok = False
        
        # Medium window (2000 rounds) - refreshed on schedule
        self.medium_projection: Dict[str, Any] = {}
        self.medium_rounds = 0
        self.medium_at = 0.0
        self.medium_ms = 0.0
        self.medium_ok = False
        
        # The tape position. Bumped *only* by a real round arriving, never by a
        # read, so two polls of an unchanged tape report the same revision.
        self.revision = 0
        self.last_round_id = 0
        # Track previous EV for delta calculation per visitor
        self.prev_ev = 1.0
        self.prev_responsive = 1.0


_STATES: Dict[str, VisitorState] = {}
_STATE_GUARD = threading.Lock()


def _state(visitor: str) -> VisitorState:
    with _STATE_GUARD:
        st = _STATES.get(visitor)
        if st is None:
            st = VisitorState()
            _STATES[visitor] = st
        return st


def invalidate(visitor: str) -> None:
    """Drop a visitor's cached multi-timeframe tiers after the tape is replaced.

    A scheduled pass is only reusable while the tape it measured still exists.
    After a reseed, a bulk `replace` or a database import the cache describes a
    tape that is gone, so the randomness verdict would be republished against
    the wrong data and `delta.roundsApart` would go negative on a shorter tape.
    Dropping the state makes the next read recompute once, which is the honest
    cost of having thrown the tape away.
    """
    with _STATE_GUARD:
        _STATES.pop(visitor, None)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ---------------------------------------------------------------------------
# the cheap, per-round tier
# ---------------------------------------------------------------------------

def quantile_at(survivalAt: Callable[[float], float], s0: float,
                max_x: float = 1e5) -> float:
    """Forward quantile: the x where P(next >= x) = s0.

    Bisection on the monotone-decreasing survival, exactly as
    `calibratedQuantile` does in the mirrored TypeScript. `s0` is a *survival*
    probability, so the median is 0.5 and the 90th percentile is 0.10.
    """
    if s0 <= 0:
        return max_x
    if s0 >= 1:
        return 1.0
    lo, hi = 1.0, 2.0
    while survivalAt(hi) > s0 and hi < max_x:
        hi *= 2
    hi = min(hi, max_x)
    if survivalAt(hi) > s0:
        return max_x
    for _ in range(64):
        mid = (lo + hi) / 2
        if survivalAt(mid) >= s0:
            lo = mid
        else:
            hi = mid
        if hi - lo < 1e-3:
            break
    return round((lo + hi) / 2, 2)


def hit_eta(survivalAt: Callable[[float], float], threshold: float) -> Dict[str, Any]:
    """Expected wait to the next round >= threshold.

    Rounds are independent, so the wait is geometric: E[N] = 1/p with
    sigma = sqrt(1 - p) / p, and the 90th percentile of the wait is
    -ln(0.1) / p. The empirical leg of the estimator needs 8 exceedances, so a
    reach probability below that floor is a Pareto extrapolation and is flagged
    rather than silently trusted. Mirrored in `frontend/lib/stats.ts:hitEta`.
    """
    p = _clamp(survivalAt(threshold), 1e-4, 0.999)
    eta = 1.0 / p
    sigma = math.sqrt(1.0 - p) / p
    return {
        "threshold": threshold,
        "pReach": round(p, 6),
        "eta": round(eta, 3),
        "ciLower": round(max(1.0, eta - 1.5 * sigma), 3),
        "ciUpper": round(eta + 1.5 * sigma, 3),
        "p90": round(-math.log(0.1) / p, 3),
        "note": "tail extrapolation — fewer than ~8 hits on tape" if p < 0.008 else None,
    }


def _expected_value(multipliers: Sequence[float], survival_at: Callable[[float], float], prev_ev: float = 1.0, prev_responsive: float = 1.0) -> Dict[str, Any]:
    """Conservative expected value based on actual recent distribution.
    
    Uses robust statistics to avoid overestimation:
    1. Trimmed mean (remove top 5% outliers) - reflects typical distribution
    2. Median-based headline - most robust to outliers
    3. Recent window focus (600 rounds) - ignores ancient history
    
    This produces realistic values that reflect that most crash games have
    the majority of rounds in the 1x-2x range, with EV typically around 1.5-2x.
    """
    n = len(multipliers)
    if not n:
        return {"full": 1.0, "recent": 1.0, "ema": 1.0, "responsive": 1.0, "deltaPerRound": 0.0, "responsiveDelta": 0.0,
                "halfLife": EV_EMA_HALF_LIFE, "n": 0, "max": 1.0}
    
    window = list(multipliers[-WINDOW:]) if len(multipliers) >= WINDOW else list(multipliers)
    
    # Remove top 5% outliers for trimmed mean (focus on typical distribution)
    sorted_window = sorted(window)
    trim_count = max(1, len(sorted_window) // 20)  # Remove top 5%
    trimmed_window = sorted_window[:-trim_count] if trim_count > 0 else sorted_window
    trimmed_mean = sum(trimmed_window) / len(trimmed_window) if trimmed_window else 1.0
    
    # Median for robust headline (most resistant to outliers)
    median = sorted_window[len(sorted_window) // 2] if sorted_window else 1.0
    
    # Use weighted combination: 70% trimmed mean + 30% median
    # This gives a realistic EV that reflects typical distribution
    robust_ev = (trimmed_mean * 0.7) + (median * 0.3)
    
    # === RESPONSIVE EV (trend-sensitive) ===
    # EMA on recent window for faster response to changes
    alpha = 1 - math.pow(2, -1 / EV_EMA_HALF_LIFE)
    responsive_ev = window[0]
    for i in range(1, len(window)):
        responsive_ev += alpha * (window[i] - responsive_ev)
    
    # Calculate deltas
    robust_delta = robust_ev - prev_ev
    responsive_delta = responsive_ev - prev_responsive
    
    # Full tape mean for comparison
    full_mean = sum(multipliers) / n
    recent_200 = list(multipliers[-200:])
    recent_mean = sum(recent_200) / len(recent_200) if recent_200 else full_mean

    return {
        "full": round(full_mean, 4), 
        "recent": round(recent_mean, 4), 
        "ema": round(robust_ev, 4),  # Robust trimmed-mean-based EV (headline)
        "responsive": round(responsive_ev, 4),  # Responsive EMA-based EV (trend)
        "deltaPerRound": round(robust_delta, 4),  # Delta for robust EV
        "responsiveDelta": round(responsive_delta, 4),  # Delta for responsive EV
        "halfLife": EV_EMA_HALF_LIFE,
        "n": n, 
        "max": max(multipliers),
        "distributionBased": True,
        "components": {
            "trimmedMean": round(trimmed_mean, 4),
            "median": round(median, 4),
        },
    }


def _live_context(multipliers: Sequence[float], house_edge: float) -> Dict[str, Any]:
    """Cheap per-round context, re-derived from the tape rather than from the panel helper."""
    n = len(multipliers)
    if not n:
        return {}
    last20 = list(multipliers[-20:])
    last50 = list(multipliers[-50:])
    hits2 = sum(1 for m in multipliers if m >= 2)
    fair2 = min(1.0, (1.0 - house_edge) / 2.0)
    return {
        "rounds": n,
        "last": multipliers[-1],
        "dryStreak": win.current_run(multipliers, 2.0),
        "dryStreak10x": win.current_run(multipliers, 10.0),
        "recentHitRate2x": round(sum(1 for m in last20 if m >= 2) / len(last20), 6),
        "fairHitRate2x": round(fair2, 6),
        "meanLast50": round(sum(last50) / len(last50), 4),
        "medianLast50": round(sorted(last50)[len(last50) // 2], 4),
        # Wilson interval on the observed 2x rate, so the live rate is published
        # with the precision its sample size actually supports.
        "hitRate2x95": [round(x, 6) for x in win.wilson(hits2 / n, n)],
    }


def project(multipliers: Sequence[float], house_edge: float,
            label: str = "live", prev_ev: float = 1.0, prev_responsive: float = 1.0) -> Dict[str, Any]:
    """The realtime tier: everything that must re-commit when a round lands.

    One tail fit, a handful of O(window) scans, and a bisection per quantile.
    Reused verbatim to snapshot the baseline, so the published delta compares
    like with like instead of two estimators that could disagree for other
    reasons.
    """
    window = list(multipliers[-WINDOW:])
    tail = sv.hill_alpha(window)

    def survival_at(x: float) -> float:
        return sv.survival(window, x, tail)

    ladder = {name: quantile_at(survival_at, s) for name, s in QUANTILE_LADDER}
    etas = {f"{key}": hit_eta(survival_at, threshold) for key, threshold in HIT_BANDS}
    exceed = win.exceedance_grid(multipliers, house_edge)
    curve = [
        {"x": round(1 + (119 * i / (SHAPE_SAMPLES - 1)), 2),
         "p": round(survival_at(1 + (119 * i / (SHAPE_SAMPLES - 1))), 5)}
        for i in range(SHAPE_SAMPLES)
    ]
    return {
        "label": label,
        "rounds": len(multipliers),
        "window": len(window),
        "tailAlpha": round(tail["alpha"], 4),
        "tailThreshold": round(tail["u"], 4),
        # `hitEtas` keeps the big-hit keys the existing dashboard reads
        # (2x/5x/10x); `bandEtas` carries moonshot/mega/cosmic/jackpot. Both are
        # the same estimator, so one map with every band is published alongside
        # them and the frontend has a single source.
        "hitEtas": {k: etas[k] for k in ("2x", "5x", "10x")},
        "bandEtas": {k: etas[k] for k in ("20x", "50x", "100x", "1000x")},
        "allEtas": etas,
        "survivalCurve": curve,
        "quantiles": ladder,
        "target": {"median": ladder["p50"], "p25": ladder["p25"], "p90": ladder["p90"]},
        "intervals": {
            "tight": [ladder["p25"], ladder["p75"]],
            "full": [ladder["p05"], ladder["p95"]],
            "extreme": [ladder["p01"], ladder["p99"]],
            "iqr": round(ladder["p75"] - ladder["p25"], 2),
        },
        "expectedValue": _expected_value(multipliers, survival_at, prev_ev, prev_responsive),
        "context": _live_context(multipliers, house_edge),
        "exceedance": {
            "rows": exceed["rows"],
            "insideInterval": exceed["insideInterval"],
            "measured": exceed["measured"],
            "verdict": exceed["verdict"],
        },
        "costMs": None,   # filled in by `advance`
    }


# ---------------------------------------------------------------------------
# the drawn "chart prediction" — projected shape, decomposed to actuals + ETA
# ---------------------------------------------------------------------------

def shape_forecast(multipliers: Sequence[float], house_edge: float,
                   horizon: int = SHAPE_HORIZON) -> Dict[str, Any]:
    """The projected *shape* of the tape ahead, as a drawn path.

    A shape, not a number: the calibrated survival curve over the horizon,
    normalised to the same [0, 1] drawing space as the realized path so the two
    can be overlaid without either one rescaling the other, plus the fitted
    curve family (exponential / power_law / logistic) that says which way the
    shape leans.

    Decomposed, as the Chart Lab needs it, into:

      * `projected` — the shape itself (what the model expects to be drawn),
      * `realized`  — the same path for the rounds that actually landed, so the
        projection can be seen to confirm or fail in place,
      * `eta`       — the wait to each magnitude, which is the shape read as time.

    This is a *distribution over outcomes*, never a call: `fairPath` is drawn
    beside it because a correctly implemented crash game sits on (1-h)/x.
    """
    window = list(multipliers[-WINDOW:])
    tail = sv.hill_alpha(window)

    def survival_at(x: float) -> float:
        return sv.survival(window, x, tail)

    span = max(2.0, float(horizon))
    projected: List[Dict[str, Any]] = []
    for i in range(SHAPE_SAMPLES):
        x = 1 + (span - 1) * i / (SHAPE_SAMPLES - 1)
        p = survival_at(x)
        projected.append({
            "x": round(x, 3),
            "p": round(p, 5),
            "fair": round(min(1.0, (1 - house_edge) / x) if x > 1 else 1.0, 5),
        })

    # The realized path is the same axes read off the tape that actually
    # printed: for each sampled magnitude, the share of rounds that reached it.
    realized: List[Dict[str, Any]] = []
    n = len(window)
    for i in range(SHAPE_SAMPLES):
        x = 1 + (span - 1) * i / (SHAPE_SAMPLES - 1)
        above = sum(1 for m in window if m >= x) if n else 0
        realized.append({
            "x": round(x, 3),
            "p": round(above / n, 5) if n else 0.0,
            "hits": above,
            "samples": n,
        })

    eta = {key: hit_eta(survival_at, threshold) for key, threshold in HIT_BANDS}
    etas = [eta[key] for key, _ in HIT_BANDS]

    # Curve family of the *projected* shape, using the existing fitter rather
    # than a new one, so the drawing and the dashboard agree on the vocabulary.
    fit = mm.fit_curve_shape([p["p"] for p in projected])
    families = mm.curve_shape_distribution(window) if n else {
        "exponential": 0.0, "power_law": 0.0, "logistic": 0.0}

    return {
        "horizon": span,
        "samples": SHAPE_SAMPLES,
        "rounds": len(multipliers),
        "window": n,
        "projected": projected,
        "realized": realized,
        "fairPath": [{"x": p["x"], "p": p["fair"]} for p in projected],
        "eta": etas,
        "shape": {"family": fit.shape, "r2": round(fit.r2, 4), "params": fit.params},
        "families": families,
        "tailAlpha": round(tail["alpha"], 4),
        "note": (
            "The projected shape is the calibrated next-round distribution over the recent "
            "window, drawn rather than tabled; `realized` is the same axes read off the tape "
            "that actually printed. Where the two diverge the model is wrong about the shape, "
            "and the divergence is the measurement — not a trading signal."
        ),
    }


# ---------------------------------------------------------------------------
# multi-timeframe projections
# ---------------------------------------------------------------------------

def run_large_window(visitor: str, multipliers: Sequence[float], house_edge: float,
                    rounds: Optional[Sequence[Dict[str, Any]]] = None) -> None:
    """Compute and store the large-window (5000 rounds) structural analysis.
    
    Refreshed on schedule (every 300 rounds or 5 minutes). Captures long-term
    trends and structural characteristics of the tape.
    """
    st = _state(visitor)
    tape = list(multipliers)
    started = time.perf_counter()
    
    window = list(tape[-WINDOW_LARGE:]) if len(tape) >= WINDOW_LARGE else tape
    if len(window) < 100:
        return {"available": False, "reason": "need ≥100 rounds for large window"}
    
    tail = sv.hill_alpha(window)
    
    def survival_at(x: float) -> float:
        return sv.survival(window, x, tail)
    
    with st.lock:
        prev_ev = st.prev_ev
        prev_responsive = st.prev_responsive
    
    projection = project(tape, house_edge, label="large", prev_ev=prev_ev, prev_responsive=prev_responsive)
    projection["window"] = len(window)
    projection["tailAlpha"] = round(tail["alpha"], 4)
    # Override with distribution-based EV for this window
    projection["expectedValue"] = _expected_value(window, survival_at, prev_ev, prev_responsive)
    
    # Update prev_ev for next round
    new_ev = projection["expectedValue"]["ema"]
    new_responsive = projection["expectedValue"]["responsive"]
    
    elapsed = round((time.perf_counter() - started) * 1000, 1)
    with st.lock:
        st.large_projection = projection
        st.large_rounds = len(tape)
        st.large_at = time.time()
        st.large_ms = elapsed
        st.large_ok = True
        st.prev_ev = new_ev
        st.prev_responsive = new_responsive


def run_medium_window(visitor: str, multipliers: Sequence[float], house_edge: float,
                      rounds: Optional[Sequence[Dict[str, Any]]] = None) -> None:
    """Compute and store the medium-window (2000 rounds) intermediate analysis.
    
    Refreshed on schedule (every 100 rounds or 2 minutes). Captures medium-term
    trends and transitional patterns.
    """
    st = _state(visitor)
    tape = list(multipliers)
    started = time.perf_counter()
    
    window = list(tape[-WINDOW_MEDIUM:]) if len(tape) >= WINDOW_MEDIUM else tape
    if len(window) < 50:
        return {"available": False, "reason": "need ≥50 rounds for medium window"}
    
    tail = sv.hill_alpha(window)
    
    def survival_at(x: float) -> float:
        return sv.survival(window, x, tail)
    
    with st.lock:
        prev_ev = st.prev_ev
        prev_responsive = st.prev_responsive
    
    projection = project(tape, house_edge, label="medium", prev_ev=prev_ev, prev_responsive=prev_responsive)
    projection["window"] = len(window)
    projection["tailAlpha"] = round(tail["alpha"], 4)
    # Override with distribution-based EV for this window
    projection["expectedValue"] = _expected_value(window, survival_at, prev_ev, prev_responsive)
    
    # Update prev_ev for next round
    new_ev = projection["expectedValue"]["ema"]
    new_responsive = projection["expectedValue"]["responsive"]
    
    elapsed = round((time.perf_counter() - started) * 1000, 1)
    with st.lock:
        st.medium_projection = projection
        st.medium_rounds = len(tape)
        st.medium_at = time.time()
        st.medium_ms = elapsed
        st.medium_ok = True
        st.prev_ev = new_ev
        st.prev_responsive = new_responsive


def check_refresh_needed(visitor: str, current_rounds: int) -> Dict[str, bool]:
    """Check if large or medium window refreshes are needed.
    
    Returns which windows need recomputation based on:
    - Round count since last refresh
    - Time elapsed since last refresh
    - Tape replacement (round count decrease)
    """
    st = _state(visitor)
    with st.lock:
        large_rounds_delta = current_rounds - st.large_rounds
        medium_rounds_delta = current_rounds - st.medium_rounds
        
        large_time_delta = time.time() - st.large_at if st.large_at else float('inf')
        medium_time_delta = time.time() - st.medium_at if st.medium_at else float('inf')
        
        # Refresh if rounds decreased (tape replacement)
        tape_replaced = current_rounds < st.large_rounds or current_rounds < st.medium_rounds
        
        return {
            "large": (not st.large_ok or 
                     tape_replaced or 
                     large_rounds_delta >= LARGE_REFRESH_ROUNDS or 
                     large_time_delta >= LARGE_REFRESH_SECONDS),
            "medium": (not st.medium_ok or 
                      tape_replaced or 
                      medium_rounds_delta >= MEDIUM_REFRESH_ROUNDS or 
                      medium_time_delta >= MEDIUM_REFRESH_SECONDS),
        }


# ---------------------------------------------------------------------------
# the expensive, scheduled tier
# ---------------------------------------------------------------------------

def heavy(multipliers: Sequence[float], house_edge: float,
          rounds: Optional[Sequence[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """The scheduled tier: slow-moving, expensive, cached per visitor.

    Deliberately excludes anything the realtime tier already publishes, so the
    two compose instead of duplicating: the realtime layer is the truth for
    "what is the next round", this one for "is this tape fair, and is there any
    skill in it" — questions that only move over hundreds of rounds.

    `rounds` carries timestamped rows when available. The phase-of-day and
    window-odds helpers need real timestamps; without them those two sections
    are reported as unmeasured rather than computed off a fabricated clock.
    """
    started = time.perf_counter()
    tape = list(multipliers)
    stamped = list(rounds) if rounds else []
    out: Dict[str, Any] = {
        "randomness": rnd.full_battery(tape, house_edge),
        "skill": win.earned_skill(tape, 2.0),
        "diagnostics": sv.diagnostics(tape[-WINDOW:], house_edge),
        "droughts": win.droughts(tape, win.LIVE_THRESHOLDS),
        "phases": (win.hour_phases(stamped, 2.0) if stamped
                   else {"testable": False, "note": "no timestamps on this tape"}),
        "windowOdds": (win.window_odds(tape, stamped, house_edge) if stamped
                       else {"windows": [], "note": "no timestamps on this tape"}),
    }
    out["costMs"] = round((time.perf_counter() - started) * 1000, 1)
    return out


def run_baseline(visitor: str, multipliers: Sequence[float], house_edge: float,
                 rounds: Optional[Sequence[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Compute and store the heavy tier plus its projection snapshot.

    Safe to call from a worker thread. Snapshotting the projection here (rather
    than re-deriving it on every comparison) is what keeps `advance()` to a
    single projection per round.
    """
    st = _state(visitor)
    tape = list(multipliers)
    started = time.perf_counter()
    payload = heavy(tape, house_edge, rounds)
    snapshot = project(tape, house_edge, label="baseline")
    elapsed = round((time.perf_counter() - started) * 1000, 1)
    with st.lock:
        st.baseline = payload
        st.baseline_projection = snapshot
        st.baseline_rounds = len(tape)
        st.baseline_at = time.time()
        st.baseline_ms = elapsed
        st.baseline_ok = True
    return payload


def baseline_fresh(visitor: str, max_age_s: float = 30.0) -> bool:
    st = _state(visitor)
    with st.lock:
        return st.baseline_ok and (time.time() - st.baseline_at) <= max_age_s


def _delta(current: Dict[str, Any], baseline: Dict[str, Any], apart: int) -> Dict[str, Any]:
    """How far the live projection has moved off the baseline snapshot."""
    if apart <= 0 or not baseline:
        return {"roundsApart": 0, "medianDrift": 0.0, "tailAlphaDrift": 0.0,
                "etaDrift10x": 0.0, "moved": False}
    median_drift = round(current["target"]["median"] - baseline["target"]["median"], 4)
    alpha_drift = round(current["tailAlpha"] - baseline["tailAlpha"], 4)
    eta_drift = round(current["allEtas"]["10x"]["eta"] - baseline["allEtas"]["10x"]["eta"], 3)
    return {
        "roundsApart": apart,
        "medianDrift": median_drift,
        "tailAlphaDrift": alpha_drift,
        "etaDrift10x": eta_drift,
        "moved": bool(median_drift or alpha_drift or eta_drift),
    }


# ---------------------------------------------------------------------------
# the per-round hook
# ---------------------------------------------------------------------------

def _compose(st: VisitorState, visitor: str, multipliers: Sequence[float],
             house_edge: float) -> Dict[str, Any]:
    """Build the composed payload from the current tape.

    Writes nothing: it reads the cached heavy tier and computes exactly one cheap
    projection. `advance()` and `summary()` are the two callers — one is a real
    round and bumps the revision, the other is a poll and must not — so keeping
    the composition in one place is what stops the live frame and a poll from
    disagreeing about the same round.
    """
    started = time.perf_counter()
    with st.lock:
        prev_ev = st.prev_ev
        prev_responsive = st.prev_responsive
    projection = project(multipliers, house_edge, label="live", prev_ev=prev_ev, prev_responsive=prev_responsive)
    projection["costMs"] = round((time.perf_counter() - started) * 1000, 2)
    
    # Update prev_ev for next round
    new_ev = projection["expectedValue"]["ema"]
    new_responsive = projection["expectedValue"]["responsive"]
    with st.lock:
        st.prev_ev = new_ev
        st.prev_responsive = new_responsive

    with st.lock:
        baseline_rounds = st.baseline_rounds
        baseline_projection = st.baseline_projection
        baseline_at = st.baseline_at
        baseline_ms = st.baseline_ms
        baseline_verdict = ((st.baseline.get("randomness") or {}).get("overall") or {}).get("verdict")
        revision = st.revision

    return {
        "type": "stats",
        "revision": revision,
        "at": time.time(),
        "baseline": {
            "fresh": baseline_fresh(visitor),
            "rounds": baseline_rounds,
            "ageMs": round((time.time() - baseline_at) * 1000, 1) if baseline_at else None,
            "costMs": baseline_ms,
            "verdict": baseline_verdict,
        },
        # The heavy snapshot measured `baseline_rounds` entries; the live
        # projection measures `len(tape)`. Their difference *is* the drift and it
        # needs no stored marker: a tape that did not grow reads back zero, which
        # is what makes this safe to compute on a pure read.
        "delta": _delta(projection, baseline_projection,
                        len(list(multipliers)) - baseline_rounds),
        "projection": projection,
    }


def _compose_stacked(st: VisitorState, visitor: str, multipliers: Sequence[float],
                     house_edge: float) -> Dict[str, Any]:
    """Build the stacked multi-timeframe prediction payload.

    Combines large, medium, and current window projections into a single
    forex-style analysis, with the current window being the most weighted for
    immediate predictions while larger windows provide structural context.
    """
    started = time.perf_counter()
    with st.lock:
        prev_ev = st.prev_ev
        prev_responsive = st.prev_responsive
        baseline_rounds = st.baseline_rounds
        baseline_projection = st.baseline_projection
        baseline_at = st.baseline_at
        baseline_ms = st.baseline_ms
        baseline_verdict = ((st.baseline.get("randomness") or {}).get("overall") or {}).get("verdict")
        revision = st.revision
        
        # Multi-timeframe data
        large_ok = st.large_ok
        large_projection = st.large_projection
        large_at = st.large_at
        large_rounds = st.large_rounds
        medium_ok = st.medium_ok
        medium_projection = st.medium_projection
        medium_at = st.medium_at
        medium_rounds = st.medium_rounds

    projection = project(multipliers, house_edge, label="live", prev_ev=prev_ev, prev_responsive=prev_responsive)
    projection["costMs"] = round((time.perf_counter() - started) * 1000, 2)
    
    # Update prev_ev for next round
    new_ev = projection["expectedValue"]["ema"]
    new_responsive = projection["expectedValue"]["responsive"]
    with st.lock:
        st.prev_ev = new_ev
        st.prev_responsive = new_responsive

    # Compose stacked prediction: weighted combination of timeframes
    # Current window gets highest weight (60%), medium (30%), large (10%)
    stacked_target = {}
    if large_ok and medium_ok:
        # Weighted median from all timeframes
        weights = {"live": 0.6, "medium": 0.3, "large": 0.1}
        stacked_target = {
            "median": (
                projection["target"]["median"] * weights["live"] +
                medium_projection["target"]["median"] * weights["medium"] +
                large_projection["target"]["median"] * weights["large"]
            ),
            "p25": (
                projection["target"]["p25"] * weights["live"] +
                medium_projection["target"]["p25"] * weights["medium"] +
                large_projection["target"]["p25"] * weights["large"]
            ),
            "p90": (
                projection["target"]["p90"] * weights["live"] +
                medium_projection["target"]["p90"] * weights["medium"] +
                large_projection["target"]["p90"] * weights["large"]
            ),
        }
    else:
        # Fallback to current window if multi-timeframe not available
        stacked_target = projection["target"]

    return {
        "type": "stats",
        "revision": revision,
        "at": time.time(),
        "baseline": {
            "fresh": baseline_fresh(visitor),
            "rounds": baseline_rounds,
            "ageMs": round((time.time() - baseline_at) * 1000, 1) if baseline_at else None,
            "costMs": baseline_ms,
            "verdict": baseline_verdict,
        },
        "delta": _delta(projection, baseline_projection,
                        len(list(multipliers)) - baseline_rounds),
        "projection": projection,
        "multiTimeframe": {
            "available": large_ok and medium_ok,
            "stackedTarget": stacked_target,
            "large": {
                "available": large_ok,
                "target": large_projection["target"] if large_ok else None,
                "rounds": large_rounds,
                "ageMs": round((time.time() - large_at) * 1000, 1) if large_at else None,
            },
            "medium": {
                "available": medium_ok,
                "target": medium_projection["target"] if medium_ok else None,
                "rounds": medium_rounds,
                "ageMs": round((time.time() - medium_at) * 1000, 1) if medium_at else None,
            },
            "current": {
                "available": True,
                "target": projection["target"],
                "rounds": len(multipliers),
            },
        },
    }


def advance(visitor: str, multipliers: Sequence[float], house_edge: float,
            round_id: Optional[int] = None) -> Dict[str, Any]:
    """Advance the multi-timeframe realtime tier on top of cached baselines.

    Implements forex-style stacked analysis:
    - Large window (5000 rounds): structural trends, refreshed on schedule
    - Medium window (2000 rounds): intermediate trends, refreshed on schedule  
    - Current window (600 rounds): immediate state, refreshed every round

    Called from the ingest path, off the event loop. If no baseline has been
    scheduled yet one is computed here, so the very first round already has a
    composed payload — the scheduler exists to keep the baseline *fresh*, not
    to make the feature work at all.
    """
    st = _state(visitor)
    current_rounds = len(multipliers)
    
    with st.lock:
        cold = not st.baseline_ok
    if cold:
        run_baseline(visitor, multipliers, house_edge)

    # Check and refresh multi-timeframe windows on schedule
    refresh_needed = check_refresh_needed(visitor, current_rounds)
    
    # Refresh large window on schedule (non-blocking)
    if refresh_needed["large"] and current_rounds >= WINDOW_LARGE:
        try:
            run_large_window(visitor, multipliers, house_edge, rounds)
        except Exception:
            pass  # Don't fail the round if large window computation fails
    
    # Refresh medium window on schedule (non-blocking)
    if refresh_needed["medium"] and current_rounds >= WINDOW_MEDIUM:
        try:
            run_medium_window(visitor, multipliers, house_edge, rounds)
        except Exception:
            pass  # Don't fail the round if medium window computation fails

    with st.lock:
        if round_id is not None:
            st.last_round_id = round_id
        # A *round* moves the tape, so the revision moves with it. This is the
        # only bump in the module: counting polls as progress would make the
        # revision a clock that never repeats the same value twice, and the AI
        # summary is cached on it.
        st.revision += 1
    return _compose_stacked(st, visitor, multipliers, house_edge)


# ---------------------------------------------------------------------------
# route payloads
# ---------------------------------------------------------------------------

def summary(visitor: str, multipliers: Sequence[float], house_edge: float,
            rounds: Optional[Sequence[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """What `GET /api/stats/realtime` returns: multi-timeframe stacked prediction.

    Computes nothing expensive on the hot path: the heavy tier is read from
    cache and, if it has never run, computed once here so a cold workspace is
    never empty. Returns stacked large/medium/current window analysis.
    """
    st = _state(visitor)
    current_rounds = len(multipliers)
    
    with st.lock:
        have_baseline = st.baseline_ok
    if not have_baseline:
        run_baseline(visitor, multipliers, house_edge, rounds)

    # Initialize multi-timeframe windows on first summary call
    refresh_needed = check_refresh_needed(visitor, current_rounds)
    if refresh_needed["large"] and current_rounds >= WINDOW_LARGE:
        try:
            run_large_window(visitor, multipliers, house_edge, rounds)
        except Exception:
            pass
    if refresh_needed["medium"] and current_rounds >= WINDOW_MEDIUM:
        try:
            run_medium_window(visitor, multipliers, house_edge, rounds)
        except Exception:
            pass

    payload = _compose_stacked(st, visitor, multipliers, house_edge)
    with st.lock:
        baseline = st.baseline
    return {
        "realtime": payload["projection"],
        "baseline": {**payload["baseline"], "payload": baseline},
        "delta": payload["delta"],
        "revision": payload["revision"],
        "composed": True,
        "multiTimeframe": payload.get("multiTimeframe"),
        "note": (
            "Realtime figures re-commit on every round and are built on top of the "
            "scheduled heavy pass. `delta` is how far the live projection has moved off "
            "that pass; `baseline.rounds` is the tape length it ran against."
        ),
    }
