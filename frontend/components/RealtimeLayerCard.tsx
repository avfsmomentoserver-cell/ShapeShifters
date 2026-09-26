/**
 * The two-tier live layer, made visible.
 *
 * The backend splits its work by cost: a cheap projection that re-commits on
 * every round, composed on top of a heavy scheduled pass whose answers only move
 * over hundreds of rounds. That split is only honest if the reader can *see* it,
 * so this card publishes the composition rather than just the numbers:
 *
 *   • the live projection itself (median, tight range, tail index) — the figures
 *     that re-commit the instant a round lands;
 *   • the age and duration of the heavy pass underneath it, so "fresh" is a
 *     measured claim;
 *   • the drift between the two, which is what makes the layering auditable —
 *     if the live figures have moved a long way off the snapshot, the reader is
 *     entitled to know that before trusting the slow tier's verdict.
 *
 * Read from the store, not fetched: the projection rides on the live frame, so
 * this panel updates on the same tick as the round rather than one poll later.
 */
import { Stat, mult, num } from "@/components/kit";
import { useRounds } from "@/lib/store";

/** Rounds are the unit; the tape's own cadence is what turns them into time. */
function etaRounds(v: number | undefined): string {
  if (v === undefined) return "—";
  return v >= 1000 ? `${num(v / 1000, 1)}k` : `${Math.round(v)}`;
}

export function RealtimeLayerCard() {
  const { realtime, realtimeBaseline, realtimeDelta, realtimeAt } = useRounds();

  if (!realtime) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">live layer — per-round projection on the scheduled pass</h2>
        </div>
        <div className="p-3.5 text-xs text-muted-foreground">
          waiting for the first realtime commit…
        </div>
      </section>
    );
  }

  const target = realtime.target ?? { median: 1, p25: 1, p90: 1 };
  const etas = realtime.allEtas ?? {};
  const baselineAgeMs = realtimeBaseline?.ageMs ?? null;
  const fresh = realtimeBaseline?.fresh ?? false;
  const drift = realtimeDelta;

  // The composition is only as good as the baseline under it. A stale heavy pass
  // is not a failure — the cheap tier is still current — but the reader should
  // not be told the randomness verdict is being republished live when it is not.
  const baselineTone = !realtimeBaseline
    ? "muted"
    : fresh
      ? "good"
      : "warn";

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">live layer — per-round projection on the scheduled pass</h2>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          rev {realtime.rounds?.toLocaleString() ?? "—"} · {realtime.costMs !== undefined ? `${num(realtime.costMs, 1)} ms` : "—"}
        </span>
      </div>

      <div className="grid gap-3 p-3.5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="expected next round"
            value={mult(target.median)}
            sub={`tight range ${mult(target.p25)} – ${mult(target.p90)}`}
          />
          <Stat
            label="tail index α"
            value={num(realtime.tailAlpha, 3)}
            sub="lower α = heavier tail"
            tone="muted"
          />
          <Stat
            label="wait to 10×"
            value={etaRounds(etas["10x"]?.eta)}
            sub={`rounds · 90% by ${etaRounds(etas["10x"]?.p90)}`}
            tone="muted"
          />
          <Stat
            label="wait to 100×"
            value={etaRounds(etas["100x"]?.eta)}
            sub={`rounds · 90% by ${etaRounds(etas["100x"]?.p90)}`}
            tone="muted"
          />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* the layer underneath */}
          <div className="rounded border border-border/60 p-2.5">
            <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              composed on the scheduled pass
            </p>
            <div className="space-y-1 text-[11px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">passed over</span>
                <span className="font-mono-num text-foreground">
                  {realtimeBaseline?.rounds?.toLocaleString() ?? "—"} rounds
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">baseline age</span>
                <span className={`font-mono-num ${fresh ? "text-accent" : "text-[#ffb020]"}`}>
                  {baselineAgeMs === null ? "—" : baselineAgeMs < 1000 ? "<1 s" : `${num(baselineAgeMs / 1000, 0)} s`}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">heavy pass cost</span>
                <span className="font-mono-num text-foreground">
                  {realtimeBaseline?.costMs !== undefined ? `${num(realtimeBaseline.costMs, 0)} ms` : "—"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">randomness verdict</span>
                <span className="font-mono-num text-foreground">{realtimeBaseline?.verdict ?? "—"}</span>
              </div>
              {realtimeAt ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">live tier committed</span>
                  <span className="font-mono-num text-muted-foreground">
                    {new Date(realtimeAt).toLocaleTimeString()}
                  </span>
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              The heavy tier (fairness battery, earned skill, phases) is seconds of NumPy, so it runs on a timer and
              is cached. The live figures above do not wait for it — they re-commit on every round and only *lean* on
              it.
            </p>
          </div>

          {/* how far the live tier has moved off that snapshot */}
          <div className="rounded border border-border/60 p-2.5">
            <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              drift off the last heavy pass
            </p>
            {drift && drift.roundsApart > 0 ? (
              <div className="space-y-1 text-[11px]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">rounds since</span>
                  <span className="font-mono-num text-foreground">{drift.roundsApart.toLocaleString()}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">median moved</span>
                  <span className="font-mono-num text-foreground">
                    {drift.medianDrift >= 0 ? "+" : ""}
                    {num(drift.medianDrift, 3)}×
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">tail α moved</span>
                  <span className="font-mono-num text-foreground">
                    {drift.tailAlphaDrift >= 0 ? "+" : ""}
                    {num(drift.tailAlphaDrift, 3)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">10× wait moved</span>
                  <span className="font-mono-num text-foreground">
                    {drift.etaDrift10x >= 0 ? "+" : ""}
                    {num(drift.etaDrift10x, 2)} rounds
                  </span>
                </div>
                <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
                  {drift.moved
                    ? "the live figures have moved since the snapshot — the heavy verdict describes the older tape"
                    : "the live figures still agree with the snapshot"}
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                the live tier is level with the last scheduled pass
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="border-t border-border/60 px-3.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
        A distribution over the next round, not a call to bet — every stake still costs the house edge.
      </p>
    </section>
  );
}
