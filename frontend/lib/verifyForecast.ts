/**
 * Forecast verification — the measurement half of the forecast loop.
 *
 * The pipeline commits a forecast (target, tight/full/extreme ranges, ETAs to
 * each magnitude) for the next round. This module closes the loop: it replays
 * the recorded tape walk-forward, so at checkpoint i the forecast is
 * recomputed from ONLY the rounds before i, then measured against actual[i] —
 * the round it was committed for. No hindsight, no cherry-picking; the
 * forecast is a pure function of the tape, so this is exactly what it said.
 *
 * Scoring is deliberately LOOSE and graded, because the ranges promise rates:
 * the tight band is a 50% interval, so missing it on ~half the rounds is the
 * model working as specified, not a failure. "Near" (missed this band but
 * landed in the next wider one) is its own grade. The verdict then separates
 * the three ways a forecast can be wrong:
 *   - tape drift:    the recent tape behaves differently from the earlier tape
 *                    (model is right, world moved) — the usual case
 *   - miscalibration: coverage / tail shape are off even vs its own window
 *   - noise:         the sample is too small to tell
 */
import {
  hillAlpha, calibratedSurvival,
} from "./stats";
import { calibratedQuantile } from "./pipeline";

export const DEFAULT_FORECAST_WINDOW = 600;
export const MIN_CHECKPOINT_WINDOW = 40;
const MIN_SAMPLES = 30;
/** Below this many scored rounds the verdict is "noise", not a finding. */
const LOW_SAMPLE = 60;

export interface CoverageMetric {
  hit: number;
  near: number; // missed this band but landed in the next wider one
  miss: number;
  samples: number;
  expected: number; // the rate the band promises (0.5 / 0.9 / 0.98)
  /** Hit share — the number compared against `expected`. */
  share: number;
  /** share − expected; a 50% band at 0.50 coverage is 0 by definition. */
  error: number;
  /** ±1σ of a binomial at `expected` over `samples` — the honest noise bar. */
  noiseBar: number;
}

export interface WaitScore {
  threshold: number;
  label: string;
  /** mean predicted wait (E = 1/p at the threshold), in rounds */
  predictedMean: number;
  /** mean observed gap (in rounds) between actuals >= threshold */
  realizedMean: number;
  /** realized / predicted — 1.0 = the ETA is honest */
  ratio: number;
  hits: number;
}

export interface AlphaPoint { i: number; alpha: number; pAbove2: number; }

export interface ForecastVerdict {
  grade: "calibrated" | "drift" | "miscalibrated" | "noise";
  headline: string;
  notes: string[];
}

export interface ForecastVerification {
  /** checkpoints scored (one per checkpoint step, after the warmup) */
  samples: number;
  /** checkpoint spacing in rounds */
  step: number;
  coverage: { tight: CoverageMetric; full: CoverageMetric; extreme: CoverageMetric };
  /** Brier of P(>=2x) at each checkpoint vs the actual 2x outcome */
  medianBrier: number;
  /** Brier of a perfectly calibrated P(>=2x) — p(1-p) at the fair price */
  fairBrier: number;
  wait: WaitScore[];
  /** sampled alpha + P(>=2x) across the checkpoints — the drift evidence */
  tailPath: AlphaPoint[];
  /** last 25% of checkpoints: where the forecast is standing NOW */
  recent: {
    tightShare: number;
    fullShare: number;
    extremeShare: number;
    alpha: number;
    pAbove2: number;
  };
  /** recent tail regime vs the earlier baseline (the drift evidence) */
  regime: {
    alphaNow: number;
    alphaEarlier: number;
    pAbove2Now: number;
    pAbove2Earlier: number;
    alphaDrift: number;
    pAbove2Drift: number;
  };
  verdict: ForecastVerdict;
}

interface CheckpointForecast {
  tight: [number, number];
  full: [number, number];
  extreme: [number, number];
  pAbove2: number;
  alpha: number;
  survivalAt: (x: number) => number;
}

function checkpointForecast(window: number[]): CheckpointForecast | null {
  if (window.length < MIN_CHECKPOINT_WINDOW) return null;
  const tail = hillAlpha(window);
  const sAt = (x: number) => calibratedSurvival(window, x, tail);
  return {
    tight: [calibratedQuantile(sAt, 0.75), calibratedQuantile(sAt, 0.25)],
    full: [calibratedQuantile(sAt, 0.95), calibratedQuantile(sAt, 0.05)],
    extreme: [calibratedQuantile(sAt, 0.99), calibratedQuantile(sAt, 0.01)],
    pAbove2: sAt(2),
    alpha: tail.alpha,
    survivalAt: sAt,
  };
}

const WAIT_LINES = [
  { threshold: 2, label: "2×" },
  { threshold: 10, label: "10×" },
  { threshold: 20, label: "20× moonshot" },
  { threshold: 50, label: "50× mega" },
];

const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmtR = (r: number) => (r < 99.5 ? r.toFixed(r < 20 ? 1 : 0) : "99+");

export function verifyForecast(
  multipliers: number[],
  opts: { warmup?: number; step?: number; window?: number } = {},
): ForecastVerification | null {
  const warmup = opts.warmup ?? 150;
  const step = Math.max(1, opts.step ?? 15);
  const win = opts.window ?? DEFAULT_FORECAST_WINDOW;

  const n = multipliers.length;
  // Nested coverage counts. The bands nest (tight ⊂ full ⊂ extreme) by
  // construction, and every scored checkpoint lands in exactly one of
  // hit/near/far per band — so far-misses stay in the denominator and the
  // shares are measured against ALL checkpoints, not just the ones that hit.
  let checkpoints = 0;
  let nTight = 0, nTightNear = 0;
  let nFull = 0, nFullNear = 0;
  let nExt = 0, nExtNear = 0;
  // per-checkpoint in-band flags, for the recent-window shares
  const recentTightArr: boolean[] = [], recentFullArr: boolean[] = [], recentExtArr: boolean[] = [];
  const briers: number[] = [];
  const waitPred = new Map<number, number[]>();
  const tailPath: AlphaPoint[] = [];
  // realized waits are measured at FULL resolution (every round), not at
  // checkpoint granularity: a 2x wait is ~2 rounds, so sampling the hit
  // process every 15 rounds would read it as 15. Both sides are MEANS —
  // predicted E[wait] = 1/p and the mean observed gap — because the
  // realized gaps are a skewed geometric whose median is a rounding of
  // ln(0.5)/ln(1-p), not equal to it.
  const realizedGapSum = new Map<number, number>();
  const realizedGapCount = new Map<number, number>();
  const lastHit = new Map<number, number>();
  const hitCount = new Map<number, number>();
  for (const line of WAIT_LINES) {
    waitPred.set(line.threshold, []);
    realizedGapSum.set(line.threshold, 0);
    realizedGapCount.set(line.threshold, 0);
    hitCount.set(line.threshold, 0);
  }

  for (let i = 0; i < n; i++) {
    const m = multipliers[i];
    for (const line of WAIT_LINES) {
      if (m >= line.threshold) {
        hitCount.set(line.threshold, hitCount.get(line.threshold)! + 1);
        if (lastHit.has(line.threshold)) {
          const gap = i - lastHit.get(line.threshold)!;
          realizedGapSum.set(line.threshold, realizedGapSum.get(line.threshold)! + gap);
          realizedGapCount.set(line.threshold, realizedGapCount.get(line.threshold)! + 1);
        }
        lastHit.set(line.threshold, i);
      }
    }

    if (i < warmup || (i - warmup) % step !== 0) continue;

    const window = multipliers.slice(Math.max(0, i - win), i);
    const fc = checkpointForecast(window);
    if (!fc) continue;

    checkpoints++;
    const inTight = m >= fc.tight[0] && m <= fc.tight[1];
    const inFull = m >= fc.full[0] && m <= fc.full[1];
    const inExt = m >= fc.extreme[0] && m <= fc.extreme[1];
    if (inTight) nTight++;
    else if (inFull) nTightNear++;
    if (inFull) nFull++;
    else if (inExt) nFullNear++;
    if (inExt) nExt++;
    else nExtNear++; // outside every band — a far miss, still scored
    recentTightArr.push(inTight);
    recentFullArr.push(inFull);
    recentExtArr.push(inExt);

    briers.push((fc.pAbove2 - (m >= 2 ? 1 : 0)) ** 2);

    for (const line of WAIT_LINES) {
      waitPred.get(line.threshold)!.push(1 / fc.survivalAt(line.threshold));
    }
    const prev = tailPath[tailPath.length - 1];
    if (!prev || i - prev.i >= step * 12) {
      tailPath.push({ i, alpha: fc.alpha, pAbove2: fc.pAbove2 });
    }
  }

  const samples = checkpoints;
  if (samples < MIN_SAMPLES) return null;

  const cov = (hit: number, near: number, expected: number): CoverageMetric => {
    const share = hit / samples;
    const noiseBar = Math.sqrt(expected * (1 - expected) / samples);
    return {
      hit, near, miss: samples - hit - near,
      samples, expected, share, error: share - expected, noiseBar,
    };
  };

  const wait: WaitScore[] = WAIT_LINES.map((line) => {
    const pred = meanOf(waitPred.get(line.threshold) ?? []);
    const rc = realizedGapCount.get(line.threshold) ?? 0;
    const realized = rc ? realizedGapSum.get(line.threshold)! / rc : 0;
    return {
      threshold: line.threshold,
      label: line.label,
      predictedMean: pred,
      realizedMean: realized,
      ratio: realized > 0 && pred > 0 ? realized / pred : 0,
      hits: hitCount.get(line.threshold) ?? 0,
    };
  });

  const lastN = Math.max(1, Math.floor(samples / 4));
  const recentIdx = tailPath[tailPath.length - 1] ?? tailPath[0];
  const recentTight = recentTightArr.slice(-lastN).filter(Boolean).length / lastN;
  const recentFull = recentFullArr.slice(-lastN).filter(Boolean).length / lastN;
  const recentExt = recentExtArr.slice(-lastN).filter(Boolean).length / lastN;

  const tight = cov(nTight, nTightNear, 0.5);
  const full = cov(nFull, nFullNear, 0.9);
  const extreme = cov(nExt, 0, 0.98); // no wider band: far misses are `miss`
  const medianBrier = meanOf(briers);
  const fairBrier = 0.25;
  // is the RECENT tape missing more than the tight band promises? (the window
  // is the model's own estimate, so its noise bar is the honest yardstick)
  const recentTightOff = Math.abs(recentTight - 0.5) > Math.max(0.1, tight.noiseBar * 1.5);

  // --- the investigation: why, not just that --------------------------------
  // A shift that happens in the LAST third of the tape is the interesting one —
  // "why is it missing NOW" — but it is diluted when averaged against the whole
  // run, so the drift test compares the recent checkpoints against the EARLIER
  // baseline rather than against the first half.
  const recentPath = tailPath.slice(-Math.max(4, Math.floor(tailPath.length * 0.4)));
  const earlierPath = tailPath.slice(0, Math.max(4, tailPath.length - recentPath.length));
  const aEarly = meanOf(earlierPath.map((p) => p.alpha));
  const aNow = meanOf(recentPath.map((p) => p.alpha));
  const p2Early = meanOf(earlierPath.map((p) => p.pAbove2));
  const p2Now = meanOf(recentPath.map((p) => p.pAbove2));
  const alphaDrift = aNow - aEarly;
  const p2Drift = p2Now - p2Early;

  const notes: string[] = [];
  const tightDrifted = Math.abs(tight.error) > Math.max(0.08, tight.noiseBar);
  const fullDrifted = Math.abs(full.error) > Math.max(0.1, full.noiseBar);
  const tailDrifted = Math.abs(alphaDrift) > 0.12 || Math.abs(p2Drift) > 0.05;
  const brierWeak = medianBrier > fairBrier * 1.35;

  let grade: ForecastVerdict["grade"];
  let headline: string;
  if (samples < LOW_SAMPLE) {
    grade = "noise";
    headline = `too few scored rounds (${samples}) — not enough signal to judge`;
  } else if (tailDrifted && recentTightOff) {
    // the recent tape moved AND the model's 600-round window is still chasing it
    grade = "drift";
    headline = `the tape moved recently and the window is lagging: recent tight ${pct(recentTight)} vs 50% (full-tape ${pct(tight.share)}), tail now α ${aNow.toFixed(2)} vs ${aEarly.toFixed(2)} earlier, P(≥2×) ${(p2Now * 100).toFixed(1)}% vs ${(p2Early * 100).toFixed(1)}%`;
  } else if (tailDrifted) {
    // the world moved; if coverage still holds, the model re-baselined and tracks
    grade = "drift";
    headline = `tape regime changed recently (α ${aEarly.toFixed(2)} → ${aNow.toFixed(2)}, P(≥2×) ${(p2Early * 100).toFixed(1)}% → ${(p2Now * 100).toFixed(1)}%) — the 600-round window re-baselined and is tracking the new tape`;
  } else if (tightDrifted || fullDrifted || brierWeak) {
    grade = "miscalibrated";
    headline = `coverage is off vs its own window (tight ${pct(tight.share)} vs 50%, full ${pct(full.share)} vs 90%) — the tail shape needs a look`;
  } else {
    grade = "calibrated";
    headline = `holding: tight ${pct(tight.share)} vs 50% (±${(tight.noiseBar * 100).toFixed(1)}% noise), full ${pct(full.share)} vs 90% — misses are landing where they are supposed to`;
  }

  if (samples >= LOW_SAMPLE) {
    if (tight.error < -Math.max(0.08, tight.noiseBar)) {
      notes.push(`tight band too WIDE: actuals escape it more often than a 50% interval may (only ${pct(tight.share)} inside)`);
    } else if (tight.error > Math.max(0.08, tight.noiseBar)) {
      notes.push(`tight band too NARROW: actuals stay inside it more than 50% should (${pct(tight.share)})`);
    }
    if (full.error < -Math.max(0.1, full.noiseBar)) {
      notes.push(`full band leaking: ${pct(full.share)} inside vs the 90% it promises — the tail beyond p95 is heavier than modeled`);
    }
    if (alphaDrift < -0.12) notes.push(`tail getting FATTER over time (α ${aEarly.toFixed(2)} → ${aNow.toFixed(2)}) — big-hit ETAs will understate the wait`);
    else if (alphaDrift > 0.12) notes.push(`tail getting THINNER over time (α ${aEarly.toFixed(2)} → ${aNow.toFixed(2)}) — big-hit ETAs will overstate the wait`);
    if (brierWeak) notes.push(`P(≥2×) Brier ${medianBrier.toFixed(3)} vs ${fairBrier.toFixed(2)} fair-coin floor — the 2× call itself is the weak spot`);
    const weakWait = wait.find((w) => w.hits >= 3 && w.realizedMean > 0 && (w.ratio > 1.8 || w.ratio < 0.55));
    if (weakWait) {
      notes.push(
        weakWait.ratio > 1
          ? `${weakWait.label} wait is running ${weakWait.ratio.toFixed(1)}× slower than forecasted (realized ${fmtR(weakWait.realizedMean)} vs ${fmtR(weakWait.predictedMean)} rounds)`
          : `${weakWait.label} wait is running ${weakWait.ratio.toFixed(1)}× FASTER than forecasted (realized ${fmtR(weakWait.realizedMean)} vs ${fmtR(weakWait.predictedMean)} rounds)`,
      );
    }
    if (notes.length === 0) notes.push("no rectification needed — every score sits inside its honest noise bar");
  }

  return {
    samples,
    step,
    coverage: { tight, full, extreme },
    medianBrier,
    fairBrier,
    wait,
    tailPath,
    recent: {
      tightShare: recentTight,
      fullShare: recentFull,
      extremeShare: recentExt,
      alpha: recentIdx.alpha,
      pAbove2: recentIdx.pAbove2,
    },
    regime: {
      alphaNow: aNow,
      alphaEarlier: aEarly,
      pAbove2Now: p2Now,
      pAbove2Earlier: p2Early,
      alphaDrift,
      pAbove2Drift: p2Drift,
    },
    verdict: { grade, headline, notes },
  };
}
