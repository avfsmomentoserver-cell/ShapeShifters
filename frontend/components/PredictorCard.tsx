/**
 * The Predictor — hero card. Commits to a forecast before every round,
 * resolves it publicly, and shows measured accuracy (ledger + walk-forward).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "./charts";
import { useRounds } from "@/lib/store";
import { api } from "@/lib/api";
import { usePredictionLedger, walkForward, REALIZED, type LedgerEntry } from "@/lib/ledger";
import { analyze } from "@/lib/pipeline";
import { clamp, hitEta } from "@/lib/stats";

const STATE_COLOR: Record<string, string> = {
  Collapse: "#ff4d5e", Shelf: "#38c7e8", Normal: "#2bd97c", Ignition: "#ffb020", Moonshot: "#ffb020",
};

export function PredictorCard() {
  const { multipliers } = useRounds();
  const ledger = usePredictionLedger();
  const [flash, setFlash] = useState<null | "hit" | "miss">(null);
  const [arming, setArming] = useState(false);
  const prevResolved = useRef(0);

  const wf = useMemo(() => walkForward(multipliers), [multipliers]);
  const analysis = useMemo(
    () => (multipliers.length >= 10 ? analyze(multipliers) : null),
    [multipliers],
  );

  // resolution flash when the newest entry resolves
  useEffect(() => {
    if (ledger.resolvedCount > prevResolved.current) {
      const latest = ledger.entries.filter((e: LedgerEntry) => e.actual !== null).slice(-1)[0];
      setFlash(latest?.bandHit ? "hit" : "miss");
      const t = setTimeout(() => setFlash(null), 1400);
      prevResolved.current = ledger.resolvedCount;
      return () => clearTimeout(t);
    }
    prevResolved.current = ledger.resolvedCount;
  }, [ledger.resolvedCount, ledger.entries]);

  /** Commit a fresh forecast. Forced, so it replaces an open one rather than no-oping. */
  async function reArm() {
    setArming(true);
    try {
      await api.post("/predictions/arm?force=true", {});
      await ledger.refetch();
    } finally {
      setArming(false);
    }
  }

  const open = ledger.open;
  const confidence = open ? open.probability : 0;
  const ringR = 66, ringC = 2 * Math.PI * ringR;

  /** Calibrated wait to the open target's band mid — recomputed as the tape moves. */
  const targetEta = useMemo(() => {
    if (!open || !analysis || multipliers.length < 10) return null;
    const mid = Math.max(open.band[0], (open.band[0] + open.band[1]) / 2);
    return { mid, hit: hitEta(analysis.survivalAt, mid) };
  }, [open, analysis, multipliers]);

  return (
    <div className={`panel scanline relative overflow-hidden transition-shadow duration-700 ${flash === "hit" ? "shadow-[0_0_40px_rgba(43,217,124,0.25)]" : flash === "miss" ? "shadow-[0_0_40px_rgba(255,77,94,0.2)]" : ""}`}>
      {/* resolution flash banner */}
      {flash && (
        <div className={`absolute inset-x-0 top-0 z-10 py-1 text-center text-[11px] font-bold uppercase tracking-[0.3em] ${flash === "hit" ? "bg-primary/20 text-primary" : "bg-destructive/20 text-destructive"}`}>
          {flash === "hit" ? "◐ forecast hit" : "◐ forecast missed"}
        </div>
      )}

      <div className="panel-header">
        <span className="panel-title">The Predictor — committed forecast</span>
        <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {open ? `locked · targeting round #${open.roundId}` : ledger.loading ? "reading ledger…" : "not armed"}
        </span>
        <button
          type="button"
          onClick={reArm}
          disabled={arming || multipliers.length < 10}
          className="rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary disabled:opacity-40"
          title="Discard the open forecast and commit a fresh one from the tape as it stands. Recorded as a new lock, never as an edit."
        >
          {arming ? "arming…" : "re-arm"}
        </button>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr]">
        {/* confidence ring */}
        <div className="relative mx-auto h-[168px] w-[168px]">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
            <circle cx="80" cy="80" r={ringR} fill="none" stroke="hsl(200 14% 15%)" strokeWidth="8" />
            <circle
              cx="80" cy="80" r={ringR} fill="none"
              stroke={open ? STATE_COLOR[open.state] : "hsl(160 8% 40%)"}
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={ringC}
              strokeDashoffset={ringC * (1 - confidence)}
              style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.2,0.9,0.3,1)", filter: `drop-shadow(0 0 6px ${open ? STATE_COLOR[open.state] : "transparent"})` }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="stat-label">confidence</span>
            <AnimatedNumber
              value={confidence * 100}
              format={(v) => `${v.toFixed(1)}%`}
              className="font-mono-num text-3xl font-bold"
            />
            {open && (
              <span className="mt-1 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: STATE_COLOR[open.state] }}>
                {open.state}
              </span>
            )}
          </div>
        </div>

        {/* forecast details + measured accuracy */}
        <div className="space-y-3">
          {open ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="stat-label">target band</span>
                <span className="font-mono-num text-2xl font-bold glow-amber" style={{ color: STATE_COLOR[open.state] }}>
                  {open.band[0].toFixed(2)}–{open.band[1].toFixed(2)}×
                </span>
                <span className="text-xs text-muted-foreground">P(≥2×) {(open.pAbove2 * 100).toFixed(1)}% · P(≥10×) {(open.pAbove10 * 100).toFixed(1)}%</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[open.state, ...(["Ignition", "Moonshot", "Normal", "Shelf", "Collapse"] as const).filter((s) => s !== open.state).slice(0, 2)].map((s) => (
                  <span key={s} className="rounded border px-2 py-0.5 text-[10px] uppercase tracking-widest" style={{ borderColor: `${STATE_COLOR[s]}55`, color: STATE_COLOR[s] }}>
                    {s} {REALIZED[s](open.band[0]) ? "✓ core" : ""}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {ledger.loading
                ? "reading the committed ledger…"
                : multipliers.length < 10
                  ? `needs ${10 - multipliers.length} more round${10 - multipliers.length === 1 ? "" : "s"} on the tape before a forecast can be committed.`
                  : "no forecast committed — re-arm to lock one against the next round."}
            </p>
          )}

          {open && targetEta && (
            <p className="text-[11px] text-muted-foreground">
              ETA to this target ≈ <span className="font-mono-num font-semibold text-foreground">{fmtRounds(targetEta.hit.eta)} rounds</span>{" "}
              ({fmtRounds(targetEta.hit.ciLower)}–{fmtRounds(targetEta.hit.ciUpper)}, p90 {fmtRounds(targetEta.hit.p90)}) —
              one-round P(reach {targetEta.mid.toFixed(2)}×) = <span className="font-mono-num">{(targetEta.hit.pReach * 100).toFixed(1)}%</span>
              {targetEta.hit.note ? ` · ${targetEta.hit.note}` : ""}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 border-t border-border/70 pt-3 sm:grid-cols-5">
            <Metric label="session band acc" value={ledger.resolvedCount ? `${(ledger.bandAccuracy * 100).toFixed(0)}%` : "—"} sub={`${ledger.resolvedCount} resolved`} />
            <Metric label="session ≥2× acc" value={ledger.resolvedCount ? `${(ledger.accuracy2 * 100).toFixed(0)}%` : "—"} sub={`Brier ${ledger.avgBrier.toFixed(3)}`} />
            <Metric label="walk-forward ≥2×" value={`${(wf.hitRate2 * 100).toFixed(1)}%`} sub={`${wf.samples.toLocaleString()} scored`} />
            <Metric label="walk-forward ≥10×" value={wf.hitRate10 > 0 ? `${(wf.hitRate10 * 100).toFixed(2)}%` : "<0.01%"} sub={`Brier ${wf.brier10.toFixed(4)}`} />
            <Metric
              label="ETA to target"
              value={targetEta ? `${fmtRounds(targetEta.hit.eta)} rds` : "—"}
              sub={targetEta ? `p90 ${fmtRounds(targetEta.hit.p90)} · mid ${targetEta.mid.toFixed(2)}×` : "needs an open target"}
            />
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Every forecast is locked before the round and resolved after — no hindsight edits.
            Walk-forward stats re-score the entire corpus with the calibrated survival estimator: empirical below the tail cut, Hill-index power law above it.
          </p>
        </div>
      </div>
    </div>
  );
}

const fmtRounds = (r: number) => (r < 99.5 ? r.toFixed(r < 20 ? 1 : 0) : "99+");

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-border bg-secondary/40 px-2.5 py-2">
      <p className="stat-label">{label}</p>
      <p className="mt-0.5 font-mono-num text-lg font-semibold">{value}</p>
      {sub && <p className="text-[9px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export const clampExport = clamp;
