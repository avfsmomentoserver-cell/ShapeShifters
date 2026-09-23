/**
 * Full Forecast — the dedicated, prominent next-round forecast panel.
 *
 * Where the old "target update" showed a single median plus a loose p25–p90
 * band on a fixed 1–20 scale, this panel renders the *whole* calibrated
 * next-round distribution: an expected target value that accommodates any
 * magnitude (a 6x as readily as a 55.98x), a tight 50% interval (the IQR), a
 * full 90% interval, a 98% envelope, an adaptive log-scale chart that keeps
 * equal multiples per grid cell, a per-percentile ladder, the ETAs to the big
 * hits, and the model diagnostics that say how much to trust the tail.
 *
 * Everything is sampled off the calibrated empirical + Hill-tail survival
 * curve (survival.py port) over the recent 600-round window, so it re-commits
 * on every round and stays honest about a fair tape.
 */
import { useRounds } from "@/lib/store";
import {
  survivalCurveLog, type Analysis, type BigHitKey, BIG_HIT_THRESHOLDS,
} from "@/lib/pipeline";
import { AnimatedNumber, colorFor } from "./charts";

/** Format a multiplier: 2 decimals < 10, 1 < 100, 0 above. */
const fmtX = (v: number): string =>
  v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);

/** Round a forecast max up to a display-friendly ceiling so the tail is visible. */
function niceCeil(v: number): number {
  const ladder = [10, 20, 50, 100, 150, 200, 300, 500, 1000];
  for (const s of ladder) if (s >= v) return s;
  return 1000;
}

const X_TICKS = [1, 2, 3, 5, 10, 20, 50, 100];

export function FullForecast({ analysis }: { analysis: Analysis | null }) {
  const { rounds, multipliers, lastAddedAt } = useRounds();

  if (!analysis || multipliers.length < 10) {
    return (
      <div className="panel scanline relative overflow-hidden">
        <div className="panel-header"><span className="panel-title">Full forecast — expected next-round target</span></div>
        <div className="p-4 text-xs text-muted-foreground">need ≥10 rounds of tape for a calibrated forecast…</div>
      </div>
    );
  }

  const f = analysis.forecast;
  const sAt = analysis.survivalAt;

  return (
    <div className="panel scanline relative overflow-hidden ring-1 ring-primary/20">
      <div className="panel-header border-b border-primary/10 bg-primary/[0.03]">
        <span className="panel-title">Full forecast — expected next-round target</span>
        <span className="text-[10px] text-muted-foreground" key={lastAddedAt}>
          <span className="ticker-in">re-committed · round {rounds.length.toLocaleString()}</span>
        </span>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* LEFT — target value + tight/full/extreme ranges + diagnostics */}
        <div className="space-y-3">
          <div>
            <p className="stat-label">expected target (median)</p>
            <div className="flex items-baseline gap-1.5">
              <AnimatedNumber
                value={f.p50}
                format={(v) => `${fmtX(v)}×`}
                className="font-mono-num text-5xl font-bold leading-none"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              state <span className="font-mono-num" style={{ color: colorFor(f.p50) }}>{analysis.state}</span> ·
              P(≥ target) = 50% by definition
            </p>
          </div>

          {/* range stack */}
          <div className="space-y-1.5">
            <RangeRow
              tone="tight"
              label="tight 50% range"
              lo={f.tight[0]}
              hi={f.tight[1]}
              sub={`IQR ${fmtX(f.iqr)}×`}
            />
            <RangeRow
              tone="full"
              label="full 90% range"
              lo={f.full[0]}
              hi={f.full[1]}
              sub={`p05–p95`}
            />
            <RangeRow
              tone="extreme"
              label="extreme 98% range"
              lo={f.extreme[0]}
              hi={f.extreme[1]}
              sub={`p01–p99 · tail reach`}
            />
          </div>

          {/* diagnostics */}
          <div className="grid grid-cols-3 gap-1.5">
            <Diag label="tail α" value={analysis.tailAlpha.toFixed(2)} hint="fair = 1.0" />
            <Diag label="P(≥2×)" value={`${(sAt(2) * 100).toFixed(1)}%`} />
            <Diag label="P(≥10×)" value={`${(sAt(10) * 100).toFixed(2)}%`} />
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Sampled off the calibrated next-round curve (empirical bulk + Hill tail, last 600 rounds).
            The tail α shows how heavy the right tail is: <span className="font-mono-num">α &gt; 1</span> decays
            faster than fair, <span className="font-mono-num">α &lt; 1</span> fatter.
          </p>
        </div>

        {/* RIGHT — adaptive log-scale distribution + quantile ladder */}
        <div className="min-w-0 space-y-3">
          <ForecastChart analysis={analysis} f={f} maxX={niceCeil(Math.max(20, f.p99 * 1.15))} />
          <QuantileLadder f={f} />
        </div>
      </div>

      {/* ETAs to big hits — full-width strip */}
      <div className="border-t border-border/70 px-4 py-3">
        <p className="stat-label mb-2">ETAs to big hits — recalibrated every round</p>
        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(BIG_HIT_THRESHOLDS) as BigHitKey[]).map((k) => {
            const e = analysis.hitEtas[k];
            return (
              <div key={k} className="rounded border border-border bg-secondary/40 px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-widest" style={{ color: colorFor(e.threshold) }}>
                  ≥ {e.threshold}×
                </p>
                <p className="mt-0.5 flex items-baseline gap-1">
                  <AnimatedNumber value={e.eta} format={(v) => fmtRounds(v)} className="font-mono-num text-xl font-semibold" />
                  <span className="text-[9px] text-muted-foreground">rounds</span>
                </p>
                <p className="text-[9px] text-muted-foreground">
                  p={(e.pReach * 100).toFixed(2)}% · p90 {fmtRounds(e.p90)}
                  {e.note ? " · tail" : ""}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

const RANGE_TONE: Record<string, string> = {
  tight: "#2bd97c",
  full: "#38c7e8",
  extreme: "#ffb020",
};

function RangeRow({ tone, label, lo, hi, sub }: { tone: string; label: string; lo: number; hi: number; sub: string }) {
  const c = RANGE_TONE[tone];
  return (
    <div className="flex items-center justify-between rounded border border-border/70 bg-secondary/30 px-2.5 py-1.5">
      <span className="text-[11px] text-muted-foreground">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
        {label}
      </span>
      <span className="font-mono-num text-sm font-semibold">
        {fmtX(lo)}–{fmtX(hi)}×
        <span className="ml-2 text-[10px] font-normal text-muted-foreground">{sub}</span>
      </span>
    </div>
  );
}

function Diag({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-border bg-secondary/40 px-2 py-1.5">
      <p className="stat-label">{label}</p>
      <p className="mt-0.5 font-mono-num text-sm font-semibold">{value}</p>
      {hint && <p className="text-[9px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function QuantileLadder({ f }: { f: Analysis["forecast"] }) {
  const items: Array<{ q: string; v: number; hot?: boolean }> = [
    { q: "p01", v: f.p01 },
    { q: "p05", v: f.p05 },
    { q: "p10", v: f.p10 },
    { q: "p25", v: f.p25, hot: true },
    { q: "p50", v: f.p50, hot: true },
    { q: "p75", v: f.p75, hot: true },
    { q: "p90", v: f.p90 },
    { q: "p95", v: f.p95 },
    { q: "p99", v: f.p99 },
  ];
  return (
    <div>
      <p className="stat-label mb-1.5">quantile ladder — P(crash ≤ x)</p>
      <div className="grid grid-cols-9 gap-1">
        {items.map((it) => (
          <div
            key={it.q}
            className={`rounded border px-1 py-1 text-center ${it.hot ? "border-primary/40 bg-primary/[0.06]" : "border-border/70 bg-secondary/30"}`}
          >
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{it.q}</p>
            <p className="mt-0.5 font-mono-num text-[11px] font-semibold" style={{ color: it.hot ? colorFor(it.v) : undefined }}>
              {fmtX(it.v)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Adaptive log-x survival chart. Equal multiples per grid cell, so a 6x target
 * and a 55.98x target both sit comfortably on the same axis. Shows the full
 * calibrated curve, the tight band, the expected target, and the big-hit lines.
 */
function ForecastChart({ analysis, f, maxX }: { analysis: Analysis; f: Analysis["forecast"]; maxX: number }) {
  const pts = survivalCurveLog(analysis, maxX, 70);
  const W = 640, H = 220, PAD_L = 34, PAD_R = 14, PAD_T = 14, PAD_B = 26;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const X = (v: number) => PAD_L + (Math.log(Math.max(1, v)) / Math.log(maxX)) * plotW;
  const Y = (p: number) => PAD_T + (1 - Math.max(0, Math.min(1, p))) * plotH;

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(p.x).toFixed(1)},${Y(p.p).toFixed(1)}`).join(" ");
  const area = `${line} L${X(maxX).toFixed(1)},${Y(0).toFixed(1)} L${X(1).toFixed(1)},${Y(0).toFixed(1)} Z`;
  const targetC = colorFor(f.p50);
  const xTicks = X_TICKS.filter((t) => t <= maxX);

  return (
    <div className="rounded border border-border/70 bg-secondary/20 p-2">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <span className="stat-label">next-round distribution — log scale to {maxX}×</span>
        <span className="text-[9px] text-muted-foreground">curve = P(next survives past x)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Full forecast distribution">
        {/* y grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={PAD_L} x2={W - PAD_R} y1={Y(g)} y2={Y(g)} stroke="hsl(200 14% 15%)" strokeDasharray="2 5" />
            <text x={2} y={Y(g) + 3} fontSize="9" fill="hsl(160 8% 45%)">{(g * 100).toFixed(0)}%</text>
          </g>
        ))}
        {/* tight 50% band on the x axis */}
        <rect
          x={X(f.tight[0])} y={PAD_T} width={Math.max(0, X(f.tight[1]) - X(f.tight[0]))} height={plotH}
          fill={RANGE_TONE.tight} fillOpacity={0.10}
        />
        {/* full 90% band, lighter */}
        <rect
          x={X(f.full[0])} y={PAD_T} width={Math.max(0, X(f.full[1]) - X(f.full[0]))} height={plotH}
          fill={RANGE_TONE.full} fillOpacity={0.05}
        />
        {/* area + curve */}
        <path d={area} fill="#38c7e8" fillOpacity={0.08} />
        <path d={line} fill="none" stroke="#38c7e8" strokeWidth={1.6} />
        {/* big-hit threshold lines */}
        {[2, 5, 10].map((t) => (
          <g key={t} opacity={t <= maxX ? 1 : 0}>
            <line x1={X(t)} x2={X(t)} y1={PAD_T} y2={PAD_T + plotH} stroke={colorFor(t)} strokeOpacity={0.35} strokeDasharray="3 4" />
            <text x={X(t) + 2} y={PAD_T + 10} fontSize="9" fill={colorFor(t)}>{t}×</text>
          </g>
        ))}
        {/* expected target marker */}
        <line x1={X(f.p50)} x2={X(f.p50)} y1={PAD_T} y2={PAD_T + plotH} stroke={targetC} strokeWidth={1.4} />
        <circle cx={X(f.p50)} cy={Y(0.5)} r={3.2} fill={targetC} />
        <text x={Math.min(W - PAD_R - 6, X(f.p50) + 5)} y={Y(0.5) - 6} fontSize="10" fontWeight="700" fill={targetC}>
          {fmtX(f.p50)}×
        </text>
        {/* x ticks (log) */}
        {xTicks.map((t) => (
          <text key={t} x={X(t)} y={H - 8} fontSize="9" fill="hsl(160 8% 45%)" textAnchor="middle">{t}×</text>
        ))}
      </svg>
    </div>
  );
}

const fmtRounds = (r: number) => (r < 99.5 ? r.toFixed(r < 20 ? 1 : 0) : "99+");
