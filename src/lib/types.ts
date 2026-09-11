/**
 * Core domain types for the crash-curve analytics engine.
 * Ported from the shapeshifters source (frontend/src/components) and hardened
 * with strict TypeScript types.
 */

export type ShapeId =
  | "early-crash"
  | "standard"
  | "extended"
  | "moonshot"
  | "extreme"
  | "spike"
  | "grinder"
  | "volatile"
  | "plateau";

/** Statistical features extracted per round against its rolling context. */
export interface ShapeFeatures {
  /** (multiplier − rolling mean) / rolling std, window 20. */
  zScore: number;
  /** multiplier / rolling median, window 20. */
  ratioToMedian: number;
  /** std/mean of the last 8 multipliers (local turbulence). */
  localVolatility: number;
  /** Normalized 3-round drift (last − first) / rolling mean. */
  momentum: number;
  /** Fraction of the window strictly below this multiplier. */
  percentile: number;
  /** Rounds since the last ≥ MOONSHOT_THRESHOLD round. */
  gapSinceHigh: number;
}

export interface Round {
  id: number;
  timestamp: string;
  time: string;
  /** Crash multiplier of the round, 2 decimal places. */
  multiplier: number;
  shape: ShapeId;
  /** Detector confidence, 0.7–0.95 in the source feed. */
  confidence: number;
  /** Rolling-context features computed at detection time. */
  features: ShapeFeatures;
}

export type StreakType = "win" | "loss";

export interface Streak {
  type: StreakType;
  count: number;
  start: number;
  end: number;
  current?: boolean;
}

export interface DryZone {
  start: number;
  count: number;
  end: number;
  active?: boolean;
}

export interface MoonshotCluster {
  start: number;
  count: number;
  multipliers: number[];
}

export interface MoonshotStats {
  total: number;
  percentage: string;
  highest: number;
  average: number;
  clusters: MoonshotCluster[];
  recent: Round[];
}

export interface MoonshotPrediction {
  probability: number;
  estimatedRounds: number;
  confidence: "high" | "medium";
  momentum: "strong" | "moderate" | "weak";
}

export interface DryZonePrediction {
  probability: number;
  estimatedRounds: number;
  confidence: "high" | "medium";
}

export interface CrashProbabilityPoint {
  multiplier: string;
  probability: string;
}

export interface EtaEstimate {
  estimatedCrash: number | null;
  confidence: "high" | "medium" | "low";
  method: string;
  timeRemaining: number | null;
  stdDev?: number;
  crashProbability?: CrashProbabilityPoint[];
}

/** Thresholds used across every analyzer (single source of truth). */
export const SHAPE_THRESHOLDS = {
  earlyCrash: 1.5,
  standard: 2.5,
  extended: 5,
  moonshot: 10,
} as const;

/** Rounds are "wins" at or above this multiplier (streak detector). */
export const WIN_THRESHOLD = 2;
/** A dry zone needs this many consecutive sub-1.5x rounds. */
export const DRY_ZONE_MIN = 2;
/** Moonshots are rounds at or above this multiplier. */
export const MOONSHOT_THRESHOLD = 5;
/** Two moonshots within this many rounds form a cluster. */
export const MOONSHOT_CLUSTER_GAP = 10;
/** Rolling window (rounds) for shape feature context. */
export const ROLLING_WINDOW = 20;
/** Local window for volatility/momentum features. */
export const LOCAL_WINDOW = 8;
/** Width of each probability range bucket, in multiplier units. */
export const RANGE_BUCKET_WIDTH = 0.5;
/** Max multiplier covered by the range ladder. */
export const RANGE_MAX = 20;
/** Default signal sensitivity (0–100). */
export const DEFAULT_SENSITIVITY = 50;

// ---------------------------------------------------------------------------
// Signal detection engine
// ---------------------------------------------------------------------------

export type SignalTypeId =
  | "dry-rebound"
  | "streak-continuation"
  | "moonshot-pressure"
  | "volatility-compression"
  | "momentum-build"
  | "floor-defend";

export interface SignalRange {
  min: number;
  max: number;
}

export type SignalStatus = "active" | "hit" | "miss" | "expired";

export interface Signal {
  id: string;
  type: SignalTypeId;
  createdAt: string;
  time: string;
  /** Entry multiplier band where the signal is actionable. */
  entry: SignalRange;
  /** Target payout band that resolves the signal as a hit. */
  target: SignalRange;
  /** Multiplier below which the position is considered invalidated. */
  stop: number;
  /** Raw model confidence, 0–100, from weighted feature votes. */
  confidence: number;
  /** Confidence after the calibration adjustment is applied. */
  adjustedConfidence: number;
  /** Number of rounds the signal stays valid. */
  horizon: number;
  rationale: string[];
  status: SignalStatus;
  /** Crash multiplier that resolved the signal (hit/miss/expired). */
  resolvedMultiplier?: number;
  resolvedAt?: string;
  /** Internal: data index the signal was created at. */
  createdIndex?: number;
}

export interface SignalTypeAccuracy {
  type: SignalTypeId;
  total: number;
  hits: number;
  hitRate: number;
}

export interface RangeBucket {
  min: number;
  max: number;
  count: number;
  /** Laplace-smoothed empirical probability, percent. */
  probability: number;
}

export interface SignalEngineState {
  signals: Signal[];
  activeSignals: Signal[];
  perType: SignalTypeAccuracy[];
  overall: { total: number; hits: number; hitRate: number };
  /** Multiplier applied to raw confidence; 1.0 = perfectly calibrated. */
  calibration: number;
  rangeBuckets: RangeBucket[];
}

export interface SignalConfig {
  /** 0–100. Higher = more signals fire and thresholds loosen. */
  sensitivity: number;
}
