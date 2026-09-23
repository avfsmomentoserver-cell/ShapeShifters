/**
 * Ladder Dash — port of features/band_analysis/ladders.py: ladder sequences
 * inside predefined bands, collapse points, frequency, current runs.
 */
import { useMemo } from "react";
import { useRounds } from "@/lib/store";
import { ladderAnalysis } from "@/lib/avfs";

const TONE: Record<string, string> = {
  ignition: "#ffb020", transition: "#38c7e8", moonshot_approach: "#ffb020",
  mega_approach: "#e879f9", extreme: "#ff4d5e",
};

export function LadderDash() {
  const { multipliers } = useRounds();
  const bands = useMemo(() => ladderAnalysis(multipliers), [multipliers]);
  const currentBand = bands.find((b) => b.currentRun > 0);

  return (
    <div className="space-y-3">
      <div className="panel p-4">
        <p className="stat-label">ladder state</p>
        {currentBand ? (
          <p className="mt-1 text-sm text-foreground">
            tape is <span className="font-bold" style={{ color: TONE[currentBand.name] }}>{currentBand.name}</span>
            {" "}— run of <span className="font-mono-num font-bold">{currentBand.currentRun}</span> rounds inside {currentBand.range[0]}–{currentBand.range[1]}×
            {currentBand.lastCollapse && (
              <span className="text-muted-foreground"> · last exit was {currentBand.lastCollapse.direction} to {currentBand.lastCollapse.to.toFixed(2)}×</span>
            )}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">tape is below 2× — no ladder run active.</p>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {bands.map((b) => {
          const tone = TONE[b.name];
          return (
            <div key={b.name} className="panel p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-bold uppercase tracking-widest" style={{ color: tone }}>{b.name.replace("_", " ")}</span>
                <span className="font-mono-num text-xs text-muted-foreground">{b.range[0]}–{b.range[1]}×</span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                <Stat label="avg run" value={b.avgLength.toFixed(1)} />
                <Stat label="sequences" value={String(b.totalSequences)} />
                <Stat label="break freq" value={`${(b.collapseFrequency * 100).toFixed(1)}%`} />
                <Stat label="current run" value={String(b.currentRun)} tone={b.currentRun > 0 ? tone : undefined} />
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>ladder persistence</span>
                  <span>{b.currentRun > 0 ? `${((b.currentRun / Math.max(b.avgLength, 1)) * 100).toFixed(0)}% of avg run` : "—"}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${Math.min((b.currentRun / Math.max(b.avgLength, 1)) * 100, 100)}%`,
                    background: tone, boxShadow: b.currentRun > 0 ? `0 0 8px ${tone}88` : undefined,
                  }} />
                </div>
              </div>
              {b.lastCollapse && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  last break: {b.lastCollapse.from.toFixed(2)}× → {b.lastCollapse.to.toFixed(2)}× ({b.lastCollapse.direction})
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        A ladder is a run of consecutive rounds inside a band (min length 3, repo constant). Collapse frequency is how
        often runs break out of the band, either upward (breakthrough) or downward (reject). Long current runs vs the
        band's average historically precede the break.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="stat-label">{label}</p>
      <p className="font-mono-num mt-0.5 text-lg font-bold" style={tone ? { color: tone } : undefined}>{value}</p>
    </div>
  );
}
