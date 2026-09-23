/**
 * Strategy lab — walk-forward backtest over the round corpus.
 *
 * Per round i (after warmup), using ONLY data before i:
 *   p  = blended engine exceedance P(multiplier >= threshold)
 *   EV = p·(threshold−1) − (1−p)          (crash-game cash-out at threshold)
 *   if EV > minEdge: stake = kellyFraction · f*  with f* = (bp−q)/b, b = threshold−1
 */
import { HOUSE_EDGE, clamp, mean } from "./stats";

export interface BacktestConfig {
  threshold: number;   // cash-out multiplier
  minEdge: number;     // minimum EV edge to place a bet (0 = take every +EV bet)
  kellyFraction: number; // fraction of full Kelly (0.25 = quarter Kelly)
  startBankroll: number;
  warmup: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  equity: Array<{ i: number; bankroll: number }>;
  finalBankroll: number;
  bets: number;
  hits: number;
  hitRate: number;
  roi: number;
  maxDrawdown: number;
  avgStake: number;
  longestLossRun: number;
}

export const DEFAULT_CONFIG: BacktestConfig = {
  threshold: 2, minEdge: 0.02, kellyFraction: 0.25, startBankroll: 1000, warmup: 150,
};

export function backtest(multipliers: number[], cfg: BacktestConfig): BacktestResult {
  const edge = HOUSE_EDGE;
  let bankroll = cfg.startBankroll;
  let peak = bankroll;
  let maxDd = 0;
  let bets = 0, hits = 0, stakeSum = 0, lossRun = 0, longestLossRun = 0;
  const equity: Array<{ i: number; bankroll: number }> = [{ i: 0, bankroll }];

  for (let i = cfg.warmup; i < multipliers.length; i++) {
    const w = multipliers.slice(Math.max(0, i - 300), i);
    if (w.length < 50) continue;
    const tail = mean(w.map((x) => Math.max(0, x - 1))) || 1;
    const lam = clamp(-Math.log(1 - edge) / tail, 0.02, 8);
    const expS = (1 - edge) * Math.exp(-lam * (cfg.threshold - 1));
    const xm = Math.min(...w);
    const logs = w.reduce((acc, x) => acc + Math.log(Math.max(x, xm) / xm), 0);
    const alpha = clamp(w.length / Math.max(1e-9, logs), 0.2, 12);
    const parS = cfg.threshold > xm ? Math.pow(xm / cfg.threshold, alpha) : 1;
    const wMix = clamp((cfg.threshold - 2) / 4, 0, 1);
    const p = clamp(expS * (1 - wMix) + parS * wMix, 0.001, 0.999);

    const b = cfg.threshold - 1;
    const ev = p * b - (1 - p);
    if (ev <= cfg.minEdge) continue;

    const fStar = clamp((b * p - (1 - p)) / b, 0, 1);
    const stake = bankroll * cfg.kellyFraction * fStar;
    if (stake < 0.5) continue;

    bets++;
    stakeSum += stake;
    const won = multipliers[i] >= cfg.threshold;
    if (won) { bankroll += stake * b; hits++; lossRun = 0; }
    else { bankroll -= stake; lossRun++; longestLossRun = Math.max(longestLossRun, lossRun); }

    peak = Math.max(peak, bankroll);
    maxDd = Math.max(maxDd, (peak - bankroll) / peak);
    equity.push({ i, bankroll });
  }

  return {
    config: cfg,
    equity,
    finalBankroll: bankroll,
    bets,
    hits,
    hitRate: bets ? hits / bets : 0,
    roi: (bankroll - cfg.startBankroll) / cfg.startBankroll,
    maxDrawdown: maxDd,
    avgStake: bets ? stakeSum / bets : 0,
    longestLossRun,
  };
}
