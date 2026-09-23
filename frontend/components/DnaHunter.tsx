/**
 * DNA Hunter — port of momento/pattern_discovery_dna.py: repeating band
 * sequences (vocabulary), large-gap patterns, continuation distributions.
 */
import { useMemo, useState } from "react";
import { useRounds } from "@/lib/store";
import { dnaSequences, dnaGaps, lingBand, type LingBand } from "@/lib/avfs";
import { colorFor } from "./charts";

const WINDOWS = [3, 4, 5];

const BAND_COLOR: Record<LingBand, string> = {
  dust: "#6b7280", floor: "#ff4d5e", low: "#ff4d5e", base: "#38c7e8",
  mid: "#38c7e8", high: "#38c7e8", ignition: "#ffb020", moonshot: "#ffb020",
  mega: "#ffb020", cosmic: "#e879f9",
};

export function DnaHunter() {
  const { multipliers } = useRounds();
  const [win, setWin] = useState(4);
  const [minCount, setMinCount] = useState(3);

  const seqs = useMemo(
    () => (multipliers.length >= win * 2 ? dnaSequences(multipliers, win, minCount, 14) : []),
    [multipliers, win, minCount],
  );
  const gaps = useMemo(() => dnaGaps(multipliers, 2, 6), [multipliers]);

  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">DNA Hunter — repeating band sequences</span>
          <div className="flex items-center gap-1">
            {WINDOWS.map((w) => (
              <button key={w} onClick={() => setWin(w)}
                className={`rounded px-2 py-0.5 text-[10px] ${win === w ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                {w}-gram
              </button>
            ))}
          </div>
        </div>
        <div className="p-4">
          {seqs.length === 0 ? (
            <p className="text-xs text-muted-foreground">no sequence repeated {minCount}× yet — keep the feed running.</p>
          ) : (
            <div className="space-y-2.5">
              {seqs.map((s) => (
                <div key={s.bands.join("|")} className="rounded border border-border/70 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex gap-1">
                      {s.bands.map((b, i) => (
                        <span key={i} className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                          style={{ background: `${BAND_COLOR[b]}22`, color: BAND_COLOR[b], border: `1px solid ${BAND_COLOR[b]}55` }}>
                          {b}
                        </span>
                      ))}
                    </div>
                    <span className="font-mono-num text-xs text-muted-foreground">×{s.count}</span>
                    <span className="ml-auto font-mono-num text-xs" style={{ color: colorFor(s.avgNext) }}>
                      avg next {s.avgNext.toFixed(2)}×
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">then</span>
                    {s.nextDistribution.map((n) => (
                      <span key={n.band} className="rounded px-1.5 py-0.5 text-[10px]"
                        style={{ background: `${BAND_COLOR[n.band]}18`, color: BAND_COLOR[n.band] }}>
                        {n.band} {(n.p * 100).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Large gap patterns — jumps ≥ 2×</span>
          <span className="text-[10px] text-muted-foreground">top 6 of corpus</span>
        </div>
        <div className="grid gap-px bg-border/50 sm:grid-cols-2 lg:grid-cols-3">
          {gaps.map((g) => (
            <div key={g.index} className="bg-card p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-mono-num text-sm">
                  <span style={{ color: colorFor(g.from) }}>{g.from.toFixed(2)}×</span>
                  <span className="mx-1.5 text-muted-foreground">→</span>
                  <span style={{ color: colorFor(g.to) }}>{g.to.toFixed(2)}×</span>
                </span>
                <span className="font-mono-num text-xs font-bold text-primary">+{g.gap.toFixed(1)}×</span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                #{g.index} · {lingBand(g.from)} → {lingBand(g.to)}
              </p>
            </div>
          ))}
          {gaps.length === 0 && <div className="bg-card p-3 text-xs text-muted-foreground">no gaps ≥2× yet</div>}
        </div>
      </div>
    </div>
  );
}
