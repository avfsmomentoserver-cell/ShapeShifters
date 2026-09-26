/**
 * Chart predictions — the projected *shape* of the tape, drawn.
 *
 * This is deliberately not a number. A single "next multiplier" would be a
 * claim the mathematics cannot support; a shape is what the estimator actually
 * produces. So the panel draws three paths on the same axes:
 *
 *   • projected — the calibrated survival curve over the horizon (what the
 *     model expects to be drawn), in the same drawing space as the tape;
 *   • realized  — the same axes read off the rounds that actually printed, so
 *     the projection can be seen to confirm or fail *in place*;
 *   • fair      — (1 − h)/x, because a correctly implemented game sits on it
 *     and any projection that claims to sit meaningfully above it is wrong.
 *
 * Under the chart the shape is decomposed two ways: into the individual round
 * bands it implies (where the median and the p90 have landed historically), and
 * into time via the ETA ladder — "roughly how many rounds until a 10×".
 */
import { Async, Panel, Source, Stat, mult, num, useApi } from "@/components/kit";
import type { ShapeForecast } from "@/lib/api";

const W = 720;
const H = 260;
const PAD = { l: 44, r: 14, t: 14, b: 30 };

/** Probability → y pixel. Log-ish vertical so a 1% tail is still visible. */
function yFor(p: number): number {
  const clamped = Math.max(0.001, Math.min(1, p));
  const t = 1 - clamped; // 0 at p=1, →1 as p→0
  return PAD.t + t * (H - PAD.t - PAD.b);
}

function xFor(x: number, maxX: number): number {
  // Log scale on the magnitude axis: crash multipliers are multiplicative, and
  // a linear axis would collapse everything from 1× to 10× into the far left.
  const t = Math.log(Math.max(1, x)) / Math.log(Math.max(2, maxX));
  return PAD.l + t * (W - PAD.l - PAD.r);
}

function path(points: { x: number; p: number }[], maxX: number): string {
  return points
    .map((pt, i) => `${i === 0 ? "M" : "L"}${xFor(pt.x, maxX).toFixed(1)},${yFor(pt.p).toFixed(1)}`)
    .join(" ");
}

/** The ETAs we surface under the chart, in the order a reader looks for them. */
const ETA_ORDER = [2, 5, 10, 20, 50, 100];

export function ChartPrediction() {
  const query = useApi<ShapeForecast>("/stats/shape", { refetchInterval: 30_000 });

  return (
    <Panel
      className="mt-4"
      title="chart prediction — the projected shape"
      note="The projected shape is the calibrated distribution over the recent window, drawn rather than tabled. The realized path is the same axes read off the tape that actually printed: where the two diverge, the model is wrong about the shape — and that divergence is the measurement, not a signal."
    >
      <Async query={query} rows={5}>
        {(s) => <ShapeBody shape={s} />}
      </Async>
    </Panel>
  );
}

function ShapeBody({ shape }: { shape: ShapeForecast }) {
  const maxX = Math.max(2, shape.horizon);
  const projected = path(shape.projected, maxX);
  const realized = path(shape.realized, maxX);
  const fair = path(shape.fairPath, maxX);

  // Gridlines at the magnitudes a crash player actually names.
  const gridXs = [2, 5, 10, 20, 50, 100].filter((x) => x <= maxX);
  const etaByThreshold = new Map(shape.eta.map((e) => [e.threshold, e]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.16em]">
        <span className="flex items-center gap-1.5 text-accent">
          <span className="h-0.5 w-5 bg-accent" aria-hidden /> projected
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-0.5 w-5 bg-muted-foreground" aria-hidden /> realized tape
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-0.5 w-5 border-t border-dashed border-muted-foreground" aria-hidden /> fair (1−h)/m
        </span>
        <span className="ml-auto text-muted-foreground">
          fit {shape.shape.family} · r² {num(shape.shape.r2, 3)} · tail α {num(shape.tailAlpha, 3)}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="projected shape versus realized tape">
        {/* magnitude gridlines */}
        {gridXs.map((x) => (
          <g key={x}>
            <line
              x1={xFor(x, maxX)}
              x2={xFor(x, maxX)}
              y1={PAD.t}
              y2={H - PAD.b}
              className="stroke-border"
              strokeWidth={0.5}
            />
            <text x={xFor(x, maxX)} y={H - PAD.b + 14} textAnchor="middle" className="fill-muted-foreground" fontSize={9}>
              {x}×
            </text>
          </g>
        ))}
        {/* probability gridlines */}
        {[1, 0.5, 0.1, 0.01].map((p) => (
          <g key={p}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yFor(p)} y2={yFor(p)} className="stroke-border" strokeWidth={0.5} />
            <text x={PAD.l - 6} y={yFor(p) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
              {p < 0.1 ? `${(p * 100).toFixed(0)}%` : `${(p * 100).toFixed(0)}%`}
            </text>
          </g>
        ))}
        {/* fair reference first, so the model's own path sits on top of it */}
        <path d={fair} fill="none" className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="4 4" opacity={0.55} />
        <path d={realized} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} opacity={0.85} />
        <path d={projected} fill="none" className="stroke-accent" strokeWidth={2} />
      </svg>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="rounds fitted" value={shape.window} sub={`of ${shape.rounds.toLocaleString()} on tape`} />
        <Stat label="shape horizon" value={`${mult(shape.horizon)}`} sub="magnitude axis, log-scaled" tone="muted" />
        <Stat
          label="best-fit family"
          value={shape.shape.family.replace(/_/g, " ")}
          sub={`r² ${num(shape.shape.r2, 3)}`}
          tone="muted"
        />
      </div>

      {/* the decomposition: the shape read as individual rounds and as time */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded border border-border/60 p-2.5">
          <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            decomposed to rounds · wait to each magnitude
          </p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-1 font-normal uppercase tracking-[0.12em]">reach</th>
                <th className="pb-1 text-right font-normal uppercase tracking-[0.12em]">chance</th>
                <th className="pb-1 text-right font-normal uppercase tracking-[0.12em]">eta</th>
                <th className="pb-1 text-right font-normal uppercase tracking-[0.12em]">90% by</th>
              </tr>
            </thead>
            <tbody className="font-mono-num">
              {ETA_ORDER.map((t) => {
                const row = etaByThreshold.get(t);
                if (!row) return null;
                return (
                  <tr key={t} className="border-t border-border/40">
                    <td className="py-1 text-foreground">{mult(t)}</td>
                    <td className="py-1 text-right text-muted-foreground">{(row.pReach * 100).toFixed(1)}%</td>
                    <td className="py-1 text-right text-foreground">
                      {row.eta >= 1000 ? `${num(row.eta / 1000, 1)}k` : Math.round(row.eta)}
                    </td>
                    <td className="py-1 text-right text-muted-foreground">
                      {row.p90 >= 1000 ? `${num(row.p90 / 1000, 1)}k` : Math.round(row.p90)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            ETAs are rounds, not minutes — the tape's own cadence converts them. They are expected waits under the
            fitted distribution, so half the waits land sooner and half later.
          </p>
        </div>

        <div className="rounded border border-border/60 p-2.5">
          <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            curve family weight
          </p>
          <ul className="space-y-1.5 text-[11px]">
            {Object.entries(shape.families)
              .sort((a, b) => b[1] - a[1])
              .map(([family, weight]) => (
                <li key={family} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-muted-foreground">{family.replace(/_/g, " ")}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded bg-border/60">
                    <span
                      className="block h-full rounded bg-accent"
                      style={{ width: `${Math.max(0, Math.min(1, weight)) * 100}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono-num text-foreground">
                    {(weight * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            How the recent window's shape splits between candidate curve families. A near-tie means the tape does not
            distinguish them — which is what an unpredictable game looks like.
          </p>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        The projected shape is a distribution over outcomes, never a call. Expected cost is turnover × house edge and
        nothing on this chart changes that. Survival law from{" "}
        <Source href="https://crashedge.com/guides/crash-gambling-maths/">the crash survival law</Source>.
      </p>
    </div>
  );
}
