/**
 * The six chart views.
 *
 * A view turns the tape into a series, declares its natural domain, knows how
 * to paint itself against a Scale, and can answer "what is under the cursor".
 * Everything else — zoom, pan, crosshair, drawing — is view-agnostic and lives
 * in ChartLab.tsx, so adding a seventh view means adding one object here.
 *
 * The fair-value overlays all come from the crash survival law
 * P(M >= m) = (1 - h) / m for m >= 1, which is what a correctly implemented
 * game with house edge h produces. See CrashEdge's write-up of the maths:
 * https://crashedge.com/guides/crash-gambling-maths/
 */
import type { Round } from "../../lib/pipeline";
import { fmtMult, type Scale } from "./engine";

export type ChartId = "tape" | "candles" | "dist" | "survival" | "returnmap" | "equity";

export const GREEN = "#2bd97c";
export const AMBER = "#ffb020";
export const RED = "#ff4d5e";
export const CYAN = "#38c7e8";
const GRID = "rgba(120,150,140,0.13)";
const MUTED = "hsl(160 8% 52%)";

export interface BuildCtx {
  rounds: Round[];
  houseEdge: number;
  /** rounds per candle */
  bucket: number;
  /** cashout target for the equity curve */
  target: number;
  /** histogram bins */
  bins: number;
}

export interface ProbeRow {
  k: string;
  v: string;
  tone?: "good" | "warn" | "bad";
}

export interface Probe {
  /** pixel position of the marker to highlight */
  px: number;
  py: number;
  title: string;
  rows: ProbeRow[];
}

export interface ViewData {
  domain: { x0: number; x1: number; y0: number; y1: number };
  /** hard limits the user cannot zoom or pan outside of */
  limits: { x0: number; x1: number; y0: number; y1: number };
  draw: (c: CanvasRenderingContext2D, s: Scale) => void;
  probe: (dataX: number, s: Scale, my: number) => Probe | null;
  /**
   * Y extent of the data inside an x window, so the value axis can track what
   * is actually on screen instead of the all-time maximum. Views where y is not
   * a function of x (distribution, survival, return map) leave this undefined.
   */
  yExtent?: (x0: number, x1: number) => [number, number] | null;
  /** series for the overview strip: [x, y] pairs, already thinned */
  overview: [number, number][];
  empty: boolean;
}

export interface ViewDef {
  id: ChartId;
  label: string;
  /** one line the page shows under the tabs */
  hint: string;
  xLabel: string;
  yLabel: string;
  logX: boolean;
  logY: boolean;
  /** what an annotation's x coordinate means on this view */
  xUnit: "round" | "mult";
  build: (ctx: BuildCtx) => ViewData;
}

// ---------------------------------------------------------------------------
// shared painting helpers
// ---------------------------------------------------------------------------

function clip(c: CanvasRenderingContext2D, s: Scale, fn: () => void): void {
  c.save();
  c.beginPath();
  c.rect(s.plot.l, s.plot.t, s.plot.w, s.plot.h);
  c.clip();
  fn();
  c.restore();
}

function refLine(c: CanvasRenderingContext2D, s: Scale, y: number, color: string, label: string): void {
  if (y < Math.min(s.vp.y0, s.vp.y1) || y > Math.max(s.vp.y0, s.vp.y1)) return;
  const py = s.py(y);
  c.save();
  c.strokeStyle = color;
  c.setLineDash([5, 5]);
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(s.plot.l, py);
  c.lineTo(s.plot.l + s.plot.w, py);
  c.stroke();
  c.setLineDash([]);
  c.font = "9px ui-monospace, monospace";
  // Reference labels sit over the data, so they get their own backing plate —
  // otherwise low lines like the fair median read as noise on top of the trace.
  const tw = c.measureText(label).width;
  const rx = s.plot.l + s.plot.w - tw - 10;
  c.fillStyle = "rgba(5,16,11,0.82)";
  c.fillRect(rx - 2, py - 14, tw + 8, 12);
  c.fillStyle = color;
  c.textAlign = "left";
  c.fillText(label, rx + 2, py - 5);
  c.restore();
}

/**
 * A round plus its position on this visitor's tape.
 *
 * The x axis counts tape position, not the database id: ids come from a shared
 * autoincrement, so one visitor's rounds are sparse blocks of ids and plotting
 * against them leaves the whole chart empty except a sliver at the right edge.
 */
export interface TapePoint {
  x: number;
  id: number;
  m: number;
  ts: string;
}

function toPoints(rounds: Round[]): TapePoint[] {
  return rounds.map((r, i) => ({ x: i + 1, id: r.id, m: r.m, ts: r.ts }));
}

function visiblePoints(pts: TapePoint[], s: Scale): TapePoint[] {
  const lo = Math.min(s.vp.x0, s.vp.x1);
  const hi = Math.max(s.vp.x0, s.vp.x1);
  return pts.filter((p) => p.x >= lo - 1 && p.x <= hi + 1);
}

function thin<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function nearestPoint(pts: TapePoint[], x: number): TapePoint | null {
  if (!pts.length) return null;
  let best = pts[0];
  let bestD = Infinity;
  for (const p of pts) {
    const d = Math.abs(p.x - x);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

const emptyView = (): ViewData => ({
  domain: { x0: 0, x1: 1, y0: 0, y1: 1 },
  limits: { x0: 0, x1: 1, y0: 0, y1: 1 },
  draw: () => undefined,
  probe: () => null,
  overview: [],
  empty: true,
});

// ---------------------------------------------------------------------------
// tape — multiplier per round
// ---------------------------------------------------------------------------

const tapeView: ViewDef = {
  id: "tape",
  label: "Tape",
  hint: "Every round in order. Wheel zooms, drag pans, and drawings anchor to tape position.",
  xLabel: "round on tape",
  yLabel: "multiplier",
  logX: false,
  logY: false,
  xUnit: "round",
  build: ({ rounds, houseEdge }) => {
    if (rounds.length < 2) return emptyView();
    const pts = toPoints(rounds);
    const n = pts.length;
    const maxM = Math.max(...pts.map((p) => p.m));
    const median = 2 * (1 - houseEdge);
    const from = Math.max(1, n - 179);
    return {
      domain: { x0: from, x1: n, y0: 1, y1: Math.max(3, maxM * 1.06) },
      limits: { x0: 1, x1: n, y0: 1, y1: Math.max(3, maxM * 1.2) },
      overview: thin(pts, 900).map((p) => [p.x, p.m] as [number, number]),
      empty: false,
      yExtent: (a, b) => {
        const win = pts.filter((p) => p.x >= a && p.x <= b);
        if (!win.length) return null;
        return [1, Math.max(2.4, Math.max(...win.map((p) => p.m)) * 1.08)];
      },
      draw: (c, s) => {
        refLine(c, s, 2, "rgba(255,77,94,0.4)", "2x");
        refLine(c, s, 10, "rgba(255,176,32,0.35)", "10x");
        refLine(c, s, median, "rgba(56,199,232,0.4)", `fair median ${fmtMult(median)}`);
        const vis = visiblePoints(pts, s);
        if (vis.length < 2) return;
        const shown = thin(vis, 2600);
        clip(c, s, () => {
          const base = s.plot.t + s.plot.h;
          const grad = c.createLinearGradient(0, s.plot.t, 0, base);
          grad.addColorStop(0, "rgba(43,217,124,0.20)");
          grad.addColorStop(1, "rgba(43,217,124,0)");
          c.beginPath();
          c.moveTo(s.px(shown[0].x), base);
          for (const p of shown) c.lineTo(s.px(p.x), s.py(p.m));
          c.lineTo(s.px(shown[shown.length - 1].x), base);
          c.closePath();
          c.fillStyle = grad;
          c.fill();

          c.beginPath();
          c.moveTo(s.px(shown[0].x), s.py(shown[0].m));
          for (const p of shown) c.lineTo(s.px(p.x), s.py(p.m));
          c.strokeStyle = GREEN;
          c.lineWidth = 1.5;
          c.stroke();

          // Rounds only get their own dot once they are far enough apart to read
          // as points rather than a smear.
          const spacing = s.plot.w / Math.max(shown.length, 1);
          for (const p of shown) {
            if (spacing <= 5 && p.m < 10) continue;
            c.beginPath();
            c.arc(s.px(p.x), s.py(p.m), p.m >= 10 ? 3 : 2, 0, Math.PI * 2);
            c.fillStyle = p.m >= 10 ? AMBER : p.m >= 2 ? GREEN : RED;
            c.fill();
          }
        });
      },
      probe: (x, s) => {
        const p = nearestPoint(visiblePoints(pts, s), x);
        if (!p) return null;
        const prev = p.x > 1 ? pts[p.x - 2] : null;
        return {
          px: s.px(p.x),
          py: s.py(p.m),
          title: `round ${p.x} of ${n}`,
          rows: [
            { k: "multiplier", v: fmtMult(p.m), tone: p.m >= 10 ? "warn" : p.m >= 2 ? "good" : "bad" },
            { k: "band", v: p.m < 2 ? "floor" : p.m < 10 ? "mid" : "moon" },
            { k: "change", v: prev ? `${p.m - prev.m >= 0 ? "+" : ""}${(p.m - prev.m).toFixed(2)}` : "\u2014" },
            { k: "time", v: p.ts.slice(11, 19) },
          ],
        };
      },
    };
  },
};

// ---------------------------------------------------------------------------
// candles — OHLC over buckets of rounds
// ---------------------------------------------------------------------------

interface Candle {
  x: number;
  from: number;
  to: number;
  o: number;
  h: number;
  l: number;
  c: number;
  n: number;
  hits: number;
}

function buildCandles(rounds: Round[], bucket: number): Candle[] {
  const pts = toPoints(rounds);
  const out: Candle[] = [];
  for (let i = 0; i < pts.length; i += bucket) {
    const slice = pts.slice(i, i + bucket);
    if (!slice.length) break;
    const ms = slice.map((p) => p.m);
    out.push({
      x: slice[0].x + (slice[slice.length - 1].x - slice[0].x) / 2,
      from: slice[0].x,
      to: slice[slice.length - 1].x,
      o: ms[0],
      h: Math.max(...ms),
      l: Math.min(...ms),
      c: ms[ms.length - 1],
      n: slice.length,
      hits: ms.filter((m) => m >= 2).length,
    });
  }
  return out;
}

const candleView: ViewDef = {
  id: "candles",
  label: "Candles",
  hint: "Rounds bucketed into OHLC candles — the familiar shape, applied to something that has no trend.",
  xLabel: "round on tape",
  yLabel: "multiplier",
  logX: false,
  logY: true,
  xUnit: "round",
  build: ({ rounds, bucket }) => {
    if (rounds.length < bucket * 2) return emptyView();
    const candles = buildCandles(rounds, bucket);
    const x0 = candles[0].from;
    const x1 = candles[candles.length - 1].to;
    const maxH = Math.max(...candles.map((k) => k.h));
    const shown = Math.min(candles.length, 60);
    return {
      domain: { x0: candles[Math.max(0, candles.length - shown)].from, x1, y0: 1, y1: maxH * 1.1 },
      limits: { x0, x1, y0: 1, y1: maxH * 1.3 },
      overview: candles.map((k) => [k.x, k.c] as [number, number]),
      empty: false,
      yExtent: (a2, b2) => {
        const win = candles.filter((k) => k.to >= a2 && k.from <= b2);
        if (!win.length) return null;
        return [1, Math.max(2.4, Math.max(...win.map((k) => k.h)) * 1.12)];
      },
      draw: (c, s) => {
        refLine(c, s, 2, "rgba(255,77,94,0.4)", "2x");
        clip(c, s, () => {
          const lo = Math.min(s.vp.x0, s.vp.x1);
          const hi = Math.max(s.vp.x0, s.vp.x1);
          const vis = candles.filter((k) => k.to >= lo && k.from <= hi);
          const bodyW = Math.max(1.5, Math.min(14, (s.plot.w / Math.max(vis.length, 1)) * 0.62));
          for (const k of vis) {
            const up = k.c >= k.o;
            const col = up ? GREEN : RED;
            const px = s.px(k.x);
            c.strokeStyle = col;
            c.fillStyle = col;
            c.lineWidth = 1;
            c.beginPath();
            c.moveTo(px, s.py(k.h));
            c.lineTo(px, s.py(k.l));
            c.stroke();
            const yTop = s.py(Math.max(k.o, k.c));
            const yBot = s.py(Math.min(k.o, k.c));
            const hgt = Math.max(1.2, yBot - yTop);
            if (up) {
              c.globalAlpha = 0.25;
              c.fillRect(px - bodyW / 2, yTop, bodyW, hgt);
              c.globalAlpha = 1;
              c.strokeRect(px - bodyW / 2, yTop, bodyW, hgt);
            } else {
              c.fillRect(px - bodyW / 2, yTop, bodyW, hgt);
            }
          }
        });
      },
      probe: (x, s) => {
        let best: Candle | null = null;
        let bestD = Infinity;
        for (const k of candles) {
          const d = Math.abs(k.x - x);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        }
        if (!best) return null;
        return {
          px: s.px(best.x),
          py: s.py(best.c),
          title: `rounds ${best.from}\u2013${best.to}`,
          rows: [
            { k: "open / close", v: `${fmtMult(best.o)} \u2192 ${fmtMult(best.c)}` },
            { k: "high", v: fmtMult(best.h), tone: "warn" },
            { k: "low", v: fmtMult(best.l), tone: "bad" },
            { k: "\u22652\u00d7 in bucket", v: `${best.hits}/${best.n}` },
          ],
        };
      },
    };
  },
};

// ---------------------------------------------------------------------------
// distribution — observed histogram against the fair law
// ---------------------------------------------------------------------------

const distView: ViewDef = {
  id: "dist",
  label: "Distribution",
  hint: "Observed share of rounds per multiplier band, against what a fair game would produce.",
  xLabel: "multiplier",
  yLabel: "share of rounds",
  logX: true,
  logY: false,
  xUnit: "mult",
  build: ({ rounds, houseEdge, bins }) => {
    if (rounds.length < 20) return emptyView();
    const ms = rounds.map((r) => r.m);
    const maxM = Math.max(...ms);
    const top = Math.max(10, maxM);
    const edges: number[] = [];
    const lo = Math.log10(1);
    const hi = Math.log10(top * 1.02);
    for (let i = 0; i <= bins; i++) edges.push(10 ** (lo + ((hi - lo) * i) / bins));
    const counts = new Array<number>(bins).fill(0);
    for (const m of ms) {
      let idx = Math.floor(((Math.log10(Math.max(m, 1)) - lo) / (hi - lo)) * bins);
      idx = Math.min(bins - 1, Math.max(0, idx));
      counts[idx] += 1;
    }
    const n = ms.length;
    const obs = counts.map((k) => k / n);
    // Fair mass in [a, b): (1-h)(1/a - 1/b), plus the instant-crash atom of
    // size h sitting in the first bin.
    const fair = edges.slice(0, -1).map((a, i) => {
      const b = edges[i + 1];
      const mass = (1 - houseEdge) * (1 / a - 1 / b);
      return i === 0 ? mass + houseEdge : mass;
    });
    const peak = Math.max(...obs, ...fair);
    return {
      domain: { x0: 1, x1: top * 1.02, y0: 0, y1: peak * 1.12 },
      limits: { x0: 1, x1: top * 1.05, y0: 0, y1: peak * 1.5 },
      overview: obs.map((v, i) => [edges[i], v] as [number, number]),
      empty: false,
      draw: (c, s) => {
        clip(c, s, () => {
          const base = s.py(Math.min(s.vp.y0, s.vp.y1));
          for (let i = 0; i < bins; i++) {
            const a = s.px(edges[i]);
            const b = s.px(edges[i + 1]);
            const w = Math.max(1, b - a - 1);
            if (b < s.plot.l || a > s.plot.l + s.plot.w) continue;
            c.fillStyle = "rgba(43,217,124,0.42)";
            const yo = s.py(obs[i]);
            c.fillRect(a, yo, w, Math.max(0, base - yo));
          }
          // fair curve on top, stepped so it compares bin to bin
          c.beginPath();
          for (let i = 0; i < bins; i++) {
            const a = s.px(edges[i]);
            const b = s.px(edges[i + 1]);
            const y = s.py(fair[i]);
            if (i === 0) c.moveTo(a, y);
            else c.lineTo(a, y);
            c.lineTo(b, y);
          }
          c.strokeStyle = CYAN;
          c.lineWidth = 1.6;
          c.stroke();
        });
      },
      probe: (x, s) => {
        let i = edges.findIndex((e, k) => k < bins && x >= e && x < edges[k + 1]);
        if (i < 0) i = x >= edges[bins] ? bins - 1 : 0;
        const o = obs[i];
        const f = fair[i];
        return {
          px: (s.px(edges[i]) + s.px(edges[i + 1])) / 2,
          py: s.py(o),
          title: `${fmtMult(edges[i])} – ${fmtMult(edges[i + 1])}`,
          rows: [
            { k: "observed", v: `${(o * 100).toFixed(2)}%  (${counts[i]} rounds)`, tone: "good" },
            { k: "fair", v: `${(f * 100).toFixed(2)}%` },
            { k: "difference", v: `${o - f >= 0 ? "+" : ""}${((o - f) * 100).toFixed(2)} pp` },
          ],
        };
      },
    };
  },
};

// ---------------------------------------------------------------------------
// survival — P(M >= x), observed against fair, log-log
// ---------------------------------------------------------------------------

const survivalView: ViewDef = {
  id: "survival",
  label: "Survival",
  hint: "P(reach x) measured against (1 − h)/x. A straight line on log-log means the tail behaves.",
  xLabel: "target multiplier",
  yLabel: "P(reach target)",
  logX: true,
  logY: true,
  xUnit: "mult",
  build: ({ rounds, houseEdge }) => {
    if (rounds.length < 20) return emptyView();
    const ms = rounds.map((r) => r.m).sort((a, b) => a - b);
    const n = ms.length;
    const maxM = ms[n - 1];
    const grid: number[] = [];
    const steps = 160;
    for (let i = 0; i <= steps; i++) grid.push(10 ** ((Math.log10(Math.max(maxM, 2)) * i) / steps));
    const survival = (x: number) => {
      // ms is sorted: count of values >= x by binary search
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ms[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      return (n - lo) / n;
    };
    const obs = grid.map((x) => [x, survival(x)] as [number, number]);
    const floor = Math.max(1 / (n * 2), 1e-5);
    return {
      domain: { x0: 1, x1: Math.max(maxM * 1.05, 10), y0: floor, y1: 1.05 },
      limits: { x0: 1, x1: Math.max(maxM * 1.1, 10), y0: floor / 2, y1: 1.2 },
      overview: obs,
      empty: false,
      draw: (c, s) => {
        clip(c, s, () => {
          // fair
          c.beginPath();
          let started = false;
          for (const [x] of obs) {
            const y = Math.min(1, (1 - houseEdge) / x);
            const py = s.py(y);
            if (!started) {
              c.moveTo(s.px(x), py);
              started = true;
            } else c.lineTo(s.px(x), py);
          }
          c.strokeStyle = CYAN;
          c.setLineDash([5, 4]);
          c.lineWidth = 1.4;
          c.stroke();
          c.setLineDash([]);

          // observed
          c.beginPath();
          started = false;
          for (const [x, y] of obs) {
            if (y <= 0) break;
            const py = s.py(y);
            if (!started) {
              c.moveTo(s.px(x), py);
              started = true;
            } else c.lineTo(s.px(x), py);
          }
          c.strokeStyle = GREEN;
          c.lineWidth = 1.8;
          c.stroke();
        });
      },
      probe: (x, s) => {
        const xv = Math.max(1, x);
        const o = survival(xv);
        const f = Math.min(1, (1 - houseEdge) / xv);
        const hits = Math.round(o * n);
        // Standard error of a proportion, so the reader can tell a real gap
        // from sampling noise instead of eyeballing two lines.
        const se = Math.sqrt(Math.max(f * (1 - f), 1e-12) / n);
        const z = se > 0 ? (o - f) / se : 0;
        return {
          px: s.px(xv),
          py: s.py(Math.max(o, 1e-9)),
          title: `target ${fmtMult(xv)}`,
          rows: [
            { k: "observed", v: `${(o * 100).toFixed(2)}%  (${hits}/${n})`, tone: "good" },
            { k: "fair", v: `${(f * 100).toFixed(2)}%` },
            { k: "z score", v: z.toFixed(2), tone: Math.abs(z) > 2.5 ? "warn" : undefined },
            { k: "fair price", v: fmtMult(1 / Math.max(f, 1e-9)) },
          ],
        };
      },
    };
  },
};

// ---------------------------------------------------------------------------
// return map — round n against round n+1
// ---------------------------------------------------------------------------

const returnMapView: ViewDef = {
  id: "returnmap",
  label: "Return map",
  hint: "Each round against the one after it. Structure would show as clustering; independence looks like fog.",
  xLabel: "round n",
  yLabel: "round n + 1",
  logX: true,
  logY: true,
  xUnit: "mult",
  build: ({ rounds }) => {
    if (rounds.length < 30) return emptyView();
    const pairs: [number, number][] = [];
    for (let i = 1; i < rounds.length; i++) pairs.push([rounds[i - 1].m, rounds[i].m]);
    const maxM = Math.max(...pairs.flat());
    // Pearson correlation of the log pair, printed in the probe panel.
    const lx = pairs.map(([a]) => Math.log(a));
    const ly = pairs.map(([, b]) => Math.log(b));
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const mx = mean(lx);
    const my = mean(ly);
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < lx.length; i++) {
      num += (lx[i] - mx) * (ly[i] - my);
      dx += (lx[i] - mx) ** 2;
      dy += (ly[i] - my) ** 2;
    }
    const r = num / Math.sqrt(Math.max(dx * dy, 1e-12));
    return {
      domain: { x0: 1, x1: maxM * 1.05, y0: 1, y1: maxM * 1.05 },
      limits: { x0: 1, x1: maxM * 1.1, y0: 1, y1: maxM * 1.1 },
      overview: [],
      empty: false,
      draw: (c, s) => {
        refLine(c, s, 2, "rgba(255,77,94,0.3)", "next ≥ 2×");
        clip(c, s, () => {
          const px2 = s.px(2);
          c.strokeStyle = "rgba(255,77,94,0.3)";
          c.setLineDash([5, 5]);
          c.beginPath();
          c.moveTo(px2, s.plot.t);
          c.lineTo(px2, s.plot.t + s.plot.h);
          c.stroke();
          c.setLineDash([]);
          for (const [a, b] of pairs) {
            c.beginPath();
            c.arc(s.px(a), s.py(b), 1.9, 0, Math.PI * 2);
            c.fillStyle = a >= 2 && b >= 2 ? "rgba(43,217,124,0.5)" : "rgba(160,190,180,0.32)";
            c.fill();
          }
          c.font = "10px ui-monospace, monospace";
          c.fillStyle = MUTED;
          c.fillText(`log-log correlation r = ${r.toFixed(4)}`, s.plot.l + 8, s.plot.t + 14);
        });
      },
      probe: (x, s, my2) => {
        const yv = s.uy(my2);
        let best: [number, number] | null = null;
        let bestD = Infinity;
        for (const p of pairs) {
          const d = Math.hypot(s.px(p[0]) - s.px(x), s.py(p[1]) - my2);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (!best || bestD > 26) {
          return {
            px: s.px(x),
            py: my2,
            title: `${fmtMult(x)} → ${fmtMult(yv)}`,
            rows: [
              { k: "pairs plotted", v: String(pairs.length) },
              { k: "correlation r", v: r.toFixed(4), tone: Math.abs(r) > 0.1 ? "warn" : "good" },
            ],
          };
        }
        return {
          px: s.px(best[0]),
          py: s.py(best[1]),
          title: `${fmtMult(best[0])} → ${fmtMult(best[1])}`,
          rows: [
            { k: "this round", v: fmtMult(best[0]) },
            { k: "next round", v: fmtMult(best[1]) },
            { k: "correlation r", v: r.toFixed(4), tone: Math.abs(r) > 0.1 ? "warn" : "good" },
          ],
        };
      },
    };
  },
};

// ---------------------------------------------------------------------------
// equity — flat stake at a fixed cashout target
// ---------------------------------------------------------------------------

const equityView: ViewDef = {
  id: "equity",
  label: "Equity",
  hint: "One unit per round at a fixed cashout, replayed over the whole tape. The slope is the edge.",
  xLabel: "round on tape",
  yLabel: "units",
  logX: false,
  logY: false,
  xUnit: "round",
  build: ({ rounds, target, houseEdge }) => {
    if (rounds.length < 10) return emptyView();
    let eq = 0;
    let peak = 0;
    const pts: { x: number; eq: number; dd: number }[] = [];
    rounds.forEach((r, i) => {
      eq += r.m >= target ? target - 1 : -1;
      peak = Math.max(peak, eq);
      pts.push({ x: i + 1, eq, dd: eq - peak });
    });
    const eqs = pts.map((p) => p.eq);
    const lo = Math.min(0, ...eqs);
    const hi = Math.max(0, ...eqs);
    const pad = Math.max(2, (hi - lo) * 0.08);
    const expected = -houseEdge * rounds.length;
    return {
      domain: { x0: 1, x1: pts.length, y0: lo - pad, y1: hi + pad },
      limits: { x0: 1, x1: pts.length, y0: lo - pad * 3, y1: hi + pad * 3 },
      overview: thin(pts, 900).map((p) => [p.x, p.eq] as [number, number]),
      empty: false,
      yExtent: (a2, b2) => {
        const win = pts.filter((p) => p.x >= a2 && p.x <= b2);
        if (!win.length) return null;
        const wl = Math.min(0, ...win.map((p) => p.eq));
        const wh = Math.max(0, ...win.map((p) => p.eq));
        const wpad = Math.max(2, (wh - wl) * 0.1);
        return [wl - wpad, wh + wpad];
      },
      draw: (c, s) => {
        refLine(c, s, 0, "rgba(160,190,180,0.45)", "break even");
        refLine(c, s, expected, "rgba(56,199,232,0.55)", `expected ${expected.toFixed(0)} units`);
        clip(c, s, () => {
          const lo2 = Math.min(s.vp.x0, s.vp.x1);
          const hi2 = Math.max(s.vp.x0, s.vp.x1);
          const vis = thin(pts.filter((p) => p.x >= lo2 - 1 && p.x <= hi2 + 1), 2600);
          if (vis.length < 2) return;
          const zero = s.py(0);
          c.beginPath();
          c.moveTo(s.px(vis[0].x), s.py(vis[0].eq));
          for (const p of vis) c.lineTo(s.px(p.x), s.py(p.eq));
          c.lineTo(s.px(vis[vis.length - 1].x), zero);
          c.lineTo(s.px(vis[0].x), zero);
          c.closePath();
          c.fillStyle = "rgba(255,77,94,0.12)";
          c.fill();
          c.beginPath();
          c.moveTo(s.px(vis[0].x), s.py(vis[0].eq));
          for (const p of vis) c.lineTo(s.px(p.x), s.py(p.eq));
          c.strokeStyle = vis[vis.length - 1].eq >= 0 ? GREEN : RED;
          c.lineWidth = 1.6;
          c.stroke();
        });
      },
      probe: (x, s) => {
        let best = pts[0];
        let bestD = Infinity;
        for (const p of pts) {
          const d = Math.abs(p.x - x);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        return {
          px: s.px(best.x),
          py: s.py(best.eq),
          title: `after ${best.x} rounds`,
          rows: [
            { k: "equity", v: `${best.eq >= 0 ? "+" : ""}${best.eq.toFixed(1)} units`, tone: best.eq >= 0 ? "good" : "bad" },
            { k: "drawdown", v: `${best.dd.toFixed(1)} units` },
            { k: "per round", v: `${(best.eq / Math.max(best.x, 1)).toFixed(4)} units` },
            { k: "expected", v: `${(-houseEdge).toFixed(4)} units` },
          ],
        };
      },
    };
  },
};

export const VIEWS: ViewDef[] = [tapeView, candleView, distView, survivalView, returnMapView, equityView];

export function viewById(id: ChartId): ViewDef {
  return VIEWS.find((v) => v.id === id) ?? tapeView;
}

export { GRID, MUTED };
