/**
 * Analysis engine — deterministic, testable math ported from the source
 * dashboard components (shape classification, streaks, dry zones, moonshot
 * clusters, stochastic ETA) plus the simulated live round feed.
 *
 * The original MoonshotForecaster.jsx contained a syntax error
 * ("building Momentum") — the momentum calculation here is the corrected,
 * fully-typed version of the intended logic.
 */
import {
  type DryZone,
  type DryZonePrediction,
  type EtaEstimate,
  type MoonshotCluster,
  type MoonshotPrediction,
  type MoonshotStats,
  type Round,
  type ShapeFeatures,
  type ShapeId,
  type Streak,
  type StreakType,
  DRY_ZONE_MIN,
  LOCAL_WINDOW,
  MOONSHOT_CLUSTER_GAP,
  MOONSHOT_THRESHOLD,
  ROLLING_WINDOW,
  SHAPE_THRESHOLDS,
  WIN_THRESHOLD,
} from "./types";

export function classifyShape(multiplier: number): ShapeId {
  if (multiplier < SHAPE_THRESHOLDS.earlyCrash) return "early-crash";
  if (multiplier < SHAPE_THRESHOLDS.standard) return "standard";
  if (multiplier < SHAPE_THRESHOLDS.extended) return "extended";
  if (multiplier < SHAPE_THRESHOLDS.moonshot) return "moonshot";
  return "extreme";
}

/**
 * Rolling-context feature extraction for one round. Every feature is a pure
 * function of the multiplier and the preceding history, so detection is
 * reproducible offline from any feed.
 */
export function extractFeatures(
  multiplier: number,
  history: Round[],
): ShapeFeatures {
  const window = history.slice(-ROLLING_WINDOW).map((r) => r.multiplier);
  const local = history.slice(-LOCAL_WINDOW).map((r) => r.multiplier);

  const mean = window.length
    ? window.reduce((a, b) => a + b, 0) / window.length
    : multiplier;
  const std =
    window.length > 1
      ? Math.sqrt(
          window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length,
        )
      : 0;

  const sorted = [...window].sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.ceil((sorted.length - 1) / 2)]) /
      2
    : multiplier;

  const localMean = local.length
    ? local.reduce((a, b) => a + b, 0) / local.length
    : multiplier;
  const localStd =
    local.length > 1
      ? Math.sqrt(
          local.reduce((a, b) => a + (b - localMean) ** 2, 0) / local.length,
        )
      : 0;

  const deltas = history.slice(-3).map((r) => r.multiplier);
  const momentum =
    deltas.length >= 2
      ? (deltas[deltas.length - 1] - deltas[0]) / Math.max(mean, 1)
      : 0;

  const percentile = window.length
    ? window.filter((m) => m < multiplier).length / window.length
    : 0.5;

  const lastHighIndex = [...history]
    .reverse()
    .findIndex((r) => r.multiplier >= MOONSHOT_THRESHOLD);

  const round2 = (v: number) => parseFloat(v.toFixed(2));
  return {
    zScore: round2((multiplier - mean) / Math.max(std, 0.1)),
    ratioToMedian: round2(multiplier / Math.max(median, 1)),
    localVolatility: round2(localMean ? localStd / localMean : 0),
    momentum: round2(momentum),
    percentile: parseFloat(percentile.toFixed(2)),
    gapSinceHigh: lastHighIndex === -1 ? history.length : lastHighIndex,
  };
}

export interface AdvancedClassification {
  shape: ShapeId;
  confidence: number;
  features: ShapeFeatures;
}

/**
 * Feature-rich shape taxonomy. Extends the source's five multiplier bands
 * with context shapes: spike (z-score outlier), volatile (turbulent local
 * window), plateau (median-locked drift) and grinder (low-volatility grind).
 */
export function classifyShapeAdvanced(
  multiplier: number,
  history: Round[],
): AdvancedClassification {
  const features = extractFeatures(multiplier, history);
  const base = classifyShape(multiplier);

  let shape: ShapeId = base;
  if (features.zScore >= 2.2 && (base === "extended" || base === "moonshot")) {
    shape = "spike";
  } else if (history.length >= LOCAL_WINDOW && features.localVolatility > 0.75) {
    shape = "volatile";
  } else if (
    base === "standard" &&
    Math.abs(features.ratioToMedian - 1) <= 0.15 &&
    features.percentile >= 0.4 &&
    features.percentile <= 0.6 &&
    Math.abs(features.momentum) < 0.2
  ) {
    shape = "plateau";
  } else if (
    base === "early-crash" &&
    multiplier >= 1.2 &&
    features.localVolatility < 0.3
  ) {
    shape = "grinder";
  }

  const confidence = parseFloat(
    (
      0.6 +
      Math.min(Math.abs(features.zScore), 3) * 0.06 +
      Math.min(features.localVolatility, 1) * 0.1 +
      Math.abs(features.momentum) * 0.1
    )
      .toFixed(2)
      .slice(0, 4),
  );

  return { shape, confidence: Math.min(confidence, 0.98), features };
}

/**
 * Curve-shape model: a heavy-tailed mixture where most rounds die early and
 * rare rounds extend. The feed uses an inverse-transform sample of a
 * house-edge style distribution so shape frequencies stay realistic
 * (roughly half of rounds below 2x, long tail beyond).
 */
function sampleCrashMultiplier(): number {
  const u = Math.random();
  // 1% instant-crash floor, geometric-ish tail: M = 1 / (1 - 0.96u)
  const m = 1 / Math.max(0.04, 1 - 0.96 * u);
  return Math.min(60, parseFloat(m.toFixed(2)));
}

export function makeRound(id: number, at: Date, history: Round[] = []): Round {
  const multiplier = sampleCrashMultiplier();
  const { shape, confidence, features } = classifyShapeAdvanced(
    multiplier,
    history,
  );
  return {
    id,
    timestamp: at.toISOString(),
    time: at.toLocaleTimeString(),
    multiplier,
    shape,
    confidence,
    features,
  };
}

export function seedRounds(count: number, intervalMs: number): Round[] {
  const now = Date.now();
  const rounds: Round[] = [];
  for (let i = count; i > 0; i--) {
    rounds.push(makeRound(i, new Date(now - i * intervalMs), rounds));
  }
  return rounds;
}

// ---------------------------------------------------------------------------
// Streak detection (runs over the win/loss threshold)
// ---------------------------------------------------------------------------

export function calculateStreaks(data: Round[]): Streak[] {
  const streaks: Streak[] = [];
  let current: Streak | null = null;

  for (let i = 0; i < data.length; i++) {
    const type: StreakType = data[i].multiplier >= WIN_THRESHOLD ? "win" : "loss";
    if (current && current.type === type) {
      current.count++;
      current.end = i;
    } else {
      if (current && current.count > 0) streaks.push(current);
      current = { type, count: 1, start: i, end: i };
    }
  }
  if (current && current.count > 0) {
    streaks.push({ ...current, current: true });
  }
  return streaks;
}

export interface StreakStats {
  streaks: Streak[];
  currentStreak: Streak;
  hotStreaks: number;
  coldStreaks: number;
  maxWinStreak: number;
  maxLossStreak: number;
}

export function analyzeStreaks(data: Round[]): StreakStats {
  const streaks = calculateStreaks(data);
  const currentStreak = streaks.find((s) => s.current) ?? {
    type: "loss" as StreakType,
    count: 0,
    start: 0,
    end: 0,
  };
  return {
    streaks,
    currentStreak,
    hotStreaks: streaks.filter((s) => s.type === "win" && s.count >= 3).length,
    coldStreaks: streaks.filter((s) => s.type === "loss" && s.count >= 3).length,
    maxWinStreak: Math.max(
      ...streaks.filter((s) => s.type === "win").map((s) => s.count),
      0,
    ),
    maxLossStreak: Math.max(
      ...streaks.filter((s) => s.type === "loss").map((s) => s.count),
      0,
    ),
  };
}

// ---------------------------------------------------------------------------
// Dry zones (runs of consecutive sub-1.5x rounds, minimum length 2)
// ---------------------------------------------------------------------------

export function analyzeDryZones(data: Round[]): DryZone[] {
  const dryZones: DryZone[] = [];
  let currentZone: DryZone | null = null;

  for (let i = 0; i < data.length; i++) {
    const isDry = data[i].multiplier < SHAPE_THRESHOLDS.earlyCrash;
    if (isDry) {
      if (!currentZone) currentZone = { start: i, count: 1, end: i };
      else {
        currentZone.count++;
        currentZone.end = i;
      }
    } else if (currentZone) {
      if (currentZone.count >= DRY_ZONE_MIN) dryZones.push(currentZone);
      currentZone = null;
    }
  }
  if (currentZone && currentZone.count >= DRY_ZONE_MIN) {
    dryZones.push({ ...currentZone, active: true });
  }
  return dryZones;
}

export function predictDryZone(data: Round[]): DryZonePrediction {
  if (data.length === 0) {
    return { probability: 0, estimatedRounds: 3, confidence: "medium" };
  }
  const recent = data.slice(-20);
  const lowMultipliers = recent.filter((r) => r.multiplier < 2).length;
  const probability = Math.min((lowMultipliers / recent.length) * 100, 95);

  // Average gap between the starts of consecutive dry zones.
  const zoneStarts = analyzeDryZones(data).map((z) => z.start);
  let avgGap = 0;
  if (zoneStarts.length >= 2) {
    let total = 0;
    for (let i = 1; i < zoneStarts.length; i++) total += zoneStarts[i] - zoneStarts[i - 1];
    avgGap = total / (zoneStarts.length - 1);
  }

  return {
    probability: parseFloat(probability.toFixed(1)),
    estimatedRounds: Math.round(avgGap) || 3,
    confidence: data.length > 30 ? "high" : "medium",
  };
}

// ---------------------------------------------------------------------------
// Moonshot forecaster (>= 5x rounds and their clustering)
// ---------------------------------------------------------------------------

export function analyzeMoonshots(data: Round[]): MoonshotStats {
  const moonshots = data.filter((r) => r.multiplier >= MOONSHOT_THRESHOLD);

  // Cluster moonshots whose index gap stays within MOONSHOT_CLUSTER_GAP.
  const clusters: MoonshotCluster[] = [];
  let currentCluster: MoonshotCluster | null = null;
  let prevIndex = -1;

  for (const m of moonshots) {
    const idx = data.indexOf(m);
    if (prevIndex >= 0 && idx - prevIndex <= MOONSHOT_CLUSTER_GAP) {
      if (currentCluster) {
        currentCluster.count++;
        currentCluster.multipliers.push(m.multiplier);
      }
    } else {
      if (currentCluster) clusters.push(currentCluster);
      currentCluster = { start: idx, count: 1, multipliers: [m.multiplier] };
    }
    prevIndex = idx;
  }
  if (currentCluster) clusters.push(currentCluster);

  return {
    total: moonshots.length,
    percentage: data.length
      ? ((moonshots.length / data.length) * 100).toFixed(1)
      : "0.0",
    highest: Math.max(...moonshots.map((m) => m.multiplier), 0),
    average:
      moonshots.length > 0
        ? parseFloat(
            (
              moonshots.reduce((acc, m) => acc + m.multiplier, 0) /
              moonshots.length
            ).toFixed(2),
          )
        : 0,
    clusters,
    recent: moonshots.slice(-5),
  };
}

/** Corrected momentum/prediction logic (source file had a broken identifier). */
export function predictMoonshot(data: Round[]): MoonshotPrediction {
  if (data.length === 0) {
    return {
      probability: 0,
      estimatedRounds: 1,
      confidence: "medium",
      momentum: "weak",
    };
  }
  const recent = data.slice(-30);
  const highMultipliers = recent.filter((r) => r.multiplier >= 3).length;
  const buildingMomentum = highMultipliers / recent.length;

  const moonshotCount = data.filter((r) => r.multiplier >= MOONSHOT_THRESHOLD).length;
  const avgGapBetweenMoonshots = data.length / Math.max(1, moonshotCount);

  const lastMoonshotIndex = [...data]
    .reverse()
    .findIndex((r) => r.multiplier >= MOONSHOT_THRESHOLD);
  const roundsSinceLast = lastMoonshotIndex === -1 ? 999 : lastMoonshotIndex;

  const probability = Math.min(
    30 +
      buildingMomentum * 40 +
      Math.min(roundsSinceLast / avgGapBetweenMoonshots, 1) * 30,
    95,
  );

  return {
    probability: parseFloat(probability.toFixed(1)),
    estimatedRounds: Math.max(
      1,
      Math.round(avgGapBetweenMoonshots - roundsSinceLast),
    ),
    confidence: data.length > 50 ? "high" : "medium",
    momentum:
      buildingMomentum > 0.3
        ? "strong"
        : buildingMomentum > 0.15
          ? "moderate"
          : "weak",
  };
}

// ---------------------------------------------------------------------------
// ETA estimator (stochastic model, ported 1:1 from the source math)
// ---------------------------------------------------------------------------

export function calculateEta(
  currentMultiplier: number,
  history: Round[],
): EtaEstimate {
  if (history.length < 5) {
    return {
      estimatedCrash: null,
      confidence: "low",
      method: "insufficient_data",
      timeRemaining: null,
    };
  }

  const recent = history.slice(-20);
  const avgCrashPoint =
    recent.reduce((acc, r) => acc + r.multiplier, 0) / recent.length;

  const stdDev = Math.sqrt(
    recent.reduce(
      (acc, r) => acc + Math.pow(r.multiplier - avgCrashPoint, 2),
      0,
    ) / recent.length,
  );

  const growthRate = 0.06;
  const timeToCrash =
    Math.log(Math.max(avgCrashPoint, 1.01) / Math.max(currentMultiplier, 1.01)) /
    growthRate;

  const crashProbability = [];
  for (let i = 1; i <= 10; i++) {
    const targetMultiplier = currentMultiplier + i * 0.5;
    const probability = Math.min(
      100 *
        Math.exp(
          -Math.pow(targetMultiplier - avgCrashPoint, 2) /
            (2 * Math.pow(Math.max(stdDev, 0.1), 2)),
        ),
      99,
    );
    crashProbability.push({
      multiplier: targetMultiplier.toFixed(2),
      probability: probability.toFixed(1),
    });
  }

  return {
    estimatedCrash: parseFloat(avgCrashPoint.toFixed(2)),
    confidence:
      history.length > 30 ? "high" : history.length > 15 ? "medium" : "low",
    method: "stochastic_modeling",
    timeRemaining: Math.max(0, parseFloat(timeToCrash.toFixed(1))),
    stdDev: parseFloat(stdDev.toFixed(2)),
    crashProbability,
  };
}

// ---------------------------------------------------------------------------
// Aggregate quick stats for the header bar
// ---------------------------------------------------------------------------

export function computeQuickStats(rounds: Round[], eta: EtaEstimate) {
  const wins = rounds.filter((r) => r.multiplier >= WIN_THRESHOLD).length;
  const moonshots = rounds.filter(
    (r) => r.multiplier >= MOONSHOT_THRESHOLD,
  ).length;
  const activePatterns = new Set(rounds.map((r) => r.shape)).size;
  return {
    activePatterns,
    successRate: rounds.length
      ? ((wins / rounds.length) * 100).toFixed(1)
      : "0.0",
    avgMultiplier: rounds.length
      ? (rounds.reduce((a, r) => a + r.multiplier, 0) / rounds.length).toFixed(2)
      : "0.00",
    pendingMoonshots: moonshots,
    volatility: eta.stdDev ?? null,
  };
}
