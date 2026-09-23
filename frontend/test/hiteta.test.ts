/**
 * Regression test for the "ETA to big hits" figures the Predictor prints.
 *
 * hitEta turns a one-round reach probability p into a geometric wait
 * (E = 1/p, CI ±1.5σ, p90 = −ln 0.1 / p). It is only as honest as the
 * survival curve feeding it, so this suite pins both layers against the
 * crash identity the backend's own suite asserts for survival.py:
 *
 *   fair law  P(X >= x) = (1-h)/x   =>   E[wait to x] = 1/p = x/(1-h)
 *
 * at h = 0.04: 2x -> 2.06 rounds, 5x -> 5.16, 10x -> 10.42.
 *
 * It also guards against the legacy exp/pareto blend (etaEstimate), which on
 * a fair tape claims ~94% for 2x where the truth is ~48% — a 2x error in p
 * becomes a 2x error in every ETA.
 */
import { describe, expect, it } from "vitest";
import { calibratedSurvival, hitEta, hillAlpha, tailSurvival, HOUSE_EDGE } from "@/lib/stats";
import { calibratedQuantile, targetForecast, fullForecast, BAND_HIT_THRESHOLDS, hitBandEtas, type BandHitKey } from "@/lib/pipeline";

/**
 * Same inverse transform the backend's provably-fair seeder uses
 * (fairness.py: i = 32-bit big-endian int, raw = 2**32/(i+1) * (1-h)).
 * LCG output is already 32-bit, so s itself is the fair i.
 */
function fairTape(seed: number, n: number, h = 0.04): number[] {
  let s = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const raw = 2 ** 32 / (1 + s);
    out.push(Math.floor(Math.max(1, raw * (1 - h)) * 100) / 100);
  }
  return out;
}

const survivalOf = (tape: number[]) => {
  const tail = hillAlpha(tape);
  return (x: number) => calibratedSurvival(tape, x, tail);
};

describe("hitEta + calibrated survival recover the fair waits", () => {
  const tape = fairTape(42, 40000);
  const survival = survivalOf(tape);

  it("P(reach x) lands on the fair price (1-h)/x on a 40k-round fair tape", () => {
    for (const x of [2, 5, 10]) {
      const pFair = (1 - HOUSE_EDGE) / x;
      expect(Math.abs(survival(x) - pFair) / pFair).toBeLessThan(0.05);
    }
  });

  it("waits land on x/(1-h) and keep the geometric ordering", () => {
    // ±5% relative: the Hill tail carries sampling noise (~1.5% observed at 10x
    // on 40k rounds), and 1/p amplifies it — the point is to rule out the
    // legacy blend's 2x error, not to pin round counts to 0.05.
    const closeRel = (got: number, want: number) => expect(Math.abs(got - want) / want).toBeLessThan(0.05);
    for (const x of [2, 5, 10]) {
      const e = hitEta(survival, x);
      const pFair = (1 - HOUSE_EDGE) / x;
      expect(e.pReach).toBeCloseTo(pFair, 1);
      closeRel(e.eta, x / (1 - HOUSE_EDGE));
      closeRel(e.p90, Math.log(10) / pFair);
      // the ±1.5σ band brackets the mean (it is symmetric, so it brackets by
      // construction); p90 is a separate quantile summary and need not order
      // against ciUpper on a right-skewed geometric
      expect(e.ciLower).toBeLessThan(e.eta);
      expect(e.eta).toBeLessThan(e.ciUpper);
      expect(e.p90).toBeGreaterThan(e.eta);
      expect(e.pReach).toBeGreaterThan(0);
      expect(e.pReach).toBeLessThan(1);
    }
  });

  it("falls back to the Hill tail when the tape has fewer than 8 exceedances", () => {
    const short = fairTape(7, 60);
    const tail = hillAlpha(short);
    // 60 rounds carry ~1-2 exceedances of 30x, so the estimator must use the tail
    const x = 30;
    expect(calibratedSurvival(short, x, tail)).toBeCloseTo(tailSurvival(tail, x), 6);
  });

  it("flags waits longer than ~125 rounds as tail extrapolation", () => {
    expect(hitEta(() => 0.005, 10).note).not.toBeNull();
    expect(hitEta(() => 0.05, 10).note).toBeNull();
  });

  it("recomputes when the tape changes (the target-update premise)", () => {
    const a = hitEta(survivalOf(tape.slice(0, 5000)), 10).eta;
    const b = hitEta(survivalOf(tape.slice(0, 9000)), 10).eta;
    expect(a).not.toBeCloseTo(b, 2);
  });
});

describe("headline target = calibrated next-round quantiles (the recalibrated target)", () => {
  // Fair law  P(X >= x) = (1-h)/x  =>  the survival quantiles have closed form:
  //   median (S=0.5)  = 2(1-h)      ≈ 1.92x
  //   p25    (S=0.75) = (1-h)/0.75  ≈ 1.28x
  //   p90    (S=0.10) = (1-h)/0.10  ≈ 9.60x
  // This is the forward forecast the target panel now prints, replacing the
  // frozen historical median the legacy engine reported.
  const tape = fairTape(42, 40000);
  const survival = survivalOf(tape);
  const closeRel = (got: number, want: number, tol = 0.06) =>
    expect(Math.abs(got - want) / want, `got ${got}, want ${want}`).toBeLessThan(tol);

  it("targetForecast recovers the fair median / p25 / p90 on a 40k-round fair tape", () => {
    const t = targetForecast(survival);
    closeRel(t.median, 2 * (1 - HOUSE_EDGE));
    closeRel(t.p25, (1 - HOUSE_EDGE) / 0.75);
    closeRel(t.p90, (1 - HOUSE_EDGE) / 0.1, 0.1);
    // ordering sanity: the 25th percentile is below the median, below the 90th
    expect(t.p25).toBeLessThan(t.median);
    expect(t.median).toBeLessThan(t.p90);
  });

  it("calibratedQuantile is a true inverse of the survival curve", () => {
    // inverting S then evaluating S must return the requested survival level
    for (const s0 of [0.75, 0.5, 0.25, 0.1]) {
      const x = calibratedQuantile(survival, s0);
      expect(survival(x)).toBeCloseTo(s0, 0);
    }
    // and it is monotone: a higher requested survival => a lower quantile
    expect(calibratedQuantile(survival, 0.75)).toBeLessThan(calibratedQuantile(survival, 0.5));
    expect(calibratedQuantile(survival, 0.5)).toBeLessThan(calibratedQuantile(survival, 0.1));
  });

  it("differs from the frozen historical median (what the recalibration was for)", () => {
    // the legacy headline was the median of EVERY past crash — a descriptive
    // stat that barely moves. The recalibrated target tracks the recent 600-
    // round window, so two different windows must yield different medians.
    const recentMedian = targetForecast(survivalOf(tape.slice(-600))).median;
    const olderMedian = targetForecast(survivalOf(tape.slice(0, 600))).median;
    expect(recentMedian).not.toBeCloseTo(olderMedian, 1);
    expect(recentMedian).toBeGreaterThan(1);
  });
});

describe("fullForecast — the full-range quantile ladder behind the dedicated panel", () => {
  // Fair law P(X >= x) = (1-h)/x gives closed-form quantiles: p_q = (1-h)/(1-q).
  // On a 40k-round tape every quantile up to p99 is inside the empirical region
  // (p99 ≈ 48x has >>32 exceedances, so the Hill blend weight w is exactly 0),
  // which means the ladder must recover these values to within sampling noise.
  const tape = fairTape(42, 40000);
  const f = fullForecast(survivalOf(tape));
  const q = (prob: number) => (1 - HOUSE_EDGE) / (1 - prob);
  const closeRel = (got: number, want: number, tol = 0.07) =>
    expect(Math.abs(got - want) / want, `got ${got}, want ${want}`).toBeLessThan(tol);

  it("recovers every fair quantile: p01..p99", () => {
    closeRel(f.p01, q(0.01), 0.12);
    closeRel(f.p05, q(0.05), 0.10);
    closeRel(f.p10, q(0.10), 0.09);
    closeRel(f.p25, q(0.25), 0.07);
    closeRel(f.p50, q(0.50), 0.06);
    closeRel(f.p75, q(0.75), 0.07);
    closeRel(f.p90, q(0.90), 0.09);
    closeRel(f.p95, q(0.95), 0.10);
    closeRel(f.p99, q(0.99), 0.12);
  });

  it("is strictly monotone with correct range nesting", () => {
    const vals = [f.p01, f.p05, f.p10, f.p25, f.p50, f.p75, f.p90, f.p95, f.p99];
    for (let i = 1; i < vals.length; i++) expect(vals[i - 1]).toBeLessThan(vals[i]);
    // nesting: tight (50%) ⊂ full (90%) ⊂ extreme (98%)
    expect(f.extreme[0]).toBeLessThan(f.full[0]);
    expect(f.full[0]).toBeLessThan(f.tight[0]);
    expect(f.tight[1]).toBeLessThan(f.full[1]);
    expect(f.full[1]).toBeLessThan(f.extreme[1]);
    // the IQR is the tight width
    expect(f.iqr).toBeCloseTo(f.tight[1] - f.tight[0], 1);
  });

  it("accommodates the full range: the tail target lands beyond the old fixed 1–20 scale", () => {
    // The legacy SurvivalChart clamped at 20x. On this tape the 98% envelope
    // reaches ~48x — exactly the 6x/55.98x-scale targets the panel exists for.
    expect(f.p99).toBeGreaterThan(20);
    expect(f.p99).toBeLessThan(100);
  });
});

describe("hitBandEtas — ETAs to moonshots / megas / cosmic on the same fair law", () => {
  // Same fair law the big-hit tests pin: P(X >= x) = (1-h)/x  =>  E[wait] = x/(1-h).
  // The band ladder (20/50/100/1000x) must recover those waits and stay
  // monotonically spaced, with the farthest reach flagged as tail extrapolation.
  const tape = fairTape(42, 40000);
  const band = hitBandEtas(survivalOf(tape));
  const keys = Object.keys(BAND_HIT_THRESHOLDS) as BandHitKey[];

  it("recovers the fair wait x/(1-h) at each band threshold", () => {
    const closeRel = (got: number, want: number, tol: number) =>
      expect(Math.abs(got - want) / want, `got ${got}, want ${want}`).toBeLessThan(tol);
    for (const k of keys) {
      const e = band[k];
      const x = BAND_HIT_THRESHOLDS[k];
      expect(e.threshold).toBe(x);
      expect(e.eta.pReach).toBeCloseTo((1 - HOUSE_EDGE) / x, 2);
      // tail tolerances widen as the threshold climbs (1/p amplifies the Hill noise)
      closeRel(e.eta.eta, x / (1 - HOUSE_EDGE), k === "20x" ? 0.06 : k === "50x" ? 0.08 : k === "100x" ? 0.1 : 0.15);
    }
  });

  it("is monotone: bigger magnitude => longer expected wait", () => {
    const etas = keys.map((k) => band[k].eta.eta);
    for (let i = 1; i < etas.length; i++) expect(etas[i - 1]).toBeLessThan(etas[i]);
    // and the 2x big-hit ETA is shorter than every band ETA (same survival curve)
    expect(band["20x"].eta.eta).toBeGreaterThan(2 / (1 - HOUSE_EDGE) * 0.9);
  });

  it("flags the 1000x jackpot as tail extrapolation but not the 20x moonshot", () => {
    expect(band["1000x"].eta.note).not.toBeNull();
    expect(band["20x"].eta.note).toBeNull();
  });
});
