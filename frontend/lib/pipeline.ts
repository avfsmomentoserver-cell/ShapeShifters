/**
 * Momento forecast pipeline — port of MomentoV5 forecast.py / analysis.py
 * (Markov state transitions, ladder pressure, DNA analogue matching,
 * ensemble candidates, ETA adjustments).
 */
import {
  mean, stdev, quantile, clamp, markovStreaks, clusterLog, detectRegimes,
  exponentialFit, exponentialSurvival, paretoFit, paretoSurvival, hitEta,
  hillAlpha, calibratedSurvival,
  curveShapeDistribution, type ParetoFit, type ExpFit, type ClusterInfo, type RegimeReport,
  type HillTail, type HitEta,
} from "./stats";

export const STATES = ["Collapse", "Shelf", "Normal", "Ignition", "Moonshot"] as const;
export type State = (typeof STATES)[number];

/** AVFS linguistic band ladder — 10 named zones from dust to cosmic. */
export type LingBand =
  | "dust" | "floor" | "low" | "base" | "mid" | "high"
  | "ignition" | "moonshot" | "mega" | "cosmic";

export function lingBand(m: number): LingBand {
  if (m < 1.2) return "dust";
  if (m < 1.5) return "floor";
  if (m < 2.0) return "low";
  if (m < 3.0) return "base";
  if (m < 5.0) return "mid";
  if (m < 10.0) return "high";
  if (m < 20.0) return "ignition";
  if (m < 50.0) return "moonshot";
  if (m < 100.0) return "mega";
  return "cosmic";
}

export interface Round {
  id: number;
  ts: string;
  m: number;
  band?: string | null;
}

// ---------------------------------------------------------------------------
// tape signals (analysis.py)
// ---------------------------------------------------------------------------

export interface Ladder {
  start: number;
  length: number;
  direction: "ascending" | "collapsing";
}

export function detectLadders(multipliers: number[], minLength = 4): Ladder[] {
  const ladders: Ladder[] = [];
  let run = 1;
  let dir: "asc" | "desc" | null = null;
  for (let i = 1; i < multipliers.length; i++) {
    const step = multipliers[i] - multipliers[i - 1];
    const d = step > 0 ? "asc" : step < 0 ? "desc" : null;
    if (d && d === dir) run++;
    else { run = 1; dir = d; }
    if (run >= minLength && dir) {
      ladders.push({ start: i - run + 1, length: run, direction: dir === "asc" ? "ascending" : "collapsing" });
      run = 1; dir = null;
    }
  }
  return ladders;
}

/** Resistance ceilings — round multipliers above which the tape keeps rejecting. */
export function detectCeilings(multipliers: number[], bin = 0.25): number[] {
  const sorted = [...multipliers].sort((a, b) => a - b);
  const top = quantile(sorted, 0.85);
  const buckets = new Map<number, number>();
  for (const m of multipliers) {
    if (m >= top * 0.6 && m <= top * 1.6) {
      const key = Math.round(m / bin) * bin;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  const entries = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  return entries.filter(([_, c]) => c >= 3).slice(0, 3).map(([v]) => v);
}

/** Rolling state label — simplified classify_state from analysis.py. */
export function classifyState(multipliers: number[]): State {
  const w = multipliers.slice(-40);
  if (w.length < 5) return "Normal";
  const p50 = quantile([...w].sort((a, b) => a - b), 0.5);
  const last = w[w.length - 1];
  const recent = w.slice(-5);
  const recentMean = mean(recent);
  const vol = stdev(w) / Math.max(1, p50);

  const ladders = detectLadders(w, 4);
  const asc = ladders.filter((l) => l.direction === "ascending").length;
  const col = ladders.filter((l) => l.direction === "collapsing").length;

  if (last >= 10) return "Moonshot";
  if (recentMean > p50 * 1.6 || (asc >= 1 && vol > 0.5)) return "Ignition";
  if (col >= 2 && recentMean < p50) return "Collapse";
  if (Math.abs(recentMean - p50) < p50 * 0.12 && vol < 0.35) return "Shelf";
  return "Normal";
}

export function stateSequence(multipliers: number[]): State[] {
  const labels: State[] = [];
  for (let i = 0; i < multipliers.length; i++) {
    labels.push(classifyState(multipliers.slice(0, i + 1)));
  }
  return labels;
}

export function transitionMatrix(labels: State[]): Record<State, Record<State, number>> {
  const counts: Record<State, Record<State, number>> = Object.fromEntries(
    STATES.map((a) => [a, Object.fromEntries(STATES.map((b) => [b, 0]))]),
  ) as Record<State, Record<State, number>>;
  for (let i = 0; i < labels.length - 1; i++) counts[labels[i]][labels[i + 1]]++;
  const matrix = {} as Record<State, Record<State, number>>;
  for (const a of STATES) {
    const row = counts[a];
    const total = Object.values(row).reduce((x, y) => x + y, 0);
    matrix[a] = {} as Record<State, number>;
    for (const b of STATES) {
      // Laplace smoothing, mirroring forecast.py
      matrix[a][b] = total === 0 ? 1 / STATES.length : round2((row[b] + 0.5) / (total + STATES.length * 0.5));
    }
  }
  return matrix;
}

const round2 = (v: number) => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------
// ladder pressure & ETA adjustment (forecast.py ladder_eta_adjustment)
// ---------------------------------------------------------------------------

export interface LadderETA {
  pressureScore: number;
  etaAdjustment: number;
  compressionRelease: boolean;
  nearestCeiling: number | null;
  moonshotProbability: number;
}

export function ladderETA(multipliers: number[]): LadderETA {
  if (multipliers.length < 10) {
    return { pressureScore: 0, etaAdjustment: 0, compressionRelease: false, nearestCeiling: null, moonshotProbability: 0.15 };
  }
  const ladders = detectLadders(multipliers, 4);
  const ceilings = detectCeilings(multipliers);
  const last = multipliers[multipliers.length - 1];
  const nearestCeiling = ceilings.length ? Math.min(...ceilings.filter((c) => c > last), last + 3) : null;

  // pressure builds as rounds pile up under a ceiling without breaking it
  const sinceHigh = (() => {
    const lookback = multipliers.slice(-30);
    for (let i = lookback.length - 1; i >= 0; i--) if (lookback[i] >= 5) return lookback.length - i;
    return lookback.length;
  })();
  const pressureScore = clamp(sinceHigh / 30, 0, 1);

  const longest = ladders.length ? Math.max(...ladders.map((l) => l.length)) : 0;
  const compressionRelease = nearestCeiling !== null && pressureScore > 0.6;

  const etaAdjustment = -pressureScore * 5 - longest * 0.3 + (compressionRelease ? -2 : 0);
  const moonshotProbability = clamp(0.05 + pressureScore * 0.55 + (compressionRelease ? 0.15 : 0), 0, 0.95);

  return { pressureScore, etaAdjustment, compressionRelease, nearestCeiling, moonshotProbability };
}

// ---------------------------------------------------------------------------
// DNA — analogue matching: what followed tapes that look like this one?
// ---------------------------------------------------------------------------

export interface DNAReport {
  confidence: number;
  matches: number[];
  outcomes: { mean: number; p25: number; p75: number; pNextMoonRate: number };
}

export function dnaMatch(multipliers: number[], patternLen = 8, topK = 6): DNAReport {
  if (multipliers.length < patternLen * 4) {
    return { confidence: 0, matches: [], outcomes: { mean: 0, p25: 0, p75: 0, pNextMoonRate: 0 } };
  }
  const pattern = multipliers.slice(-patternLen);
  const pNorm = normalize(pattern);
  const scored: Array<{ idx: number; dist: number }> = [];
  for (let i = 0; i <= multipliers.length - patternLen - 3; i++) {
    const cand = multipliers.slice(i, i + patternLen);
    const d = euclidean(normalize(cand), pNorm);
    scored.push({ idx: i, dist: d });
  }
  scored.sort((a, b) => a.dist - b.dist);
  const best = scored.slice(0, topK);
  const outcomes = best.map((s) => {
    const after = multipliers[s.idx + patternLen];
    const next3 = multipliers.slice(s.idx + patternLen, s.idx + patternLen + 3);
    return { after, next3 };
  });
  const afters = outcomes.map((o) => o.after);
  const sortedA = [...afters].sort((a, b) => a - b);
  const moonRate = outcomes.filter((o) => Math.max(o.after, ...o.next3) >= 10).length / (outcomes.length || 1);
  const confidence = clamp(1 - best[0].dist / 2, 0.05, 1) * clamp(outcomes.length / topK, 0, 1);
  return {
    confidence,
    matches: best.map((b) => b.idx),
    outcomes: {
      mean: mean(afters),
      p25: quantile(sortedA, 0.25),
      p75: quantile(sortedA, 0.75),
      pNextMoonRate: moonRate,
    },
  };
}

function normalize(xs: number[]): number[] {
  const m = mean(xs), s = stdev(xs) || 1;
  return xs.map((x) => (x - m) / s);
}
function euclidean(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((acc, v, i) => acc + (v - b[i]) ** 2, 0));
}

// ---------------------------------------------------------------------------
// full analysis payload
// ---------------------------------------------------------------------------

export interface Percentiles {
  p10: number; p25: number; p50: number; p75: number; p90: number; p95: number;
}

export interface Analysis {
  state: State;
  percentiles: Percentiles;
  markov: ReturnType<typeof markovStreaks>;
  stateMatrix: Record<State, Record<State, number>>;
  clusters: ClusterInfo[];
  regimes: RegimeReport;
  pareto: ParetoFit;
  exponential: ExpFit;
  ladder: LadderETA;
  dna: DNAReport;
  shapeDist: Record<"exponential" | "power_law" | "logistic", number>;
  /** Calibrated P(next >= x): empirical bulk + Hill tail, port of survival.py. */
  survivalAt: (x: number) => number;
  /** Recalibrated next-round target: median + 25th/90th percentile of the calibrated curve. */
  target: TargetForecast;
  /** Full-range next-round forecast: p01..p99 ladder + tight/full/extreme intervals. */
  forecast: FullForecast;
  /** Hill tail index over the recent window — a fair tape sits at 1.0. */
  tailAlpha: number;
  /** Expected wait to the next hit at each big-hit threshold, recalibrated every round. */
  hitEtas: Record<"2x" | "5x" | "10x", HitEta>;
  /** Expected wait to the next moonshot / mega / cosmic (20/50/100/1000×), same model. */
  bandHitEtas: Record<BandHitKey, BandEta>;
}

export const BIG_HIT_THRESHOLDS = { "2x": 2, "5x": 5, "10x": 10 } as const;
export type BigHitKey = keyof typeof BIG_HIT_THRESHOLDS;

/**
 * Entry points of the upper AVFS linguistic bands (lingBand): a round enters
 * MOONSHOT at 20×, MEGA at 50×, COSMIC at 100×. 1000× is the mega/cosmic
 * "jackpot" reach the ETAs-to-moonshots panel exists to time. These are the
 * big siblings of BIG_HIT_THRESHOLDS — same calibrated survival, further out
 * on the tail, so they carry a "tail extrapolation" flag more often.
 */
export const BAND_HIT_THRESHOLDS = { "20x": 20, "50x": 50, "100x": 100, "1000x": 1000 } as const;
export type BandHitKey = keyof typeof BAND_HIT_THRESHOLDS;

export interface BandEta {
  key: BandHitKey;
  threshold: number;
  label: string;
  eta: HitEta;
}

export function hitBandEtas(survivalAt: (x: number) => number): Record<BandHitKey, BandEta> {
  const out = {} as Record<BandHitKey, BandEta>;
  (Object.keys(BAND_HIT_THRESHOLDS) as BandHitKey[]).forEach((k) => {
    const threshold = BAND_HIT_THRESHOLDS[k];
    out[k] = { key: k, threshold, label: k.replace("x", "×"), eta: hitEta(survivalAt, threshold) };
  });
  return out;
}

export function analyze(multipliers: number[]): Analysis {
  const sorted = [...multipliers].sort((a, b) => a - b);
  const states = stateSequence(multipliers);
  // The ETAs, per-candidate reach probabilities, and the headline target all
  // come from the calibrated empirical + Hill-tail estimator, not the legacy
  // exp/pareto blend: on a fair tape the blend claims ~94% for 2x where the
  // truth is ~48%, and a wait time is just 1/p — a 2x error in p is a 2x
  // error in every ETA. The legacy engine is retired from Analysis entirely.
  const window = multipliers.slice(-600);
  const tail = hillAlpha(window);
  const survivalAt = (x: number) => calibratedSurvival(window, x, tail);
  const hitEtas = {} as Analysis["hitEtas"];
  (Object.keys(BIG_HIT_THRESHOLDS) as BigHitKey[]).forEach((k) => {
    hitEtas[k] = hitEta(survivalAt, BIG_HIT_THRESHOLDS[k]);
  });
  return {
    state: states[states.length - 1] ?? "Normal",
    percentiles: {
      p10: quantile(sorted, 0.10), p25: quantile(sorted, 0.25), p50: quantile(sorted, 0.50),
      p75: quantile(sorted, 0.75), p90: quantile(sorted, 0.90), p95: quantile(sorted, 0.95),
    },
    markov: markovStreaks(multipliers),
    stateMatrix: transitionMatrix(states.slice(-300)),
    clusters: clusterLog(multipliers.slice(-500)),
    regimes: detectRegimes(multipliers),
    pareto: paretoFit(multipliers),
    exponential: exponentialFit(multipliers),
    ladder: ladderETA(multipliers),
    dna: dnaMatch(multipliers),
    shapeDist: curveShapeDistribution(multipliers),
    survivalAt,
    target: targetForecast(survivalAt),
    forecast: fullForecast(survivalAt),
    tailAlpha: tail.alpha,
    hitEtas,
    bandHitEtas: hitBandEtas(survivalAt),
  };
}

// ---------------------------------------------------------------------------
// ensemble candidates — ranked forecast for the next round (forecast.py)
// ---------------------------------------------------------------------------

export interface Candidate {
  state: State;
  probability: number;
  range: [number, number];
  expectedValue: number;
  drivers: string[];
  /** The target this candidate is aiming at, and the calibrated wait to it. */
  bandMid: number;
  pReach: number; // P(crash >= band mid) — one-round reach probability
  eta: HitEta;    // expected rounds to the next crash >= band mid
}

function bandFor(state: State, p: Percentiles): [number, number] {
  const table: Record<State, [number, number]> = {
    Normal: [Math.max(1.0, p.p25), Math.max(1.1, p.p75)],
    Collapse: [1.0, Math.max(1.1, p.p25)],
    Shelf: [Math.max(1.0, p.p25), Math.max(1.2, p.p50)],
    Ignition: [Math.max(1.5, p.p75), Math.max(5, p.p95)],
    Moonshot: [Math.max(5, p.p90), Math.max(20, p.p95 * 3)],
  };
  const [lo, hi] = table[state];
  return [round2(Math.max(1, lo)), round2(Math.max(lo + 0.05, hi))];
}

export function candidates(multipliers: number[], a: Analysis): Candidate[] {
  if (multipliers.length < 8) return [];
  const markovRow = a.stateMatrix[a.state];
  const dnaWeight = clamp(a.dna.confidence * 0.35, 0, 0.35);
  const overdueTilt = clamp(a.ladder.pressureScore * 0.2, 0, 0.2);
  const ladderTilt = a.ladder.moonshotProbability > 0.6
    ? clamp((a.ladder.moonshotProbability - 0.6) * 0.5, 0, 0.25) : 0;

  const raw: Array<{ state: State; p: number; drivers: string[] }> = STATES.map((s) => {
    let p = markovRow[s];
    const drivers: string[] = [`Markov ${a.state}→${s}: ${round2(markovRow[s])}`];
    if (s === "Moonshot" || s === "Ignition") {
      const tilt = overdueTilt + ladderTilt + a.dna.outcomes.pNextMoonRate * dnaWeight;
      p += tilt;
      if (overdueTilt > 0.05) drivers.push(`Ladder pressure +${round2(overdueTilt)}`);
      if (ladderTilt > 0) drivers.push(`Release pattern +${round2(ladderTilt)}`);
      if (a.dna.outcomes.pNextMoonRate > 0.2) drivers.push(`DNA analogue moon-rate ${round2(a.dna.outcomes.pNextMoonRate)}`);
    }
    if (s === "Collapse" && a.regimes.current === "high_vol") {
      p += 0.06;
      drivers.push("High-vol regime");
    }
    return { state: s, p, drivers };
  });

  const total = raw.reduce((acc, c) => acc + c.p, 0) || 1;
  return raw
    .map((c) => {
      const band = bandFor(c.state, a.percentiles);
      const [lo, hi] = band;
      const mid = Math.max(lo, (lo + hi) / 2);
      const reach = hitEta(a.survivalAt, mid);
      return {
        state: c.state,
        probability: c.p / total,
        range: band,
        expectedValue: (lo + hi) / 2 * (c.p / total),
        drivers: c.drivers,
        bandMid: round2(mid),
        pReach: reach.pReach,
        eta: reach,
      };
    })
    .sort((x, y) => y.probability - x.probability);
}

/**
 * Invert the calibrated survival curve: returns x where P(next round >= x) = s0,
 * i.e. the (1 − s0)-quantile of the forecast next-round distribution.
 *
 * s0 = 0.5  -> median of the forecast
 * s0 = 0.75 -> 25th percentile   (P(crash <= x) = 0.25)
 * s0 = 0.10 -> 90th percentile   (P(crash <= x) = 0.90)
 *
 * Bisection on the monotone-decreasing survival, capped at maxX. This is a
 * *forward* forecast of the next round (over the recent window), unlike the
 * legacy estimatedCrashPoint which is the historical median of every crash.
 */
export function calibratedQuantile(survivalAt: (x: number) => number, s0: number, maxX = 1e5): number {
  const s = (x: number) => clamp(survivalAt(x), 0, 1);
  if (s0 <= 0) return maxX;
  if (s0 >= 1) return 1;
  let lo = 1; // s(lo) = 1 >= s0 (s0 < 1)
  let hi = 2;
  while (s(hi) > s0 && hi < maxX) hi *= 2;
  hi = Math.min(hi, maxX);
  if (s(hi) > s0) return maxX; // never crossed within the cap
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (s(mid) >= s0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-3) break;
  }
  return round2((lo + hi) / 2);
}

/**
 * Recalibrated next-round target: the median of the calibrated survival
 * distribution plus its 25th/90th percentiles (the same percentile span the
 * legacy "round CI" used, now computed from the empirical + Hill-tail model
 * over the recent window instead of the historical median of all crashes).
 */
export interface TargetForecast {
  median: number;
  p25: number;
  p90: number;
}

export function targetForecast(survivalAt: (x: number) => number): TargetForecast {
  return {
    median: calibratedQuantile(survivalAt, 0.5),
    p25: calibratedQuantile(survivalAt, 0.75),
    p90: calibratedQuantile(survivalAt, 0.1),
  };
}

/**
 * Full-range forecast of the next round, sampled off the calibrated survival
 * curve at every percentile the UI might display. A plain p25–p90 band is too
 * loose to be an "expected target value"; the IQR (p25–p75) is the tight 50%
 * interval, p05–p95 the full 90%, and p01–p99 the 98% envelope that lets a
 * 55.98x-style tail target show up on the scale instead of clamping at 20x.
 *
 * All quantiles are forward forecasts of the *next* round (last 600-round
 * window), not historical percentiles.
 */
export interface FullForecast {
  p01: number;
  p05: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  /** Tight 50% interval (IQR). */
  tight: [number, number];
  /** Full 90% interval. */
  full: [number, number];
  /** 98% envelope — carries the extreme tail. */
  extreme: [number, number];
  /** IQR width, p75 − p25. */
  iqr: number;
}

export function fullForecast(survivalAt: (x: number) => number): FullForecast {
  const p01 = calibratedQuantile(survivalAt, 0.99);
  const p05 = calibratedQuantile(survivalAt, 0.95);
  const p10 = calibratedQuantile(survivalAt, 0.9);
  const p25 = calibratedQuantile(survivalAt, 0.75);
  const p50 = calibratedQuantile(survivalAt, 0.5);
  const p75 = calibratedQuantile(survivalAt, 0.25);
  const p90 = calibratedQuantile(survivalAt, 0.1);
  const p95 = calibratedQuantile(survivalAt, 0.05);
  const p99 = calibratedQuantile(survivalAt, 0.01);
  return {
    p01, p05, p10, p25, p50, p75, p90, p95, p99,
    tight: [round2(p25), round2(p75)],
    full: [round2(p05), round2(p95)],
    extreme: [round2(p01), round2(p99)],
    iqr: round2(p75 - p25),
  };
}

/**
 * A log-spaced sample of the calibrated survival curve for charting. Linear
 * 1..20 sampling wastes the whole chart under 2x and clamps any real target
 * (6x, 55.98x) off-scale; geometric spacing keeps equal *multiples* per grid
 * cell so the tail is readable at any magnitude.
 */
export function survivalCurveLog(a: Analysis, maxX = 120, steps = 70): Array<{ x: number; p: number }> {
  const lo = Math.log(1);
  const hi = Math.log(maxX);
  return Array.from({ length: steps }, (_, i) => {
    const x = Math.exp(lo + (hi - lo) * (i / (steps - 1)));
    return { x: round2(x), p: a.survivalAt(x) };
  });
}

/** Survival-curve samples for the ETA chart. */
export function survivalCurve(a: Analysis, max = 20, steps = 60): Array<{ x: number; p: number }> {
  return Array.from({ length: steps }, (_, i) => {
    const x = 1 + (max - 1) * (i / (steps - 1));
    return { x: round2(x), p: a.survivalAt(x) };
  });
}

/** Ensemble exceedance probability P(next >= threshold) — exponential + Pareto blend. */
export function probabilityAbove(a: Analysis, threshold: number, multipliers: number[]): number {
  const exp = exponentialSurvival(a.exponential, threshold);
  const par = paretoSurvival(a.pareto, threshold);
  const w = clamp((threshold - 2) / 4, 0, 1);
  const base = exp * (1 - w) + par * w;
  const ladderBoost = threshold >= 5 ? a.ladder.moonshotProbability * 0.3 : 0;
  return clamp(base + ladderBoost, 0.001, 0.999);
}
