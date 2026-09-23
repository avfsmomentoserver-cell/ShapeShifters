/**
 * Visual engine — canvas scope with glow trails, animated counters,
 * probability bars, survival curve, histogram. Phosphor terminal aesthetic.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Round } from "@/lib/pipeline";
import { survivalCurve, type Analysis } from "@/lib/pipeline";

const GREEN = "#2bd97c";
const AMBER = "#ffb020";
const RED = "#ff4d5e";
const CYAN = "#38c7e8";

export const colorFor = (m: number): string => (m < 2 ? RED : m < 10 ? CYAN : AMBER);

// ---------------------------------------------------------------------------
// AnimatedNumber — count-up with easing, respects reduced motion
// ---------------------------------------------------------------------------

export function AnimatedNumber({ value, format = (v: number) => v.toFixed(2), className = "", duration = 550 }: {
  value: number; format?: (v: number) => string; className?: string; duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || from === value) { setDisplay(value); fromRef.current = value; return; }
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return <span className={className}>{format(display)}</span>;
}

// ---------------------------------------------------------------------------
// ScopeChart — canvas tape: grid, glowing stepped trace, pulsing head dot
// ---------------------------------------------------------------------------

export function ScopeChart({ rounds, visible = 90, height = 240 }: { rounds: Round[]; visible?: number; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const dataRef = useRef<Round[]>([]);
  dataRef.current = useMemo(() => rounds.slice(-visible), [rounds, visible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let alive = true;

    const draw = (now: number) => {
      if (!alive) return;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.clientWidth, H = height;
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr; canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const data = dataRef.current;
      const PAD_L = 38, PAD_R = 10, PAD_T = 14, PAD_B = 22;
      const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;

      if (data.length >= 2) {
        const maxM = Math.max(2.5, ...data.map((r) => r.m)) * 1.08;
        const x = (i: number) => PAD_L + (i / (data.length - 1)) * plotW;
        const y = (m: number) => PAD_T + plotH - (m / maxM) * plotH;

        // grid
        ctx.font = "9px ui-monospace, monospace";
        ctx.fillStyle = "hsl(160 8% 42%)";
        ctx.strokeStyle = "hsl(200 14% 15%)";
        ctx.setLineDash([2, 5]);
        for (const g of [2, 5, 10, 25, 50].filter((g) => g <= maxM)) {
          ctx.beginPath(); ctx.moveTo(PAD_L, y(g)); ctx.lineTo(W - PAD_R, y(g)); ctx.stroke();
          ctx.fillText(`${g}×`, 6, y(g) + 3);
        }
        ctx.setLineDash([]);

        // 2x line
        ctx.strokeStyle = "rgba(255,77,94,0.35)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(PAD_L, y(2)); ctx.lineTo(W - PAD_R, y(2)); ctx.stroke();
        ctx.setLineDash([]);

        // fill under trace
        const grad = ctx.createLinearGradient(0, PAD_T, 0, H - PAD_B);
        grad.addColorStop(0, "rgba(43,217,124,0.16)");
        grad.addColorStop(1, "rgba(43,217,124,0)");
        ctx.beginPath();
        ctx.moveTo(x(0), y(data[0].m));
        data.forEach((r, i) => ctx.lineTo(x(i), y(r.m)));
        ctx.lineTo(x(data.length - 1), H - PAD_B);
        ctx.lineTo(PAD_L, H - PAD_B);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // trace with glow
        ctx.beginPath();
        ctx.moveTo(x(0), y(data[0].m));
        data.forEach((r, i) => ctx.lineTo(x(i), y(r.m)));
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 1.6;
        ctx.shadowColor = "rgba(43,217,124,0.7)";
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // moonshot blips
        data.forEach((r, i) => {
          if (r.m >= 10) {
            ctx.beginPath();
            ctx.arc(x(i), y(r.m), 3, 0, Math.PI * 2);
            ctx.fillStyle = AMBER;
            ctx.shadowColor = "rgba(255,176,32,0.9)";
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        });

        // pulsing head
        const head = data[data.length - 1];
        const pulse = 3 + Math.sin(now / 300) * 1.2;
        ctx.beginPath();
        ctx.arc(x(data.length - 1), y(head.m), pulse + 4, 0, Math.PI * 2);
        ctx.fillStyle = `${colorFor(head.m)}22`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x(data.length - 1), y(head.m), 3.4, 0, Math.PI * 2);
        ctx.fillStyle = colorFor(head.m);
        ctx.shadowColor = colorFor(head.m);
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;

        // time labels
        ctx.fillStyle = "hsl(160 8% 42%)";
        ctx.fillText(data[0].ts.slice(11, 16), PAD_L - 8, H - 6);
        const lastTs = data[data.length - 1].ts.slice(11, 16);
        ctx.fillText(lastTs, W - PAD_R - lastTs.length * 5.5, H - 6);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { alive = false; cancelAnimationFrame(rafRef.current); };
  }, [height]);

  return <canvas ref={canvasRef} style={{ width: "100%", height }} role="img" aria-label="Live round scope" />;
}

// ---------------------------------------------------------------------------
// ProbBar / SurvivalChart / Histogram (SVG)
// ---------------------------------------------------------------------------

export function ProbBar({ label, value, tone = "green", detail }: { label: string; value: number; tone?: "green" | "amber" | "red" | "cyan"; detail?: string }) {
  const color = tone === "green" ? GREEN : tone === "amber" ? AMBER : tone === "red" ? RED : CYAN;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-foreground/90">{label}</span>
        <span className="font-mono-num text-muted-foreground">{detail ?? `${(value * 100).toFixed(1)}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, value * 100)}%`, background: color, boxShadow: `0 0 8px ${color}66` }} />
      </div>
    </div>
  );
}

export function SurvivalChart({ analysis }: { analysis: Analysis }) {
  const pts = useMemo(() => survivalCurve(analysis, 20, 60), [analysis]);
  const W = 800, H = 200, PAD_L = 34, PAD_B = 18;
  const x = (v: number) => PAD_L + ((v - 1) / 19) * (W - PAD_L - 8);
  const y = (p: number) => H - PAD_B - p * (H - PAD_B - 10);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.x).toFixed(1)},${y(p.p).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Survival curve">
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={PAD_L} x2={W - 8} y1={y(g)} y2={y(g)} stroke="hsl(200 14% 15%)" strokeDasharray="2 5" />
          <text x={4} y={y(g) + 3.5} fontSize="9" fill="hsl(160 8% 45%)">{(g * 100).toFixed(0)}%</text>
        </g>
      ))}
      {[2, 5, 10, 15, 20].map((g) => (
        <text key={g} x={x(g) - 6} y={H - 4} fontSize="9" fill="hsl(160 8% 45%)">{g}×</text>
      ))}
      <path d={`${path} L${x(20)},${y(0)} L${x(1)},${y(0)} Z`} fill={CYAN} fillOpacity={0.07} stroke="none" />
      <path d={path} fill="none" stroke={CYAN} strokeWidth={1.5} />
      {[2, 5, 10].map((t) => {
        const p = pts[Math.min(pts.length - 1, Math.round(((t - 1) / 19) * (pts.length - 1)))];
        return <circle key={t} cx={x(t)} cy={y(p.p)} r={2.6} fill={AMBER} />;
      })}
    </svg>
  );
}

export function Histogram({ multipliers }: { multipliers: number[] }) {
  const bins = useMemo(() => {
    const edges = [1, 1.5, 2, 3, 5, 8, 12, 20, 50, 500];
    const counts = new Array(edges.length - 1).fill(0);
    for (const m of multipliers) {
      for (let i = 0; i < counts.length; i++) {
        if (m >= edges[i] && m < edges[i + 1]) { counts[i]++; break; }
      }
    }
    return counts.map((c, i) => ({ label: `${edges[i]}×`, count: c }));
  }, [multipliers]);
  const maxC = Math.max(1, ...bins.map((b) => b.count));

  return (
    <div className="flex h-32 items-end gap-1.5">
      {bins.map((b) => (
        <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t-sm transition-all duration-500"
            style={{ height: `${(b.count / maxC) * 100}%`, background: colorFor(parseFloat(b.label)), opacity: 0.85 }}
            title={`${b.label}: ${b.count}`}
          />
          <span className="text-[9px] text-muted-foreground">{b.label}</span>
        </div>
      ))}
    </div>
  );
}
