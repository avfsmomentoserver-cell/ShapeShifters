/**
 * Full signal detection engine with ranges and accuracy adjustment.
 *
 * Six deterministic triggers fire signals from the live round feed. Each
 * signal carries an entry band, target band, stop level and horizon; it is
 * resolved automatically by subsequent rounds (hit / miss / expired). A
 * calibration loop adjusts raw confidence using realized hit rates, and a
 * user-facing sensitivity control tunes the firing threshold.
 *
 * Every function is pure over Round[] so all numbers in the UI can be
 * recomputed offline from any feed (see RESEARCH.md §9–§10 in the bundle).
 */
import {
  type RangeBucket,
  type Round,
  type Signal,
  type SignalConfig,
  type SignalEngineState,
  type SignalTypeAccuracy,
  type SignalTypeId,
  DRY_ZONE_MIN,
  LOCAL_WINDOW,
  MOONSHOT_THRESHOLD,
  RANGE_BUCKET_WIDTH,
  RANGE_MAX,
  ROLLING_WINDOW,
  SHAPE_THRESHOLDS,
  WIN_THRESHOLD,
} from "./types";
import { analyzeDryZones, analyzeStreaks, extractFeatures, predictMoonshot } from "./analysis";

// ---------------------------------------------------------------------------
// Trigger context helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const round2 = (v: number) => parseFloat(v.toFixed(2));

interface TriggerSpec {
  type: SignalTypeId;
  entry: { min: number; max: number };
  target: { min: number; max: number };
  stop: number;
  horizon: number;
  rawConfidence: number;
  rationale: string[];
}

function localVolatility(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
  );
  return mean ? std / mean : 0;
}

/**
 * Evaluates every trigger on the state *before* the current round
 * (`history`). Returns specs whose calibrated confidence clears the
 * sensitivity-derived threshold.
 */
function evaluateTriggers(history: Round[], config: SignalConfig): TriggerSpec[] {
  if (history.length < ROLLING_WINDOW) return [];

  const recent = history.slice(-ROLLING_WINDOW);
  const last = history[history.length - 1];
  const features = extractFeatures(last.multiplier, history.slice(0, -1));
  const last8 = history.slice(-LOCAL_WINDOW).map((r) => r.multiplier);
  const vol8 = localVolatility(last8);

  const zones = analyzeDryZones(history);
  const activeZone = zones[zones.length - 1]?.active ? zones[zones.length - 1] : null;

  const streaks = analyzeStreaks(history);
  const moon = predictMoonshot(history);

  // Sensitivity mapping: 0 → fires only above 70 raw confidence,
  // 100 → fires above 40. Higher sensitivity also widens targets slightly.
  const minConfidence = 70 - config.sensitivity * 0.3;
  const widen = 1 + config.sensitivity * 0.002;

  const specs: TriggerSpec[] = [];

  // 1. Post-dry-zone rebound: an active dry zone (≥2 consecutive <1.5x).
  if (activeZone) {
    specs.push({
      type: "dry-rebound",
      entry: { min: 1.5, max: 2.5 },
      target: { min: 2, max: round2(4 * widen) },
      stop: 1.2,
      horizon: 6,
      rawConfidence: clamp(55 + Math.min(activeZone.count, 5) * 4, 0, 95),
      rationale: [
        `active dry zone: ${activeZone.count} consecutive sub-${SHAPE_THRESHOLDS.earlyCrash}x rounds`,
        "empirical rebound rate after dry-zone exit is elevated (§3.1)",
      ],
    });
  }

  // 2. Streak continuation: current win streak ≥ 3.
  const streak = streaks.currentStreak;
  if (streak.type === "win" && streak.count >= 3) {
    specs.push({
      type: "streak-continuation",
      entry: { min: 1.6, max: 3 },
      target: { min: 2.5, max: round2(5 * widen) },
      stop: 1.3,
      horizon: 4,
      rawConfidence: clamp(50 + streak.count * 5, 0, 95),
      rationale: [
        `win streak of ${streak.count} rounds ≥ ${WIN_THRESHOLD}x`,
        "runs-test z checked in Streaks tab before trusting continuation",
      ],
    });
  }

  // 3. Moonshot pressure: momentum building + high predicted probability.
  if (moon.momentum !== "weak" && moon.probability >= 55) {
    specs.push({
      type: "moonshot-pressure",
      entry: { min: 1.8, max: 6 },
      target: { min: MOONSHOT_THRESHOLD, max: round2(12 * widen) },
      stop: 1.4,
      horizon: 10,
      rawConfidence: clamp(moon.probability * 0.85, 0, 95),
      rationale: [
        `moonshot probability ${moon.probability}% with ${moon.momentum} momentum`,
        `gapSinceHigh: ${features.gapSinceHigh} rounds vs mean gap`,
      ],
    });
  }

  // 4. Volatility compression: quiet local window inside the standard band.
  const spread = Math.max(...last8) - Math.min(...last8);
  if (vol8 < 0.35 && last8.every((m) => m >= 1.1 && m <= 3)) {
    specs.push({
      type: "volatility-compression",
      entry: { min: 1.5, max: 2.5 },
      target: { min: 3, max: round2(6 * widen) },
      stop: 1.25,
      horizon: 8,
      rawConfidence: clamp(50 + (0.35 - vol8) * 80, 0, 95),
      rationale: [
        `local volatility ${vol8.toFixed(2)} (σ/μ over ${LOCAL_WINDOW} rounds)`,
        `range compressed to ${spread.toFixed(2)}x — breakout watch`,
      ],
    });
  }

  // 5. Momentum build: normalized 3-round drift strongly positive.
  if (features.momentum > 0.15) {
    const base = last.multiplier;
    specs.push({
      type: "momentum-build",
      entry: { min: round2(base * 0.9), max: round2(base * 1.4) },
      target: { min: round2(base * 1.3), max: round2(base * 2 * widen) },
      stop: round2(base * 0.75),
      horizon: 5,
      rawConfidence: clamp(45 + features.momentum * 60, 0, 95),
      rationale: [
        `3-round drift +${(features.momentum * 100).toFixed(0)}% of rolling mean`,
        `z-score ${features.zScore} at ${base}x`,
      ],
    });
  }

  // 6. Floor defense: most of the window pinned near the 1.0x floor.
  const floorCount = recent.filter((r) => r.multiplier < 1.5).length;
  if (floorCount >= Math.ceil(ROLLING_WINDOW / 2)) {
    specs.push({
      type: "floor-defend",
      entry: { min: 1.2, max: 1.8 },
      target: { min: 2, max: round2(3.5 * widen) },
      stop: 1.05,
      horizon: 6,
      rawConfidence: clamp(48 + floorCount * 2, 0, 95),
      rationale: [
        `${floorCount}/${ROLLING_WINDOW} rounds below 1.5x — pinned at floor`,
        DRY_ZONE_MIN >= 2 ? "distributional floor clusters precede relief legs (§3)" : "",
      ].filter(Boolean),
    });
  }

  return specs
    .map((s) => ({ ...s, rawConfidence: round2(s.rawConfidence) }))
    .filter((s) => s.rawConfidence >= minConfidence);
}

// ---------------------------------------------------------------------------
// Range probability ladder (full coverage, 1.0x → RANGE_MAX)
// ---------------------------------------------------------------------------

export function computeRangeBuckets(rounds: Round[]): RangeBucket[] {
  const buckets: RangeBucket[] = [];
  const width = RANGE_BUCKET_WIDTH;
  for (let min = 1; min < RANGE_MAX; min += width) {
    buckets.push({
      min: round2(min),
      max: round2(min + width),
      count: 0,
      probability: 0,
    });
  }
  for (const r of rounds) {
    const idx = buckets.findIndex((b) => r.multiplier >= b.min && r.multiplier < b.max);
    if (idx >= 0) buckets[idx].count++;
  }
  const total = rounds.length;
  for (const b of buckets) {
    // Laplace smoothing keeps unseen-but-possible ranges on the ladder.
    b.probability = total
      ? round2(((b.count + 0.5) / (total + buckets.length * 0.5)) * 100)
      : 0;
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Main engine
// ---------------------------------------------------------------------------

/**
 * Walks the feed chronologically, firing and resolving signals. At most one
 * signal per type is active at a time. Resolution: hit when a subsequent
 * round reaches target.min within `horizon` rounds; expired if it entered
 * the entry band but never reached the target; miss otherwise.
 */
export function analyzeSignals(rounds: Round[], config: SignalConfig): SignalEngineState {
  const signals: Signal[] = [];
  const active = new Map<SignalTypeId, Signal>();

  for (let i = 0; i < rounds.length; i++) {
    const current = rounds[i];

    // Resolve outstanding signals against this round first.
    for (const [type, sig] of [...active.entries()]) {
      const age = i - (sig.createdIndex ?? i);
      if (current.multiplier >= sig.target.min) {
        sig.status = "hit";
        sig.resolvedMultiplier = current.multiplier;
        sig.resolvedAt = current.timestamp;
        active.delete(type);
      } else if (age >= sig.horizon) {
        sig.status = current.multiplier >= sig.entry.min ? "expired" : "miss";
        sig.resolvedMultiplier = current.multiplier;
        sig.resolvedAt = current.timestamp;
        active.delete(type);
      }
    }

    // Then fire new triggers based on everything strictly before this round.
    const specs = evaluateTriggers(rounds.slice(0, i), config);
    for (const spec of specs) {
      if (active.has(spec.type)) continue;
      const signal: Signal = {
        id: `sig-${i}-${spec.type}`,
        type: spec.type,
        createdAt: current.timestamp,
        time: current.time,
        entry: spec.entry,
        target: spec.target,
        stop: spec.stop,
        confidence: spec.rawConfidence,
        adjustedConfidence: spec.rawConfidence,
        horizon: spec.horizon,
        rationale: spec.rationale,
        status: "active",
        createdIndex: i,
      };
      signals.push(signal);
      active.set(spec.type, signal);
    }
  }

  // Calibration: realized hit rate scales raw confidence. hitRate 0.5 → 1.1,
  // clamped to [0.6, 1.4] so a short sample never swings confidence wildly.
  const resolved = signals.filter((s) => s.status !== "active");
  const hits = resolved.filter((s) => s.status === "hit");
  const hitRate = resolved.length ? hits.length / resolved.length : 0;
  const calibration = clamp(0.6 + hitRate * 1.0, 0.6, 1.4);

  const types: SignalTypeId[] = [
    "dry-rebound",
    "streak-continuation",
    "moonshot-pressure",
    "volatility-compression",
    "momentum-build",
    "floor-defend",
  ];
  const perType: SignalTypeAccuracy[] = types.map((type) => {
    const of = resolved.filter((s) => s.type === type);
    const h = of.filter((s) => s.status === "hit").length;
    return { type, total: of.length, hits: h, hitRate: of.length ? h / of.length : 0 };
  });

  return {
    signals: signals.slice().reverse(),
    activeSignals: [...active.values()],
    perType,
    overall: {
      total: resolved.length,
      hits: hits.length,
      hitRate: round2(hitRate),
    },
    calibration: round2(calibration),
    rangeBuckets: computeRangeBuckets(rounds),
  };
}
