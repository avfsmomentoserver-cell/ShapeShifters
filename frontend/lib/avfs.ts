/**
 * AVFS full-intelligence engine — TypeScript port of the momento-avfs-core
 * feature stack: resistance ceilings + gap pressure (features/pressure),
 * exhaustion (features/moonshot_scanner/exhaustion), moonshot condition
 * scanner, mega pressure middleware (invent/middleware/megaPressure),
 * ladder collapse detection (features/band_analysis/ladders), DNA pattern
 * discovery (momento/pattern_discovery_dna) and the autopilot decision
 * blender (momento/autopilot). Constants match the Python originals.
 */
import { lingBand, type LingBand } from "./pipeline";

export { lingBand, type LingBand };

const BAND_ORDER: LingBand[] = [
  "dust", "floor", "low", "base", "mid", "high", "ignition", "moonshot", "mega", "cosmic",
];

export function bandIndex(b: LingBand): number {
  return BAND_ORDER.indexOf(b);
}

// ---------------------------------------------------------------------------
// Resistance ceilings (features/pressure/detector.py)
// ---------------------------------------------------------------------------

export interface Ceiling {
  level: number;
  touches: number;
  firstTouch: number;
  lastTouch: number;
  archetype: "ascending" | "descending" | "stable";
}

/** Find local maxima, cluster within 5% tolerance, classify archetype. */
export function detectCeilings(mults: number[], minTouches = 3, tolerance = 0.05): Ceiling[] {
  const maxima: number[] = [];
  for (let i = 1; i < mults.length - 1; i++) {
    if (mults[i] > mults[i - 1] && mults[i] > mults[i + 1]) maxima.push(i);
  }

  const clusters: Array<{ level: number; idx: number[] }> = [];
  for (const idx of maxima) {
    const v = mults[idx];
    const hit = clusters.find((c) => Math.abs(v - c.level) <= tolerance * c.level);
    if (hit) hit.idx.push(idx);
    else clusters.push({ level: v, idx: [idx] });
  }

  const ceilings: Ceiling[] = [];
  for (const c of clusters) {
    if (c.idx.length < minTouches) continue;
    ceilings.push({
      level: Math.round(c.level * 100) / 100,
      touches: c.idx.length,
      firstTouch: c.idx[0],
      lastTouch: c.idx[c.idx.length - 1],
      archetype: classifyArchetype(c.idx.map((i) => mults[i])),
    });
  }
  return ceilings.sort((a, b) => a.level - b.level);
}

function classifyArchetype(values: number[]): Ceiling["archetype"] {
  const n = values.length;
  if (n < 2) return "stable";
  const sumX = (n * (n - 1)) / 2;
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = values.reduce((a, y, x) => a + x * y, 0);
  const sumX2 = values.reduce((a, _, x) => a + x * x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return "stable";
  const slope = (n * sumXY - sumX * sumY) / denom;
  const yMean = sumY / n;
  const ssTot = values.reduce((a, y) => a + (y - yMean) ** 2, 0);
  if (ssTot === 0) return "stable";
  const intercept = (sumY - slope * sumX) / n;
  const ssRes = values.reduce((a, y, x) => a + (y - (slope * x + intercept)) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  if (r2 < 0.3) return "stable";
  if (slope > 0.01) return "ascending";
  if (slope < -0.01) return "descending";
  return "stable";
}

// ---------------------------------------------------------------------------
// Gap pressure (features/pressure/calculator.py)
// ---------------------------------------------------------------------------

export interface CeilingPressure {
  totalPressure: number;
  byCeiling: Array<{ level: number; archetype: string; pressure: number; touches: number; distance: number }>;
  dominant: CeilingPressure["byCeiling"][number] | null;
  releaseProbability: number;
  imminentRanges: Array<[number, number]>;
}

/** Energy stored under a ceiling: proximity × touch frequency × approach velocity. */
export function gapEnergy(current: number, ceiling: number, history: number[]): number {
  if (current >= ceiling) return 0;
  const distance = ceiling - current;
  if (distance <= 0) return 0;

  const changes: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const d = history[i] - history[i - 1];
    if (d > 0) changes.push(d);
  }
  const velocity = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;

  const tol = 0.05 * ceiling;
  const touches = history.filter((v) => Math.abs(v - ceiling) <= tol).length;

  const proximity = 1 / (distance + 0.1);
  const frequency = Math.min(touches / 5, 2);
  const vel = Math.min(velocity * 10, 2);
  return Math.min(proximity * frequency * vel * 10, 100);
}

export function ceilingPressure(mults: number[], ceilings: Ceiling[], historyWindow = 20): CeilingPressure {
  const empty: CeilingPressure = {
    totalPressure: 0, byCeiling: [], dominant: null, releaseProbability: 0, imminentRanges: [],
  };
  if (!mults.length || !ceilings.length) return empty;
  const current = mults[mults.length - 1];
  const history = mults.slice(-historyWindow);

  const byCeiling = ceilings
    .filter((c) => c.level > current)
    .map((c) => ({
      level: c.level,
      archetype: c.archetype,
      pressure: Math.round(gapEnergy(current, c.level, history) * 100) / 100,
      touches: c.touches,
      distance: Math.round((c.level - current) * 100) / 100,
    }))
    .sort((a, b) => b.pressure - a.pressure);

  if (!byCeiling.length) return empty;
  const total = Math.min(byCeiling.reduce((a, c) => a + c.pressure, 0), 100);
  return {
    totalPressure: Math.round(total * 10) / 10,
    byCeiling,
    dominant: byCeiling[0],
    releaseProbability: Math.round(Math.min(total / 100, 1) * 100) / 100,
    imminentRanges: byCeiling.filter((c) => c.pressure > 70).map((c) => [c.level - 0.1, c.level + 0.1] as [number, number]),
  };
}

// ---------------------------------------------------------------------------
// Exhaustion (features/moonshot_scanner/exhaustion.py)
// ---------------------------------------------------------------------------

export interface Exhaustion {
  combined: number;
  imminence: "critical" | "high" | "moderate" | "low";
  pressure: { buildup: number; peak: number; trend: string; score: number };
  compression: { current: number; historicalMax: number; saturation: number; score: number };
  ceiling: { proximityDuration: number; nearest: Ceiling | null; decay: number; score: number };
}

function pstdev(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

export function computeExhaustion(mults: number[], pressureHistory: number[], ceilings: Ceiling[]): Exhaustion {
  // pressure exhaustion: how long pressure has been ≥50 without release
  let buildup = 0;
  for (let i = pressureHistory.length - 1; i >= 0; i--) {
    if (pressureHistory[i] >= 50) buildup++;
    else break;
  }
  const recentP = pressureHistory.slice(-10);
  const trend = recentP.length >= 3
    ? recentP[recentP.length - 1] > recentP[0] ? "increasing" : recentP[recentP.length - 1] < recentP[0] ? "decreasing" : "stable"
    : "unknown";
  const peak = Math.max(...(pressureHistory.slice(-20).length ? pressureHistory.slice(-20) : [0]));
  const pScore = Math.min(1, (buildup / 30) * 0.6 + (peak / 100) * 0.4);

  // compression exhaustion: 1/(CV+1) vs historical max over 20-round windows
  const W = 20;
  let cScore = 0, cCur = 0, cMax = 0, cSat = 0;
  if (mults.length >= W) {
    const comp = (xs: number[]) => 1 / (pstdev(xs) / (xs.reduce((a, b) => a + b, 0) / xs.length || 1) + 1);
    cCur = comp(mults.slice(-W));
    let max = cCur;
    for (let i = W; i < mults.length; i++) {
      const c = comp(mults.slice(i - W, i));
      if (c > max) max = c;
    }
    cMax = max;
    cSat = max > 0 ? cCur / max : 0;
    cScore = Math.min(1, cSat * 0.5 + cCur * 0.5);
  }

  // ceiling exhaustion: time spent near the nearest ceiling without breakthrough
  let ceScore = 0, proxDuration = 0, decay = 0;
  const current = mults[mults.length - 1] ?? 0;
  let nearest: Ceiling | null = null;
  let minDist = Infinity;
  for (const c of ceilings) {
    if (c.level > current && c.level - current < minDist) {
      minDist = c.level - current;
      nearest = c;
    }
  }
  if (nearest && mults.length >= 10) {
    const proxThreshold = minDist * 1.5;
    for (let i = mults.length - 1; i >= 0; i--) {
      if (mults[i] >= nearest.level - proxThreshold) proxDuration++;
      else break;
    }
    const proximities = mults.slice(-10).map((m) => nearest!.level - m).filter((d) => d > 0);
    if (proximities.length >= 2) {
      decay = Math.max(0, Math.min(1, (proximities[0] - proximities[proximities.length - 1]) / proximities[0]));
    }
    ceScore = Math.min(1, (proxDuration / 20) * 0.6 + decay * 0.4);
  }

  const combined = pScore * 0.4 + cScore * 0.35 + ceScore * 0.25;
  return {
    combined: Math.round(combined * 1000) / 1000,
    imminence: combined >= 0.75 ? "critical" : combined >= 0.55 ? "high" : combined >= 0.35 ? "moderate" : "low",
    pressure: { buildup, peak: Math.round(peak * 100) / 100, trend, score: Math.round(pScore * 1000) / 1000 },
    compression: { current: r3(cCur), historicalMax: r3(cMax), saturation: r3(cSat), score: r3(cScore) },
    ceiling: { proximityDuration: proxDuration, nearest, decay: r3(decay), score: r3(ceScore) },
  };
}

function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Mega pressure middleware (invent/middleware/megaPressure.ts)
// ---------------------------------------------------------------------------

export interface MegaPressure {
  currentPressure: number;
  avgMegaGap: number;
  avgMiniMoonshots: number;
  energyBuildup: number;
  shapeConsistency: number;
  bandMomentum: number;
  timeDecay: number;
  megaCount: number;
  pressureHistory: number[];
  miniPatterns: Array<{ description: string; confidence: number }>;
}

/** Band-based pressure between mega rounds. Weights: energy .3, shape .2, momentum .2, time .2, gap .1. */
export function megaPressure(mults: number[], megaMin = 50, timestamps?: string[]): MegaPressure {
  const empty: MegaPressure = {
    currentPressure: 0.5, avgMegaGap: 0, avgMiniMoonshots: 0, energyBuildup: 0,
    shapeConsistency: 0, bandMomentum: 0, timeDecay: 0, megaCount: 0, pressureHistory: [], miniPatterns: [],
  };
  if (mults.length < 20) return empty;

  const megaIdx = mults.map((m, i) => (m >= megaMin ? i : -1)).filter((i) => i >= 0);
  const gaps: number[] = [];
  for (let k = 0; k < megaIdx.length - 1; k++) gaps.push(megaIdx[k + 1] - megaIdx[k]);
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

  let miniTotal = 0;
  for (let k = 0; k < megaIdx.length - 1; k++) {
    for (let i = megaIdx[k] + 1; i < megaIdx[k + 1]; i++) {
      if (mults[i] >= 10 && mults[i] < 50) miniTotal++;
    }
  }
  const avgMini = megaIdx.length > 1 ? miniTotal / (megaIdx.length - 1) : 0;

  const energy = energyBuildup(mults);
  const shape = shapeConsistency(mults);
  const momentum = bandMomentum(mults);

  let timeDecay = 1;
  if (megaIdx.length) {
    const lastMegaI = megaIdx[megaIdx.length - 1];
    const ts = timestamps?.[lastMegaI];
    if (ts) {
      const hours = Math.max(0, (Date.now() - new Date(ts).getTime()) / 3_600_000);
      timeDecay = Math.min(hours / 24, 1);
    } else {
      timeDecay = Math.min((mults.length - 1 - lastMegaI) / Math.max(avgGap, 1), 1);
    }
  }

  const gapFactor = avgGap > 0 ? Math.min(avgGap / 500, 1) : 0.5;
  const pressure = energy * 0.3 + shape * 0.2 + momentum * 0.2 + timeDecay * 0.2 + gapFactor * 0.1;

  // pressure history over rolling 100-round windows, step 50
  const history: number[] = [];
  for (let i = 100; i < mults.length; i += 50) {
    const w = mults.slice(i - 100, i);
    history.push((energyBuildup(w) + shapeConsistency(w) + bandMomentum(w)) / 3);
  }

  const patterns: Array<{ description: string; confidence: number }> = [];
  const recentMinis = mults.slice(-200).filter((m) => m >= 10 && m < 50).length;
  if (recentMinis > 5) patterns.push({ description: "Mini moonshot clustering detected", confidence: Math.min(recentMinis / 20, 0.9) });
  if (megaIdx.length) {
    const preMega = mults.slice(Math.max(0, megaIdx[megaIdx.length - 1] - 20), megaIdx[megaIdx.length - 1]);
    const preIgnition = preMega.filter((m) => m >= 10 && m < 20).length;
    if (preIgnition > 2) patterns.push({ description: "Pre-mega ignition pattern", confidence: Math.min(preIgnition / 10, 0.85) });
  }

  return {
    currentPressure: pressure,
    avgMegaGap: Math.round(avgGap * 10) / 10,
    avgMiniMoonshots: Math.round(avgMini * 100) / 100,
    energyBuildup: energy,
    shapeConsistency: shape,
    bandMomentum: momentum,
    timeDecay,
    megaCount: megaIdx.length,
    pressureHistory: history.map((p) => r3(p)),
    miniPatterns: patterns,
  };
}

function energyBuildup(mults: number[]): number {
  const recent = mults.slice(-50);
  if (recent.length < 10) return 0;
  return Math.min(recent.filter((m) => m >= 5).length / recent.length, 1);
}

function shapeConsistency(mults: number[]): number {
  const v = mults.slice(-100);
  if (v.length < 20) return 0.5;
  let consistent = 0;
  for (let i = 2; i < v.length; i++) {
    if (v[i - 1] > v[i - 2] === v[i] > v[i - 1]) consistent++;
  }
  return consistent / (v.length - 2);
}

function bandMomentum(mults: number[]): number {
  const recent = mults.slice(-50);
  if (recent.length < 20) return 0.5;
  let up = 0;
  for (let i = 1; i < recent.length; i++) {
    if (bandIndex(lingBand(recent[i])) > bandIndex(lingBand(recent[i - 1]))) up++;
  }
  return up / (recent.length - 1);
}

// ---------------------------------------------------------------------------
// Mega ETA + bankroll + chase (megaPressure.ts continued)
// ---------------------------------------------------------------------------

export interface MegaEta {
  roundsEta: number;
  timeEtaMinutes: number;
  ci: { p50: [number, number]; p75: [number, number]; p95: [number, number] };
  methodology: string;
}

export function megaEta(mults: number[], mp: MegaPressure, megaMin = 50, timestamps?: string[]): MegaEta {
  const megaIdx = mults.map((m, i) => (m >= megaMin ? i : -1)).filter((i) => i >= 0);
  if (megaIdx.length < 3) {
    return { roundsEta: 100, timeEtaMinutes: 50, ci: { p50: [50, 150], p75: [25, 175], p95: [10, 190] }, methodology: "Insufficient data — default estimates." };
  }
  const gaps: number[] = [];
  for (let k = 0; k < megaIdx.length - 1; k++) gaps.push(megaIdx[k + 1] - megaIdx[k]);
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - avgGap) ** 2, 0) / gaps.length);

  const pressureAdjusted = avgGap * (1 - mp.currentPressure * 0.3);
  const timeAdjusted = pressureAdjusted * (1 - mp.timeDecay * 0.3);
  const predicted = avgGap * 0.4 + pressureAdjusted * 0.3 + timeAdjusted * 0.3;

  let roundMin = 0.5;
  if (timestamps && timestamps.length > 100) {
    const ds: number[] = [];
    for (let i = timestamps.length - 100; i < timestamps.length; i++) {
      ds.push((new Date(timestamps[i]).getTime() - new Date(timestamps[i - 1]).getTime()) / 60000);
    }
    const avg = ds.filter((d) => d > 0 && d < 60);
    if (avg.length > 10) roundMin = avg.reduce((a, b) => a + b, 0) / avg.length;
  }

  const ci = (z: number): [number, number] => [
    Math.max(1, Math.round(predicted - z * sd)),
    Math.round(predicted + z * sd),
  ];
  return {
    roundsEta: Math.round(predicted),
    timeEtaMinutes: Math.round(predicted * roundMin),
    ci: { p50: ci(0.67), p75: ci(1.15), p95: ci(1.96) },
    methodology: `40% historical avg (${avgGap.toFixed(0)} rounds) + 30% pressure-adjusted + 30% time-decay adjusted, from ${gaps.length} gaps.`,
  };
}

export interface BankrollPlan {
  conservative: { riskPct: number; minBankroll: number; maxLoss: number; recommended: boolean };
  moderate: { riskPct: number; minBankroll: number; maxLoss: number; recommended: boolean };
  aggressive: { riskPct: number; minBankroll: number; maxLoss: number; recommended: boolean };
  recommendation: string;
  recoveryRounds: number;
}

export function bankrollPlan(mp: MegaPressure): BankrollPlan {
  const base = 1;
  const gap = mp.avgMegaGap || 100;
  const mk = (losses: number, risk: number, rec: boolean) => ({
    riskPct: risk,
    minBankroll: Math.ceil((base * losses) / risk),
    maxLoss: base * losses,
    recommended: rec,
  });
  return {
    conservative: mk(Math.round(gap * 0.5), 0.005, mp.currentPressure < 0.5),
    moderate: mk(Math.round(gap * 0.3), 0.02, mp.currentPressure >= 0.5 && mp.currentPressure < 0.7),
    aggressive: mk(Math.round(gap * 0.15), 0.05, mp.currentPressure >= 0.7),
    recommendation:
      mp.currentPressure >= 0.7
        ? "aggressive — high pressure indicates favorable conditions"
        : mp.currentPressure < 0.4
          ? "conservative — low pressure suggests waiting"
          : "moderate",
    recoveryRounds: Math.ceil(gap * 1.5),
  };
}

export type ChaseStrategyName = "conservative" | "moderate" | "aggressive";

export interface ChasePlan {
  name: ChaseStrategyName;
  description: string;
  params: { maxChaseRounds: number; stopLoss: number; profitTarget: number; growth: number; pressureThreshold: number };
  betSequence: Array<{ round: number; bet: number; cumulative: number }>;
  successRate: number;
  avgProfit: number;
  maxLoss: number;
  riskReward: number;
  recommendationScore: number;
}

const CHASE_PARAMS: Record<ChaseStrategyName, ChasePlan["params"]> = {
  conservative: { maxChaseRounds: 50, stopLoss: 2.0, profitTarget: 10.0, growth: 1.0, pressureThreshold: 0.7 },
  moderate: { maxChaseRounds: 30, stopLoss: 3.0, profitTarget: 20.0, growth: 1.2, pressureThreshold: 0.6 },
  aggressive: { maxChaseRounds: 15, stopLoss: 5.0, profitTarget: 50.0, growth: 1.5, pressureThreshold: 0.5 },
};

const CHASE_DESC: Record<ChaseStrategyName, string> = {
  conservative: "Flat betting with low stop-loss for long-term stability",
  moderate: "Linear bet growth with balanced risk/reward",
  aggressive: "Exponential bet growth for high-risk high-reward scenarios",
};

export function chasePlan(mp: MegaPressure, strategy: ChaseStrategyName): ChasePlan {
  const params = CHASE_PARAMS[strategy];
  const gap = mp.avgMegaGap || 100;
  const seq: ChasePlan["betSequence"] = [];
  let bet = 1, cum = 0;
  for (let i = 1; i <= params.maxChaseRounds; i++) {
    cum += bet;
    seq.push({ round: i, bet, cumulative: cum });
    bet = Math.ceil(bet * params.growth);
  }
  const successRate = Math.min(0.35 * (1 + mp.currentPressure * 0.2), 0.95);
  const avgProfit = params.profitTarget * successRate;
  const maxLoss = seq[seq.length - 1].cumulative;
  return {
    name: strategy,
    description: CHASE_DESC[strategy],
    params,
    betSequence: seq,
    successRate: r3(successRate),
    avgProfit: r3(avgProfit),
    maxLoss,
    riskReward: r3(avgProfit / maxLoss),
    recommendationScore: r3(mp.currentPressure * 0.4 + mp.timeDecay * 0.3 + Math.min(gap / 200, 1) * 0.3),
  };
}

// ---------------------------------------------------------------------------
// DNA pattern discovery (momento/pattern_discovery_dna.py)
// ---------------------------------------------------------------------------

export interface DnaSequence {
  bands: LingBand[];
  count: number;
  nextDistribution: Array<{ band: LingBand; p: number }>;
  avgNext: number;
}

/** Repeating band sequences of length `window`; minMatches=3 (repo constant). */
export function dnaSequences(mults: number[], window = 4, minCount = 3, limit = 12): DnaSequence[] {
  if (mults.length < window * 2) return [];
  const map = new Map<string, { bands: LingBand[]; count: number; next: Map<LingBand, number>; nextSum: number }>();
  for (let i = 0; i + window < mults.length; i++) {
    const bands = mults.slice(i, i + window).map(lingBand) as LingBand[];
    const key = bands.join("→");
    const nextM = mults[i + window];
    const nextB = lingBand(nextM);
    const e = map.get(key) ?? { bands, count: 0, next: new Map(), nextSum: 0 };
    e.count++;
    e.next.set(nextB, (e.next.get(nextB) ?? 0) + 1);
    e.nextSum += nextM;
    map.set(key, e);
  }
  return [...map.values()]
    .filter((e) => e.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((e) => ({
      bands: e.bands,
      count: e.count,
      nextDistribution: [...e.next.entries()]
        .map(([band, n]) => ({ band, p: n / e.count }))
        .sort((a, b) => b.p - a.p),
      avgNext: Math.round((e.nextSum / e.count) * 100) / 100,
    }));
}

export interface DnaGap {
  index: number;
  gap: number;
  from: number;
  to: number;
}

export function dnaGaps(mults: number[], minGap = 2, top = 5): DnaGap[] {
  const gaps: DnaGap[] = [];
  for (let i = 1; i < mults.length; i++) {
    const g = mults[i] - mults[i - 1];
    if (g >= minGap) gaps.push({ index: i, gap: Math.round(g * 100) / 100, from: mults[i - 1], to: mults[i] });
  }
  return gaps.sort((a, b) => b.gap - a.gap).slice(0, top);
}

// ---------------------------------------------------------------------------
// Ladder collapse detection (features/band_analysis/ladders.py)
// ---------------------------------------------------------------------------

export const LADDER_BANDS: Array<{ name: string; range: [number, number] }> = [
  { name: "ignition", range: [2.0, 3.0] },
  { name: "transition", range: [3.0, 5.0] },
  { name: "moonshot_approach", range: [5.0, 10.0] },
  { name: "mega_approach", range: [10.0, 50.0] },
  { name: "extreme", range: [50.0, 100.0] },
];

export interface LadderBand {
  name: string;
  range: [number, number];
  avgLength: number;
  totalSequences: number;
  collapseFrequency: number;
  lastCollapse: { direction: "up" | "down"; from: number; to: number } | null;
  currentRun: number;
}

export function ladderAnalysis(mults: number[], minLength = 3): LadderBand[] {
  return LADDER_BANDS.map(({ name, range: [lo, hi] }) => {
    const inBand = (m: number) => m >= lo && m < hi;
    const seqs: number[] = [];
    let run = 0;
    for (const m of mults) {
      if (inBand(m)) run++;
      else {
        if (run >= minLength) seqs.push(run);
        run = 0;
      }
    }
    if (run >= minLength) seqs.push(run);

    let lastCollapse: LadderBand["lastCollapse"] = null;
    for (let i = 1; i < mults.length; i++) {
      if (inBand(mults[i - 1]) && !inBand(mults[i])) {
        lastCollapse = { direction: mults[i] >= hi ? "up" : "down", from: mults[i - 1], to: mults[i] };
      }
    }

    let currentRun = 0;
    for (let i = mults.length - 1; i >= 0 && inBand(mults[i]); i--) currentRun++;

    const collapses = mults.reduce((n, m, i) => (i > 0 && inBand(mults[i - 1]) && !inBand(m) ? n + 1 : n), 0);
    return {
      name,
      range: [lo, hi] as [number, number],
      avgLength: seqs.length ? Math.round((seqs.reduce((a, b) => a + b, 0) / seqs.length) * 100) / 100 : 0,
      totalSequences: seqs.length,
      collapseFrequency: mults.length ? Math.round((collapses / mults.length) * 10000) / 10000 : 0,
      lastCollapse,
      currentRun,
    };
  });
}

// ---------------------------------------------------------------------------
// Moonshot condition scanner (features/moonshot_scanner/scanner.py)
// ---------------------------------------------------------------------------

export interface MoonshotScan {
  imminent: boolean;
  confidence: number;
  factors: { pressure: number; compression: number; ceilingProximity: number; bandTrend: string; distanceScore: number };
  etaAdjustment: number;
  historicalMoonshots: number;
}

/** Score current conditions against pre-moonshot patterns. Weights: .3/.2/.2/.2/.1, ETA ±0.1. */
export function scanMoonshot(
  mults: number[],
  releaseProbability: number,
  compression: number,
  nearestCeilingDistance: number,
  holdProbability: number,
): MoonshotScan {
  const moons = mults.filter((m) => m >= 10).length;

  // distance from last 10× moonshot, normalized
  let distance = 100;
  for (let i = mults.length - 1; i >= 0; i--) {
    if (mults[i] >= 10) {
      distance = mults.length - 1 - i;
      break;
    }
  }
  const distanceScore = 1 / (distance / 10 + 1);

  // band trend: compare avg band index of last 10 vs prior 10
  const idx = mults.map((m) => bandIndex(lingBand(m)));
  const last10 = idx.slice(-10);
  const prev10 = idx.slice(-20, -10);
  let bandTrend = "mixed";
  if (last10.length && prev10.length) {
    const a = last10.reduce((x, y) => x + y, 0) / last10.length;
    const b = prev10.reduce((x, y) => x + y, 0) / prev10.length;
    bandTrend = a > b + 0.3 ? "upward" : a < b - 0.3 ? "downward" : "mixed";
  }

  const ceilingProximity = nearestCeilingDistance >= 0 ? 1 / (nearestCeilingDistance + 1) : 0;

  let score = 0;
  score += releaseProbability * 0.3;
  score += compression * 0.2;
  score += ceilingProximity * 0.2;
  if (bandTrend === "upward") score += 0.2;
  else if (bandTrend === "mixed") score += 0.1;
  score += distanceScore * 0.1;

  const etaAdjustment = (holdProbability - 0.5) * 0.2;
  const confidence = Math.min(1, Math.max(0, score + etaAdjustment));

  return {
    imminent: confidence > 0.7,
    confidence: r3(confidence),
    factors: {
      pressure: r3(releaseProbability),
      compression: r3(compression),
      ceilingProximity: r3(ceilingProximity),
      bandTrend,
      distanceScore: r3(distanceScore),
    },
    etaAdjustment: r3(etaAdjustment),
    historicalMoonshots: moons,
  };
}

// ---------------------------------------------------------------------------
// Autopilot (momento/autopilot.py — weighted signal blender, walk-forward)
// ---------------------------------------------------------------------------

export const AUTOPILOT_DEFAULTS = {
  maxRiskPerRound: 0.02,
  dailyLossLimit: 0.15,
  maxConsecutiveLosses: 3,
  minConfidenceThreshold: 0.45,
  basePositionSize: 10,
  ceilingWeight: 0.35,
  gapSwingWeight: 0.3,
  linguisticWeight: 0.35,
};

export interface AutopilotConfig {
  minConfidence: number;
  baseSize: number;
  target: number;
  window: number;
}

export const AUTOPILOT_CONFIG: AutopilotConfig = {
  minConfidence: AUTOPILOT_DEFAULTS.minConfidenceThreshold,
  baseSize: AUTOPILOT_DEFAULTS.basePositionSize,
  target: 2,
  window: 100,
};

export type AutopilotAction = "ENTER" | "PREPARE" | "STAND_DOWN";

export interface AutopilotDecision {
  index: number;
  action: AutopilotAction;
  composite: number;
  size: number;
  contributions: Array<{ name: string; score: number; weight: number }>;
  primary: string;
  won: boolean | null;
  pnl: number;
}

export interface AutopilotResult {
  decisions: AutopilotDecision[];
  trades: number;
  winRate: number;
  totalPnl: number;
  consecutiveLosses: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  riskLevel: "normal" | "elevated" | "critical";
  equity: number[];
}

/**
 * Walk-forward autopilot: for each round, blend the three analyzer families
 * (ceiling analyzer .35, gap swing .30, linguistic .35) over the trailing
 * window only, decide, then settle against the next round. Paper trading.
 */
export function autopilotBacktest(mults: number[], cfg: AutopilotConfig): AutopilotResult {
  const decisions: AutopilotDecision[] = [];
  const equity: number[] = [];
  let eq = 0, consec = 0, maxConsec = 0;

  for (let i = cfg.window; i < mults.length; i++) {
    const w = mults.slice(i - cfg.window, i);
    const ceilings = detectCeilings(w);
    const cp = ceilingPressure(w, ceilings);
    const mom = bandMomentum(w);
    const energy = energyBuildup(w);

    // ceiling analyzer: bullish pressure under resistance minus collapse drag
    const ceilingScore = Math.max(0, cp.releaseProbability - 0);
    // gap swing: upward band momentum counts, flat heavily discounted, down zero
    const swingScore = mom;
    const direction = mom > 0.55 ? "up" : mom < 0.45 ? "down" : "flat";
    const gapScore = direction === "up" ? swingScore : direction === "flat" ? swingScore * 0.25 : 0;
    // linguistic proxy: ignition-grade energy in the window
    const lingScore = energy;

    const weighted = [
      { name: "ceiling_analyzer", score: r3(ceilingScore), weight: AUTOPILOT_DEFAULTS.ceilingWeight },
      { name: "gap_swing_analyzer", score: r3(gapScore), weight: AUTOPILOT_DEFAULTS.gapSwingWeight },
      { name: "linguistic_analysis", score: r3(lingScore), weight: AUTOPILOT_DEFAULTS.linguisticWeight },
    ];
    const wSum = weighted.reduce((a, c) => a + c.weight, 0);
    const composite = r3(weighted.reduce((a, c) => a + c.score * c.weight, 0) / wSum);
    const primary = [...weighted].sort((a, b) => b.score * b.weight - a.score * a.weight)[0].name;

    const action: AutopilotAction =
      composite >= cfg.minConfidence ? "ENTER" : composite >= cfg.minConfidence * 0.6 ? "PREPARE" : "STAND_DOWN";
    const size = action === "ENTER" ? Math.round(cfg.baseSize * composite * 100) / 100 : 0;

    let won: boolean | null = null;
    let pnl = 0;
    if (action === "ENTER" && size > 0) {
      won = mults[i] >= cfg.target;
      pnl = won ? Math.round(size * (cfg.target - 1) * 100) / 100 : -size;
      eq = Math.round((eq + pnl) * 100) / 100;
      if (won) consec = 0;
      else {
        consec++;
        maxConsec = Math.max(maxConsec, consec);
      }
    }
    decisions.push({ index: i, action, composite, size, contributions: weighted, primary, won, pnl });
    equity.push(eq);
  }

  const trades = decisions.filter((d) => d.action === "ENTER");
  const wins = trades.filter((d) => d.won);
  const gains = trades.filter((d) => d.pnl > 0).map((d) => d.pnl);
  const losses = trades.filter((d) => d.pnl < 0).map((d) => Math.abs(d.pnl));
  const recentLosses = (() => {
    let c = 0;
    for (let i = decisions.length - 1; i >= 0; i--) {
      if (decisions[i].action !== "ENTER") continue;
      if (decisions[i].won) break;
      c++;
    }
    return c;
  })();

  const lossSum = losses.reduce((a, b) => a + b, 0);
  return {
    decisions,
    trades: trades.length,
    winRate: trades.length ? Math.round((wins.length / trades.length) * 10000) / 10000 : 0,
    totalPnl: eq,
    consecutiveLosses: recentLosses,
    avgWin: gains.length ? Math.round((gains.reduce((a, b) => a + b, 0) / gains.length) * 100) / 100 : 0,
    avgLoss: losses.length ? Math.round((lossSum / losses.length) * 100) / 100 : 0,
    profitFactor: lossSum > 0 ? Math.round((gains.reduce((a, b) => a + b, 0) / lossSum) * 1000) / 1000 : null,
    riskLevel: recentLosses >= AUTOPILOT_DEFAULTS.maxConsecutiveLosses ? "critical" : recentLosses >= 2 ? "elevated" : "normal",
    equity,
  };
}

