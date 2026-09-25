/**
 * Prediction ledger — the app commits to a forecast BEFORE each round,
 * then resolves it against reality. No hindsight edits, no cherry-picking.
 *
 * Also provides a walk-forward scorer (exponential + Pareto engines only,
 * O(300) per step) so accuracy stats exist the moment the app loads.
 */
import { useEffect } from "react";
import { useApi } from "@/components/kit";
import type { PredictionEntry } from "./api";
import { HOUSE_EDGE, clamp, mean } from "./stats";
import { type State } from "./pipeline";
import { useRounds } from "./store";

export const REALIZED: Record<State, (m: number) => boolean> = {
  Collapse: (m) => m < 2,
  Shelf: (m) => m >= 2 && m < 3,
  Normal: (m) => m >= 3 && m < 5,
  Ignition: (m) => m >= 5 && m < 10,
  Moonshot: (m) => m >= 10,
};

export function realizedState(m: number): State {
  if (m >= 10) return "Moonshot";
  if (m >= 5) return "Ignition";
  if (m >= 3) return "Normal";
  if (m >= 2) return "Shelf";
  return "Collapse";
}

export interface LedgerEntry {
  id: number;
  roundId: number; // the round this forecast targets
  lockedAt: number;
  state: State;
  band: [number, number];
  probability: number;
  pAbove2: number;
  pAbove10: number;
  actual: number | null;
  brier: number | null; // Brier over the 5-state distribution
  bandHit: boolean | null; // actual landed inside the predicted band
  beat2: boolean | null; // actual >= 2x as predicted with pAbove2
  eta: number | null; // expected crash point (×) at lock time
}


/**
 * Live ledger, read from the server.
 *
 * This used to keep its own in-memory ledger that only locked a forecast once a
 * round had arrived in the current browser session, which is why the predictor
 * showed "warming up" forever on a tape that was seeded, imported or ingested —
 * the forecast was waiting on an event that a paused feed never fires. The
 * durable ledger is the backend's: it arms itself from whatever tape exists, and
 * a ledger the person being scored can edit is not a ledger.
 */
export function usePredictionLedger() {
  const { lastAddedAt } = useRounds();
  const q = useApi<ServerLedger>("/ledger?limit=200", { staleTime: 5_000 });

  // a new round both resolves the open forecast and commits the next one
  useEffect(() => {
    if (lastAddedAt) void q.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAddedAt]);

  const d = q.data;
  const toEntry = (e: PredictionEntry): LedgerEntry => ({
    id: e.id,
    roundId: e.targetRoundId ?? 0,
    lockedAt: Date.parse(e.lockedAt),
    state: e.state as State,
    band: [e.band[0], e.band[1]],
    probability: e.probability,
    pAbove2: e.pAbove2,
    pAbove10: e.pAbove10,
    actual: e.actual,
    brier: e.brier,
    bandHit: e.bandHit,
    beat2: e.hit2,
    eta: e.eta,
  });
  const entries: LedgerEntry[] = (d?.entries ?? []).map(toEntry);

  return {
    entries,
    // Trust the server's explicit open field rather than re-deriving it from the
    // list: the list is a windowed, ordered view and an open forecast that fell
    // outside it would read as "not armed" when one is in fact committed.
    open: d?.open ? toEntry(d.open) : entries.find((e) => e.actual === null) ?? null,
    resolvedCount: d?.resolvedCount ?? 0,
    accuracy2: d?.accuracy2x ?? 0,
    bandAccuracy: d?.bandAccuracy ?? 0,
    avgBrier: d?.avgBrier ?? 0,
    loading: q.isLoading,
    error: q.error,
    refetch: q.refetch,
  };
}

interface ServerLedger {
  open: PredictionEntry | null;
  entries: PredictionEntry[];
  resolvedCount: number;
  bandAccuracy: number;
  accuracy2x: number;
  accuracy10x: number;
  avgBrier: number | null;
  byState: { state: string; samples: number; bandAccuracy: number }[];
}

// ---------------------------------------------------------------------------
// Walk-forward scorer — instant accuracy over the whole corpus
// ---------------------------------------------------------------------------

export interface WalkForward {
  samples: number;
  hitRate2: number;
  hitRate10: number;
  brier2: number;
  brier10: number;
  rolling: Array<{ i: number; acc2: number; acc10: number }>;
}

/** Cheap honest engines only: exponential λ + Pareto α on a trailing window. */
export function walkForward(multipliers: number[], warmup = 150): WalkForward {
  const edge = HOUSE_EDGE;
  let hits2 = 0, hits10 = 0, b2 = 0, b10 = 0, n = 0;
  const rolling: Array<{ i: number; acc2: number; acc10: number }> = [];
  for (let i = warmup; i < multipliers.length; i++) {
    const w = multipliers.slice(Math.max(0, i - 300), i);
    const tail = mean(w.map((x) => Math.max(0, x - 1))) || 1;
    const lam = clamp(-Math.log(1 - edge) / tail, 0.02, 8);
    const p2 = (1 - edge) * Math.exp(-lam);
    const sorted = [...w].sort((a, b) => a - b);
    const xm = sorted[0];
    const logs = w.reduce((acc, x) => acc + Math.log(Math.max(xm, 1.01) / xm), 0);
    const alpha = clamp(w.length / Math.max(1e-9, logs), 0.2, 12);
    const p10 = Math.pow(xm / 10, alpha);
    const a2 = multipliers[i] >= 2 ? 1 : 0;
    const a10 = multipliers[i] >= 10 ? 1 : 0;
    hits2 += a2; hits10 += a10;
    b2 += (p2 - a2) ** 2; b10 += (p10 - a10) ** 2;
    n++;
    if (n % 25 === 0) rolling.push({ i, acc2: hits2 / n, acc10: hits10 / n });
  }
  return {
    samples: n,
    hitRate2: n ? hits2 / n : 0,
    hitRate10: n ? hits10 / n : 0,
    brier2: n ? b2 / n : 0,
    brier10: n ? b10 / n : 0,
    rolling,
  };
}
