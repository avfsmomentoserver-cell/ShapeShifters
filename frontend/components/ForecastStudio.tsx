/**
 * Forecast Studio — full candidate table with driver attribution, ladder
 * pressure / release conditions, DNA analogue matching.
 */
import { useMemo, useState } from "react";
import { useRounds } from "@/lib/store";
import { analyze, candidates, probabilityAbove } from "@/lib/pipeline";
import { clamp } from "@/lib/stats";

const STATE_TONE: Record<string, string> = {
  Collapse: "#ff4d5e", Shelf: "#38c7e8", Normal: "#2bd97c", Ignition: "#ffb020", Moonshot: "#ffb020",
};

export function ForecastStudio() {
  const { multipliers } = useRounds();
  const [threshold, setThreshold] = useState(2);
  const analysis = useMemo(() => (multipliers.length >= 10 ? analyze(multipliers) : null), [multipliers]);
  const table = analysis ? candidates(multipliers, analysis) : [];

  if (!analysis) {
    return <div className="panel"><div className="p-4 text-xs text-muted-foreground">warming up…</div></div>;
  }

  return (
    <div className="space-y-3">
      {/* candidate table */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Ranked candidates — next round</span>
          <span className="text-[10px] text-muted-foreground">Markov + ladder pressure + DNA blend</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-2 font-medium">state</th>
                <th className="px-4 py-2 font-medium">probability</th>
                <th className="px-4 py-2 font-medium">band</th>
                <th className="px-4 py-2 font-medium">drivers</th>
              </tr>
            </thead>
            <tbody>
              {table.map((c) => (
                <tr key={c.state} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-semibold tracking-wider" style={{ color: STATE_TONE[c.state] }}>{c.state}</span>
                  </td>
                  <td className="w-40 px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${clamp(c.probability * 100, 2, 100)}%`, background: STATE_TONE[c.state] }} />
                      </div>
                      <span className="font-mono-num w-12 text-right">{(c.probability * 100).toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono-num whitespace-nowrap">{c.range[0]}–{c.range[1]}×</td>
                  <td className="px-4 py-2.5 text-[11px] leading-snug text-muted-foreground">{c.drivers.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ladder pressure / release */}
        <div className="panel">
          <div className="panel-header"><span className="panel-title">Ladder pressure & release conditions</span></div>
          <div className="space-y-3 p-4">
            <PressureMeter score={analysis.ladder.pressureScore} />
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Cell label="eta adjustment" value={`${analysis.ladder.etaAdjustment.toFixed(1)} rounds`} />
              <Cell label="nearest ceiling" value={analysis.ladder.nearestCeiling ? `${analysis.ladder.nearestCeiling.toFixed(2)}×` : "—"} />
              <Cell label="compression release" value={analysis.ladder.compressionRelease ? "ARMED" : "idle"}
                highlight={analysis.ladder.compressionRelease} />
              <Cell label="release moon-prob" value={`${(analysis.ladder.moonshotProbability * 100).toFixed(0)}%`} />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Pressure accumulates as rounds pile under a resistance ceiling; release ETA shortens with
              pressure score (−5 max), longest ladder (−0.3/step) and armed compression (−2).
            </p>
          </div>
        </div>

        {/* DNA */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">DNA — analogue tape matching</span>
            <span className="text-[10px] text-muted-foreground">confidence {(analysis.dna.confidence * 100).toFixed(0)}%</span>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Cell label="matched analogues" value={String(analysis.dna.matches.length)} />
              <Cell label="mean next outcome" value={analysis.dna.outcomes.mean ? `${analysis.dna.outcomes.mean.toFixed(2)}×` : "—"} />
              <Cell label="next p25–p75" value={analysis.dna.outcomes.p25 ? `${analysis.dna.outcomes.p25.toFixed(2)}–${analysis.dna.outcomes.p75.toFixed(2)}×` : "—"} />
              <Cell label="analogue moon-rate" value={`${(analysis.dna.outcomes.pNextMoonRate * 100).toFixed(0)}%`} />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The last 8 rounds are z-normalized and matched against every historic window (Euclidean distance).
              The 6 nearest analogues vote on what followed — that outcome tilt feeds the ensemble.
            </p>
          </div>
        </div>
      </div>

      {/* probability calculator */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Exceedance calculator</span>
          <span className="text-[10px] text-muted-foreground">P(next round ≥ threshold)</span>
        </div>
        <div className="space-y-4 p-4">
          <input
            type="range" min={1.1} max={20} step={0.1} value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            className="w-full accent-[#2bd97c]"
            aria-label="Exceedance threshold"
          />
          <div className="flex flex-wrap items-baseline gap-4">
            <span className="stat-value" style={{ color: "#ffb020" }}>
              {(probabilityAbove(analysis, threshold, multipliers) * 100).toFixed(2)}%
            </span>
            <span className="text-sm text-muted-foreground">P(next ≥ <span className="font-mono-num">{threshold.toFixed(1)}×</span>)</span>
            <span className="ml-auto text-[11px] text-muted-foreground">
              fair payout at edge 4%: <span className="font-mono-num text-foreground">{(1 / probabilityAbove(analysis, threshold, multipliers) * 0.96).toFixed(2)}×</span>
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[2, 3, 5, 10, 20].map((t) => (
              <button key={t} onClick={() => setThreshold(t)}
                className="rounded border border-border px-2 py-1.5 text-xs transition-colors hover:border-primary hover:text-primary">
                ≥ {t}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PressureMeter({ score }: { score: number }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>pressure</span>
        <span className="font-mono-num">{(score * 100).toFixed(0)}%</span>
      </div>
      <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score * 100}%`, background: score > 0.7 ? "#ff4d5e" : score > 0.4 ? "#ffb020" : "#2bd97c", boxShadow: "0 0 8px currentColor" }}
        />
      </div>
    </div>
  );
}

function Cell({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded border border-border bg-secondary/40 px-2.5 py-2">
      <p className="stat-label">{label}</p>
      <p className={`mt-0.5 font-mono-num text-sm ${highlight ? "font-semibold text-accent" : ""}`}>{value}</p>
    </div>
  );
}
