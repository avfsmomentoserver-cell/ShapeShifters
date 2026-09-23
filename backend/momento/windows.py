"""Window odds, exceedance grid, droughts and time-of-day phases.

Ported from the Momento Platform 6.2.0 TypeScript bundle (``functions/analysis.ts``
and ``functions/pipeline.ts``) into this backend, with three deliberate upgrades:

* every observed rate carries a Wilson 95% interval, so a reader can see how much
  of an apparent edge is just sampling noise;
* window probabilities are reported as an interval, not a single number, by
  propagating that Wilson interval through ``1 - (1 - p)^n``;
* the ensemble's component weights are *earned* from a walk-forward Brier score
  against the measured base rate. On a correctly implemented crash game no
  component earns anything, the baseline keeps the full weight, and the page says
  so — which is the honest answer, not a bug.

Nothing in this module can forecast a fair crash game. It converts a measured
base rate and a measured round cadence into the probability of seeing at least
one qualifying round inside a stretch of time, which is arithmetic, not insight.
"""
from __future__ import annotations

import math
from collections import Counter, deque
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .randomness import _chi2_sf, theoretical_survival

THRESHOLDS: Tuple[float, ...] = (1.2, 1.5, 2.0, 3.0, 5.0, 10.0, 20.0, 50.0, 100.0, 250.0, 500.0, 1000.0)
LIVE_THRESHOLDS: Tuple[float, ...] = (2.0, 5.0, 10.0, 50.0, 100.0)

WINDOWS: Tuple[Dict[str, Any], ...] = (
    {"id": "15m", "label": "15 minutes", "ms": 15 * 60_000},
    {"id": "1h", "label": "1 hour", "ms": 3_600_000},
    {"id": "4h", "label": "4 hours", "ms": 4 * 3_600_000},
    {"id": "1d", "label": "1 day", "ms": 24 * 3_600_000},
    {"id": "7d", "label": "7 days", "ms": 7 * 24 * 3_600_000},
)

_EPS = 1e-9


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


# ---------------------------------------------------------------------------
# interval estimates and waiting times
# ---------------------------------------------------------------------------

def wilson(p: float, n: int, z: float = 1.96) -> Tuple[float, float]:
    """Wilson score interval — behaves at the extremes where normal CIs fail."""
    if n <= 0:
        return (0.0, 0.0)
    denom = 1.0 + (z * z) / n
    centre = p + (z * z) / (2 * n)
    spread = z * math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
    return (max(0.0, (centre - spread) / denom), min(1.0, (centre + spread) / denom))


def median_wait(rate: float) -> Optional[int]:
    """Rounds until the chance of having seen a hit passes 50%."""
    if rate <= 0 or rate >= 1:
        return None
    return max(1, math.ceil(math.log(2) / -math.log(1 - rate)))


def percentile_wait(rate: float, q: float) -> Optional[int]:
    """Rounds until the chance of having seen a hit passes ``q``."""
    if rate <= 0 or rate >= 1 or not 0 < q < 1:
        return None
    # log(1-q) and log(1-rate) are both negative, so the ratio is the positive
    # number of rounds. (The TypeScript original negated the denominator and
    # returned 1 for every percentile — fixed here, and covered by a test.)
    return max(1, math.ceil(math.log(1 - q) / math.log(1 - rate)))


def window_probability(p_per_round: float, n_rounds: int) -> float:
    """P(at least one hit in n rounds) for an i.i.d. per-round probability."""
    p = _clamp(p_per_round, _EPS, 1 - _EPS)
    return _clamp(1 - (1 - p) ** max(0, n_rounds), 0.0, 1.0)


def current_run(multipliers: Sequence[float], threshold: float) -> int:
    """Rounds since the last hit at or above ``threshold``."""
    run = 0
    for m in reversed(multipliers):
        if m >= threshold:
            break
        run += 1
    return run


# ---------------------------------------------------------------------------
# exceedance grid
# ---------------------------------------------------------------------------

def exceedance_grid(multipliers: Sequence[float], house_edge: float = 0.03,
                    thresholds: Sequence[float] = THRESHOLDS) -> Dict[str, Any]:
    """Observed vs fair exceedance at every threshold, with intervals and waits."""
    n = len(multipliers)
    rows: List[Dict[str, Any]] = []
    for t in thresholds:
        hits = sum(1 for m in multipliers if m >= t)
        rate = hits / n if n else 0.0
        lo, hi = wilson(rate, n)
        fair = theoretical_survival(t, house_edge)
        se = math.sqrt(max(fair * (1 - fair) / n, 1e-12)) if n else 0.0
        z = (rate - fair) / se if se > 0 else 0.0
        rows.append({
            "threshold": t,
            "hits": hits,
            "rate": round(rate, 6),
            "ciLow": round(lo, 6),
            "ciHigh": round(hi, 6),
            "fair": round(fair, 6),
            "z": round(z, 3),
            "insideInterval": bool(lo <= fair <= hi),
            "etaMedian": median_wait(rate),
            "etaP90": percentile_wait(rate, 0.9),
            "fairEtaMedian": median_wait(fair),
            "currentRun": current_run(multipliers, t),
            "fairPrice": round(1 / fair, 2) if fair > 0 else None,
        })
    inside = sum(1 for r in rows if r["insideInterval"])
    measurable = [r for r in rows if r["hits"] > 0]
    return {
        "rounds": n,
        "houseEdge": house_edge,
        "rows": rows,
        "insideInterval": inside,
        "measured": len(measurable),
        "verdict": (
            f"{inside} of {len(rows)} thresholds have the fair rate inside their 95% interval"
            if n else "no rounds yet"
        ),
        "note": (
            "The fair column is (1 - houseEdge) / x, what a correctly implemented crash game pays. "
            "Where the interval brackets it, the tape is indistinguishable from fair at that threshold; "
            "thresholds with zero hits are unmeasured, not impossible."
        ),
    }


def droughts(multipliers: Sequence[float], thresholds: Sequence[float] = LIVE_THRESHOLDS) -> Dict[str, Any]:
    """How long since each threshold last printed, and how ordinary that is."""
    n = len(multipliers)
    rows: List[Dict[str, Any]] = []
    for t in thresholds:
        hits = sum(1 for m in multipliers if m >= t)
        rate = hits / n if n else 0.0
        run = current_run(multipliers, t)
        med = median_wait(rate)
        # P(a gap of at least `run` rounds) under an i.i.d. tape at this rate.
        p_at_least = (1 - rate) ** run if 0 < rate < 1 else None
        longest = 0
        gap = 0
        for m in multipliers:
            if m >= t:
                longest = max(longest, gap)
                gap = 0
            else:
                gap += 1
        longest = max(longest, gap)
        rows.append({
            "threshold": t,
            "since": run,
            "rate": round(rate, 6),
            "hits": hits,
            "etaMedian": med,
            "etaP90": percentile_wait(rate, 0.9),
            "longestGap": longest,
            "pAtLeastThisLong": round(p_at_least, 4) if p_at_least is not None else None,
            "share": round(run / med, 3) if med else None,
            "unusual": bool(p_at_least is not None and p_at_least < 0.05),
        })
    return {
        "rounds": n,
        "rows": rows,
        "note": (
            "A long gap is not a loaded spring. Each row shows how often an i.i.d. tape at the measured "
            "rate produces a gap at least this long — usually often. The next round's chance is the rate, "
            "whatever the gap has reached."
        ),
    }


# ---------------------------------------------------------------------------
# time-of-day phases
# ---------------------------------------------------------------------------

def hour_phases(rounds: Sequence[Dict[str, Any]], threshold: float = 2.0) -> Dict[str, Any]:
    """Hour-of-day breakdown plus a chi-square test for a real time effect.

    The 'best hour to play' is the most common claim in crash communities. This
    measures it: if hits were driven by the clock, the hit counts per hour would
    not look like a single rate spread over the hours' round counts.
    """
    buckets: Dict[int, List[float]] = {}
    for r in rounds:
        ts = str(r.get("ts") or "")
        hour: Optional[int] = None
        if len(ts) >= 13 and ts[10] in ("T", " "):
            try:
                hour = int(ts[11:13])
            except ValueError:
                hour = None
        if hour is None or not 0 <= hour <= 23:
            continue
        buckets.setdefault(hour, []).append(float(r.get("multiplier") or r.get("m") or 0.0))

    total_rounds = sum(len(v) for v in buckets.values())
    total_hits = sum(sum(1 for m in v if m >= threshold) for v in buckets.values())
    overall = total_hits / total_rounds if total_rounds else 0.0

    rows: List[Dict[str, Any]] = []
    stat = 0.0
    df = 0
    for hour in sorted(buckets):
        vals = buckets[hour]
        k = len(vals)
        hits = sum(1 for m in vals if m >= threshold)
        rate = hits / k if k else 0.0
        lo, hi = wilson(rate, k)
        mean = sum(vals) / k if k else 0.0
        expected = overall * k
        if k >= 5 and expected > 0 and overall < 1:
            stat += (hits - expected) ** 2 / expected
            stat += ((k - hits) - (k - expected)) ** 2 / max(k - expected, 1e-9)
            df += 1
        rows.append({
            "hour": hour,
            "rounds": k,
            "hits": hits,
            "rate": round(rate, 6),
            "ciLow": round(lo, 6),
            "ciHigh": round(hi, 6),
            "mean": round(mean, 3),
            "max": round(max(vals), 2) if vals else 0.0,
            "expectedHits": round(expected, 1),
            "phase": (
                "eruption" if vals and max(vals) >= 100
                else "expansion" if vals and max(vals) >= 20
                else "steady" if rate > overall else "compressed"
            ),
        })

    dof = max(df - 1, 1)
    testable = df > 1
    p = _chi2_sf(stat, dof) if testable else 1.0
    best = max(rows, key=lambda r: r["rate"]) if rows else None
    worst = min(rows, key=lambda r: r["rate"]) if rows else None
    return {
        "threshold": threshold,
        "rounds": total_rounds,
        "overallRate": round(overall, 6),
        "rows": rows,
        "chiSquare": round(stat, 3),
        "df": dof,
        "pValue": round(p, 4),
        "testable": testable,
        "hoursCovered": len(rows),
        "significant": bool(testable and p < 0.05),
        "best": best,
        "worst": worst,
        "verdict": (
            "Not testable yet: the tape covers fewer than two hours with enough rounds in each, "
            "so there is nothing to compare. Run the live feed for a while, or import rounds "
            "carrying their real timestamps."
            if not testable else
            "Hit rates differ by hour more than chance explains — check for a data artefact "
            "(imports clustered in one hour) before believing it."
            if p < 0.05 else
            "No time-of-day effect: the spread across hours is what one rate and this many rounds produce."
        ),
        "note": (
            "The best-looking hour is expected to look good — with 24 hours, one of them wins by noise. "
            "Compare each hour's interval with the overall rate, not with the other hours."
        ),
    }


# ---------------------------------------------------------------------------
# per-round ensemble with earned weights
# ---------------------------------------------------------------------------

def _component_paths(multipliers: Sequence[float], threshold: float, recent: int = 200,
                     warmup: int = 100) -> Dict[str, List[float]]:
    """Walk-forward predictions from each component — no future data at any step."""
    flags = [1 if m >= threshold else 0 for m in multipliers]
    n = len(flags)
    paths: Dict[str, List[float]] = {"baseline": [], "markov": [], "streak": [], "recent": []}
    if n <= warmup:
        return paths

    hits = 0
    hh = hl = lh = ll = 0
    run_stats: Dict[int, List[int]] = {}
    roll: deque = deque(maxlen=recent)
    roll_sum = 0
    run = 0

    for i in range(n):
        base = hits / i if i else 0.5
        if i >= warmup:
            prev_hit = flags[i - 1] == 1
            if prev_hit:
                p_markov = hh / (hh + hl) if (hh + hl) else base
            else:
                p_markov = lh / (lh + ll) if (lh + ll) else base
            stat = run_stats.get(run)
            p_streak = (stat[1] / stat[0]) if (stat and stat[0] >= 10) else base
            p_recent = (roll_sum / len(roll)) if roll else base
            paths["baseline"].append(base)
            paths["markov"].append(p_markov)
            paths["streak"].append(p_streak)
            paths["recent"].append(p_recent)

        # absorb round i
        f = flags[i]
        if i >= 1:
            if flags[i - 1] == 1:
                if f == 1:
                    hh += 1
                else:
                    hl += 1
            else:
                if f == 1:
                    lh += 1
                else:
                    ll += 1
            s = run_stats.setdefault(run, [0, 0])
            s[0] += 1
            s[1] += f
        hits += f
        if len(roll) == roll.maxlen:
            roll_sum -= roll[0]
        roll.append(f)
        roll_sum += f
        run = 0 if f == 1 else run + 1

    paths["actual"] = [float(f) for f in flags[warmup:]]
    return paths


def earned_skill(multipliers: Sequence[float], threshold: float, recent: int = 200,
                 warmup: int = 100) -> Dict[str, Any]:
    """Brier skill of each component against the measured base rate, walk-forward."""
    paths = _component_paths(multipliers, threshold, recent, warmup)
    actual = paths.get("actual") or []
    if len(actual) < 30:
        return {"scored": len(actual), "baselineBrier": None, "skill": {}, "brier": {},
                "note": "not enough resolved rounds to score a component yet"}

    def brier(ps: List[float]) -> float:
        return sum((p - a) ** 2 for p, a in zip(ps, actual)) / len(actual)

    base_brier = brier(paths["baseline"])
    out_brier: Dict[str, float] = {}
    skill: Dict[str, float] = {}
    for name in ("markov", "streak", "recent"):
        b = brier(paths[name])
        out_brier[name] = round(b, 6)
        skill[name] = round(max(0.0, 1 - b / base_brier) if base_brier > 0 else 0.0, 6)
    out_brier["baseline"] = round(base_brier, 6)
    any_skill = any(v > 0 for v in skill.values())
    return {
        "scored": len(actual),
        "baselineBrier": round(base_brier, 6),
        "brier": out_brier,
        "skill": skill,
        "anySkill": any_skill,
        "note": (
            "Skill is 1 - Brier/BrierBaseline, measured walk-forward: a component only earns weight by "
            "beating the measured rate on rounds it had not seen."
            if any_skill else
            "No component beats the measured base rate, so the baseline keeps the full weight. That is the "
            "expected result on a fair tape."
        ),
    }


def per_round_probability(multipliers: Sequence[float], threshold: float,
                          recent: int = 200) -> Dict[str, Any]:
    """Ensemble per-round probability, with each component's value and earned weight."""
    n = len(multipliers)
    if n == 0:
        return {"p": 0.0, "baseRate": 0.0, "ciLow": 0.0, "ciHigh": 0.0, "components": [],
                "note": "no history yet", "skill": {}}
    flags = [1 if m >= threshold else 0 for m in multipliers]
    hits = sum(flags)
    base = hits / n
    lo, hi = wilson(base, n)

    prev_hit = flags[-1] == 1
    hh = hl = lh = ll = 0
    for i in range(1, n):
        if flags[i - 1] == 1:
            if flags[i] == 1:
                hh += 1
            else:
                hl += 1
        else:
            if flags[i] == 1:
                lh += 1
            else:
                ll += 1
    p_markov = (hh / (hh + hl) if (hh + hl) else base) if prev_hit else (lh / (lh + ll) if (lh + ll) else base)

    run = current_run(multipliers, threshold)
    s_n = s_hits = 0
    for i in range(1, n):
        if flags[i - 1] == 1:
            continue
        st = 0
        j = i - 1
        while j >= 0 and flags[j] == 0:
            st += 1
            j -= 1
        if st == run:
            s_n += 1
            s_hits += flags[i]
    p_streak = s_hits / s_n if s_n >= 10 else base
    tail = flags[-recent:]
    p_recent = sum(tail) / len(tail) if tail else base

    scored = earned_skill(multipliers, threshold, recent)
    skill = scored.get("skill") or {}
    values = {"baseline": base, "markov": p_markov, "streak": p_streak, "recent": p_recent}
    weights: Dict[str, float] = {"baseline": 0.25}
    total_skill = sum(max(0.0, skill.get(k, 0.0)) for k in ("markov", "streak", "recent"))
    if total_skill <= 0:
        weights = {"baseline": 1.0, "markov": 0.0, "streak": 0.0, "recent": 0.0}
    else:
        for k in ("markov", "streak", "recent"):
            weights[k] = max(0.0, skill.get(k, 0.0)) / total_skill * 0.75

    def logit(p: float) -> float:
        q = _clamp(p, 1e-6, 1 - 1e-6)
        return math.log(q / (1 - q))

    z = sum(weights.get(k, 0.0) * logit(v) for k, v in values.items())
    blended = 1 / (1 + math.exp(-z)) if weights else base
    return {
        "p": round(_clamp(blended, 1e-6, 1 - 1e-6), 6),
        "baseRate": round(base, 6),
        "ciLow": round(lo, 6),
        "ciHigh": round(hi, 6),
        "currentRun": run,
        "components": [
            {"model": k, "p": round(v, 6), "weight": round(weights.get(k, 0.0), 4),
             "skill": skill.get(k), "brier": (scored.get("brier") or {}).get(k)}
            for k, v in values.items()
        ],
        "skill": skill,
        "scored": scored.get("scored"),
        "note": scored.get("note"),
    }


# ---------------------------------------------------------------------------
# cadence and window odds
# ---------------------------------------------------------------------------

def median_interval_ms(rounds: Sequence[Dict[str, Any]], span: int = 200) -> Dict[str, Any]:
    """Median seconds between rounds, measured from the tape's own timestamps."""
    from datetime import datetime

    stamps: List[float] = []
    for r in rounds[-span:]:
        ts = r.get("ts")
        if not ts:
            continue
        try:
            stamps.append(datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            continue
    gaps = [b - a for a, b in zip(stamps, stamps[1:]) if 0 < (b - a) < 6 * 3_600_000]
    if not gaps:
        return {"ms": 20_000.0, "measured": False, "samples": 0,
                "note": "no usable timestamps — assuming one round every 20 s"}
    gaps.sort()
    med = gaps[len(gaps) // 2]
    # A tape imported in one sitting has near-zero gaps between most rows, which would
    # otherwise inflate rounds-per-window into nonsense. Demand enough samples and a
    # plausible gap before trusting the measurement.
    if len(gaps) < 20 or med < 2_000:
        return {
            "ms": 20_000.0,
            "measured": False,
            "samples": len(gaps),
            "note": (
                "timestamps are too bunched to measure cadence ("
                f"{len(gaps)} usable gaps, median {med / 1000:.1f} s) — assuming one round every 20 s"
            ),
        }
    return {"ms": float(med), "measured": True, "samples": len(gaps),
            "note": f"median gap over the last {len(gaps) + 1} rounds"}


def window_odds(multipliers: Sequence[float], rounds: Sequence[Dict[str, Any]],
                house_edge: float = 0.03,
                thresholds: Sequence[float] = (2.0, 5.0, 10.0, 50.0, 100.0),
                windows: Sequence[Dict[str, Any]] = WINDOWS) -> Dict[str, Any]:
    """P(at least one hit) per threshold per time window, as an interval."""
    cadence = median_interval_ms(rounds)
    per_round = {t: per_round_probability(multipliers, t) for t in thresholds}
    out_windows: List[Dict[str, Any]] = []
    for w in windows:
        n_rounds = int(_clamp(round(w["ms"] / max(cadence["ms"], 1)), 1, 200_000))
        preds = []
        for t in thresholds:
            pr = per_round[t]
            fair = theoretical_survival(t, house_edge)
            preds.append({
                "threshold": t,
                "probability": round(window_probability(pr["p"], n_rounds), 6),
                "ciLow": round(window_probability(pr["ciLow"], n_rounds), 6),
                "ciHigh": round(window_probability(pr["ciHigh"], n_rounds), 6),
                "fairProbability": round(window_probability(fair, n_rounds), 6),
                "expectedHits": round(pr["p"] * n_rounds, 2),
                "currentRun": pr["currentRun"],
            })
        out_windows.append({
            "id": w["id"], "label": w["label"], "ms": w["ms"],
            "expectedRounds": n_rounds, "predictions": preds,
        })
    return {
        "rounds": len(multipliers),
        "houseEdge": house_edge,
        "cadence": cadence,
        "cadenceSeconds": round(cadence["ms"] / 1000, 1),
        "windows": out_windows,
        "perRound": {str(t): per_round[t] for t in thresholds},
        "note": (
            "These are exposure odds, not signals: the chance that a window of this many rounds contains at "
            "least one qualifying round, from the measured rate and the measured cadence. The interval is the "
            "base rate's Wilson interval carried through 1-(1-p)^n. It says nothing about which round."
        ),
    }


def leaderboard(multipliers: Sequence[float],
                thresholds: Sequence[float] = (1.5, 2.0, 3.0, 5.0, 10.0, 20.0)) -> Dict[str, Any]:
    """Walk-forward Brier skill of every component at every threshold."""
    rows: List[Dict[str, Any]] = []
    for t in thresholds:
        s = earned_skill(multipliers, t)
        rows.append({
            "threshold": t,
            "scored": s.get("scored"),
            "baselineBrier": s.get("baselineBrier"),
            "brier": s.get("brier"),
            "skill": s.get("skill"),
            "best": (max((s.get("skill") or {}).items(), key=lambda kv: kv[1])[0]
                     if (s.get("skill") or {}) else None),
            "anySkill": s.get("anySkill", False),
        })
    winners = [r for r in rows if r["anySkill"]]
    return {
        "rounds": len(multipliers),
        "rows": rows,
        "withSkill": len(winners),
        "verdict": (
            f"{len(winners)} of {len(rows)} thresholds show any component beating the measured rate"
            if rows else "no rounds yet"
        ),
        "note": (
            "Scored walk-forward: at every round a component only sees earlier rounds. Positive skill at one "
            "threshold out of six is what multiple testing produces on random data — look for a component that "
            "wins across thresholds and keeps winning as rounds resolve."
        ),
    }
