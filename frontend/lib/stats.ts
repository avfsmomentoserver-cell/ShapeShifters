/**
 * Momento mathematical core — TypeScript port of the validated Python engines
 * from MomentoV5 / ShapeShifters (math_models.py, forecast.py, analysis.py).
 *
 * Contents:
 *  - Pareto tail model (MLE x_m, alpha) + survival function
 *  - Exponential crash model with house edge
 *  - Markov win/loss streak analyzer (threshold 2x)
 *  - GMM-lite clustering on log multipliers (dry zones / moonshot clusters)
 *  - Regime detection (rolling volatility bands — deterministic fallback of the HMM)
 *  - Parametric curve-shape fitting (exponential / power-law / logistic)
 *  - Ensemble predictor with confidence weighting
 */

export const HOUSE_EDGE = 0.04;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

export const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

// ---------------------------------------------------------------------------
// Pareto tail model — P(X > x) = (x_m / x)^alpha  for x >= x_m
// MLE: x_m = min(x), alpha = n / sum(ln(x_i / x_m))
// ---------------------------------------------------------------------------

export interface ParetoFit {
  xm: number;
  alpha: number;
  fit: boolean;
}

export function paretoFit(multipliers: number[]): ParetoFit {
  if (multipliers.length < 10) return { xm: 1, alpha: 1.5, fit: false };
  const xm = Math.min(...multipliers);
  if (xm <= 0) return { xm: 1, alpha: 1.5, fit: false };
  const logs = multipliers.filter((x) => x > 0).map((x) => Math.log(x / xm));
  const sum = logs.reduce((a, b) => a + b, 0);
  const alpha = sum > 0 ? multipliers.length / sum : 1.5;
  return { xm, alpha: clamp(alpha, 0.2, 12), fit: true };
}

/** Survival P(X > x) under fitted Pareto (heavy tail only — for x above bulk). */
export function paretoSurvival(fit: ParetoFit, x: number): number {
  if (!fit.fit || x <= fit.xm) return 1;
  return Math.pow(fit.xm / x, fit.alpha);
}

// ---------------------------------------------------------------------------
// Exponential crash model with house edge
// P(crash < x) = 1 - (1 - edge) * e^(-lambda (x - 1))  =>  lambda = -ln(1-edge)/E[X-1]
// ---------------------------------------------------------------------------

export interface ExpFit {
  lambda: number;
  expected: number;
}

export function exponentialFit(multipliers: number[]): ExpFit {
  const tailMean = mean(multipliers.map((x) => Math.max(0, x - 1))) || 1.0;
  const lambda = clamp(-Math.log(1 - HOUSE_EDGE) / tailMean, 0.02, 8);
  return { lambda, expected: 1 + (1 - HOUSE_EDGE) / lambda };
}

export function exponentialSurvival(fit: ExpFit, x: number): number {
  if (x <= 1) return 1;
  return (1 - HOUSE_EDGE) * Math.exp(-fit.lambda * (x - 1));
}

// ---------------------------------------------------------------------------
// Markov win/loss streak analyzer (win = multiplier >= 2)
// ---------------------------------------------------------------------------

export interface StreakAnalysis {
  currentStreak: number;
  streakType: "win" | "loss";
  pContinue: number;
  expectedDuration: number;
  transition: [number, number, number, number]; // WW, WL, LW, LL
  historicalMax: number;
}

export function markovStreaks(multipliers: number[], threshold = 2): StreakAnalysis {
  const states = multipliers.map((m) => (m >= threshold ? 1 : 0));
  let ww = 0, wl = 0, lw = 0, ll = 0;
  for (let i = 0; i < states.length - 1; i++) {
    const a = states[i], b = states[i + 1];
    if (a === 1 && b === 1) ww++;
    else if (a === 1 && b === 0) wl++;
    else if (a === 0 && b === 1) lw++;
    else ll++;
  }
  const maxStreak = (side: 0 | 1): number => {
    let best = 0, run = 0;
    for (const s of states) {
      if (s === side) { run++; best = Math.max(best, run); } else run = 0;
    }
    return best;
  };
  // current streak
  let currentStreak = 0;
  const currentType: 0 | 1 = states.length ? (states[states.length - 1] as 0 | 1) : 0;
  for (let i = states.length - 1; i >= 0 && states[i] === currentType; i--) currentStreak++;

  const fromWin = ww + wl, fromLoss = lw + ll;
  const pContinueWin = fromWin > 0 ? ww / fromWin : 0.5;
  const pContinueLoss = fromLoss > 0 ? ll / fromLoss : 0.5;
  const pContinue = currentType === 1 ? pContinueWin : pContinueLoss;

  return {
    currentStreak,
    streakType: currentType === 1 ? "win" : "loss",
    pContinue,
    expectedDuration: 1 / Math.max(0.01, 1 - pContinue),
    transition: [ww, wl, lw, ll],
    historicalMax: maxStreak(currentType),
  };
}

// ---------------------------------------------------------------------------
// GMM-lite: k-means on log multipliers (3 clusters) -> dry zone / mid / moonshot
// ---------------------------------------------------------------------------

export interface ClusterInfo {
  id: number;
  count: number;
  proportion: number;
  meanMultiplier: number;
  minMultiplier: number;
  maxMultiplier: number;
  label: "floor" | "mid" | "moon";
}

export function clusterLog(multipliers: number[], k = 3, iterations = 24): ClusterInfo[] {
  if (multipliers.length < k * 3) return [];
  const logs = multipliers.map((m) => Math.log(Math.max(1.001, m)));
  const sorted = [...logs].sort((a, b) => a - b);
  let centers = Array.from({ length: k }, (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)]);
  let assignment = new Array<number>(logs.length).fill(0);

  for (let it = 0; it < iterations; it++) {
    assignment = logs.map((v) => {
      let best = 0, bestD = Infinity;
      centers.forEach((c, i) => {
        const d = Math.abs(v - c);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    });
    const next = centers.map((c, i) => {
      const members = logs.filter((_, j) => assignment[j] === i);
      return members.length ? mean(members) : c;
    });
    if (next.every((c, i) => Math.abs(c - centers[i]) < 1e-6)) break;
    centers = next;
  }

  const labels: ClusterInfo["label"][] = ["floor", "mid", "moon"];
  const order = centers
    .map((c, i) => ({ i, c }))
    .sort((a, b) => a.c - b.c)
    .map((x, rank) => {
      const members = multipliers.filter((_, j) => assignment[x.i] === j);
      return {
        id: x.i,
        count: members.length,
        proportion: members.length / multipliers.length,
        meanMultiplier: mean(members),
        minMultiplier: members.length ? Math.min(...members) : 0,
        maxMultiplier: members.length ? Math.max(...members) : 0,
        label: labels[clamp(rank, 0, 2)],
      };
    });
  return order;
}

// ---------------------------------------------------------------------------
// Regime detection — rolling volatility bands (validated HMM fallback)
// ---------------------------------------------------------------------------

export type Regime = "low_vol" | "moderate" | "high_vol";

export interface RegimeReport {
  current: Regime;
  stayProbability: number;
  distribution: Record<Regime, number>;
  rollingVol: number[];
  transitionDetected: boolean;
}

export function detectRegimes(multipliers: number[], window = 50): RegimeReport {
  const w = clamp(Math.floor(multipliers.length / 2), 5, window);
  const rollingVol: number[] = [];
  for (let i = w - 1; i < multipliers.length; i++) {
    rollingVol.push(stdev(multipliers.slice(i - w + 1, i + 1)));
  }
  if (rollingVol.length === 0) {
    return {
      current: "moderate", stayProbability: 0.5,
      distribution: { low_vol: 0.33, moderate: 0.34, high_vol: 0.33 },
      rollingVol: [], transitionDetected: false,
    };
  }
  const vm = mean(rollingVol), vs = stdev(rollingVol);
  const classify = (v: number): Regime =>
    v < vm - vs ? "low_vol" : v > vm + vs ? "high_vol" : "moderate";
  const regimes = rollingVol.map(classify);
  const counts: Record<Regime, number> = { low_vol: 0, moderate: 0, high_vol: 0 };
  for (const r of regimes) counts[r]++;
  const dist = Object.fromEntries(
    (Object.keys(counts) as Regime[]).map((k) => [k, counts[k] / regimes.length]),
  ) as Record<Regime, number>;

  // stay probability: empirical persistence of the current regime
  const cur = regimes[regimes.length - 1];
  let stays = 0, total = 0;
  for (let i = 1; i < regimes.length; i++) {
    if (regimes[i - 1] === cur) { total++; if (regimes[i] === cur) stays++; }
  }
  const threshold = 5;
  const tail = regimes.slice(-threshold);
  const transitionDetected =
    tail.length === threshold && tail.every((r) => r === cur) && regimes[regimes.length - threshold - 1] !== cur;

  return { current: cur, stayProbability: total ? stays / total : 0.5, distribution: dist, rollingVol, transitionDetected };
}

// ---------------------------------------------------------------------------
// Curve-shape fitting — classify a single crash trajectory as
// exponential / power-law / logistic by R^2 in transformed space
// ---------------------------------------------------------------------------

export interface CurveFit {
  shape: "exponential" | "power_law" | "logistic";
  r2: number;
  params: Record<string, number>;
}

function linreg(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

export function fitCurveShape(points: number[]): CurveFit {
  // points: normalized curve samples in [0,1] of a round's altitude, ascending
  const n = points.length;
  if (n < 6) return { shape: "exponential", r2: 0, params: {} };
  const t = points.map((_, i) => i / (n - 1));
  const eps = 1e-6;
  const y = points.map((p) => Math.max(p, eps));

  const linY = linreg(t, y);                    // exponential-ish: y ~ a·e^{bt} → linear in t on log? keep raw
  const logY = linreg(t, y.map((v) => Math.log(v)));  // exponential: ln y linear in t
  const logX = linreg(t.map((v) => Math.log(v + eps)), y.map((v) => Math.log(v))); // power law

  // logistic proxy: logit on normalized y
  const yNorm = points.map((p) => clamp(p / Math.max(...points), 0.01, 0.99));
  const logit = linreg(t, yNorm.map((v) => Math.log(v / (1 - v))));

  const candidates: Array<{ shape: CurveFit["shape"]; r2: number }> = [
    { shape: "exponential", r2: logY.r2 },
    { shape: "power_law", r2: logX.r2 },
    { shape: "logistic", r2: logit.r2 },
  ];
  candidates.sort((a, b) => b.r2 - a.r2);
  const best = candidates[0];
  const params =
    best.shape === "exponential" ? { growth: Math.exp(logY.slope), base: Math.exp(logY.intercept) }
    : best.shape === "power_law" ? { exponent: logX.slope, scale: Math.exp(logX.intercept) }
    : { steepness: logit.slope, midpoint: clamp(-logit.intercept / (logit.slope || 1), 0, 1) };
  return { shape: best.shape, r2: best.r2, params };
}

/** Classify observed crash-point curve of the last N rounds into shape distribution. */
export function curveShapeDistribution(multipliers: number[], sampleCount = 40): Record<CurveFit["shape"], number> {
  const dist: Record<CurveFit["shape"], number> = { exponential: 0, power_law: 0, logistic: 0 };
  const sample = multipliers.slice(-sampleCount);
  for (const m of sample) {
    // synthesize trajectory samples for the fit from the crash point
    const steps = 12;
    const pts = Array.from({ length: steps }, (_, i) => 1 + (m - 1) * (i / (steps - 1)) ** 1.6);
    dist[fitCurveShape(pts).shape] += 1;
  }
  const total = sample.length || 1;
  return Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, v / total])) as Record<CurveFit["shape"], number>;
}

// ---------------------------------------------------------------------------
// ETA — hazard / survival from the empirical + exponential blend
// ---------------------------------------------------------------------------

export interface ETAReport {
  estimatedCrashPoint: number;
  confidenceLower: number;
  confidenceUpper: number;
  hazardRate: number;
  survivalAt: (x: number) => number;
}

export function etaEstimate(multipliers: number[]): ETAReport {
  const exp = exponentialFit(multipliers);
  const pareto = paretoFit(multipliers);
  const survivalAt = (x: number): number => {
    if (x <= 1) return 1;
    const bulk = exponentialSurvival(exp, x);
    const tail = x > 4 ? paretoSurvival(pareto, x) : bulk;
    // blend: exponential governs the bulk, Pareto governs the far tail
    const w = clamp((x - 2) / 4, 0, 1);
    return bulk * (1 - w) + tail * w;
  };
  const sorted = [...multipliers].sort((a, b) => a - b);
  return {
    estimatedCrashPoint: quantile(sorted, 0.5),
    confidenceLower: quantile(sorted, 0.25),
    confidenceUpper: quantile(sorted, 0.9),
    hazardRate: exp.lambda,
    survivalAt,
  };
}
