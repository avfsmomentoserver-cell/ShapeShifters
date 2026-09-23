/**
 * Chart engine — scales, zoom/pan math, ticks and hit testing.
 *
 * Everything the charts draw lives in DATA coordinates and is projected to
 * pixels at paint time through a Scale. That single rule is what makes the
 * charts zoomable and drawable at once: a level the user drew at 3.2x is stored
 * as 3.2, so it stays welded to 3.2 through every zoom, pan, resize and
 * axis-scale flip, and it survives a reload because the same number goes to the
 * database.
 */

export interface Viewport {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Box {
  l: number;
  t: number;
  w: number;
  h: number;
}

export interface Scale {
  plot: Box;
  vp: Viewport;
  logX: boolean;
  logY: boolean;
  /** data x -> pixel x */
  px: (x: number) => number;
  /** data y -> pixel y */
  py: (y: number) => number;
  /** pixel x -> data x */
  ux: (px: number) => number;
  /** pixel y -> data y */
  uy: (py: number) => number;
}

const EPS = 1e-9;

/** Axis transform. Log axes work in log10 space; values <= 0 are clamped. */
export function fwd(v: number, log: boolean): number {
  return log ? Math.log10(Math.max(v, 1e-6)) : v;
}

export function inv(v: number, log: boolean): number {
  return log ? 10 ** v : v;
}

export function makeScale(plot: Box, vp: Viewport, logX: boolean, logY: boolean): Scale {
  const ax0 = fwd(vp.x0, logX);
  const ax1 = fwd(vp.x1, logX);
  const ay0 = fwd(vp.y0, logY);
  const ay1 = fwd(vp.y1, logY);
  const sx = plot.w / Math.max(ax1 - ax0, EPS);
  const sy = plot.h / Math.max(ay1 - ay0, EPS);
  return {
    plot,
    vp,
    logX,
    logY,
    px: (x) => plot.l + (fwd(x, logX) - ax0) * sx,
    py: (y) => plot.t + plot.h - (fwd(y, logY) - ay0) * sy,
    ux: (p) => inv(ax0 + (p - plot.l) / sx, logX),
    uy: (p) => inv(ay0 + (plot.t + plot.h - p) / sy, logY),
  };
}

// ---------------------------------------------------------------------------
// zoom / pan
// ---------------------------------------------------------------------------

export interface AxisLimits {
  min: number;
  max: number;
  /** smallest span the user may zoom into, in data units (log axes: decades) */
  minSpan: number;
}

/**
 * Zoom one axis about an anchor value, keeping that anchor pinned under the
 * cursor. `factor` < 1 zooms in. Works in transformed space so log axes zoom
 * evenly per decade.
 */
export function zoomAxis(
  a0: number,
  a1: number,
  anchor: number,
  factor: number,
  log: boolean,
  limits: AxisLimits,
): [number, number] {
  const t0 = fwd(a0, log);
  const t1 = fwd(a1, log);
  const ta = Math.min(Math.max(fwd(anchor, log), t0), t1);
  const lo = fwd(limits.min, log);
  const hi = fwd(limits.max, log);
  const minSpan = log ? Math.max(limits.minSpan, 0.05) : limits.minSpan;
  const maxSpan = hi - lo;

  let span = (t1 - t0) * factor;
  span = Math.min(Math.max(span, minSpan), Math.max(maxSpan, minSpan));

  const frac = (ta - t0) / Math.max(t1 - t0, EPS);
  let n0 = ta - frac * span;
  let n1 = n0 + span;

  // Slide back inside the data limits rather than letting the view drift off
  // the end of the series, which is the usual way a zoomable chart ends up
  // staring at empty space.
  if (n0 < lo) {
    n1 += lo - n0;
    n0 = lo;
  }
  if (n1 > hi) {
    n0 -= n1 - hi;
    n1 = hi;
  }
  n0 = Math.max(n0, lo);
  return [inv(n0, log), inv(n1, log)];
}

/** Pan one axis by a fraction of its current span. */
export function panAxis(
  a0: number,
  a1: number,
  deltaFraction: number,
  log: boolean,
  limits: AxisLimits,
): [number, number] {
  const t0 = fwd(a0, log);
  const t1 = fwd(a1, log);
  const lo = fwd(limits.min, log);
  const hi = fwd(limits.max, log);
  const span = t1 - t0;
  let n0 = t0 + span * deltaFraction;
  let n1 = n0 + span;
  if (n0 < lo) {
    n0 = lo;
    n1 = lo + span;
  }
  if (n1 > hi) {
    n1 = hi;
    n0 = hi - span;
  }
  return [inv(Math.max(n0, lo), log), inv(n1, log)];
}

export function clampViewport(vp: Viewport, xl: AxisLimits, yl: AxisLimits, logX: boolean, logY: boolean): Viewport {
  const [x0, x1] = zoomAxis(vp.x0, vp.x1, (vp.x0 + vp.x1) / 2, 1, logX, xl);
  const [y0, y1] = zoomAxis(vp.y0, vp.y1, (vp.y0 + vp.y1) / 2, 1, logY, yl);
  return { x0, x1, y0, y1 };
}

// ---------------------------------------------------------------------------
// ticks
// ---------------------------------------------------------------------------

export function linearTicks(min: number, max: number, target = 6): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [min];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-6; t += step) {
    out.push(Number(t.toFixed(10)));
  }
  return out;
}

/** 1-2-5 per decade, thinned so a wide log view does not turn into a comb. */
export function logTicks(min: number, max: number, target = 6): number[] {
  const lo = Math.floor(Math.log10(Math.max(min, 1e-6)));
  const hi = Math.ceil(Math.log10(Math.max(max, 1e-6)));
  const all: number[] = [];
  for (let d = lo; d <= hi; d++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** d;
      if (v >= min * 0.999 && v <= max * 1.001) all.push(v);
    }
  }
  if (all.length <= target * 1.6) return all;
  const decades: number[] = [];
  for (let d = lo; d <= hi; d++) {
    const v = 10 ** d;
    if (v >= min * 0.999 && v <= max * 1.001) decades.push(v);
  }
  return decades.length >= 2 ? decades : all;
}

export function ticksFor(min: number, max: number, log: boolean, target = 6): number[] {
  return log ? logTicks(min, max, target) : linearTicks(min, max, target);
}

export function fmtMult(v: number): string {
  if (v >= 100) return `${Math.round(v)}×`;
  if (v >= 10) return `${v.toFixed(1)}×`;
  return `${v.toFixed(2)}×`;
}

export function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return `${(v / 1000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  if (a >= 10) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  if (a === 0) return "0";
  return v.toFixed(2);
}

// ---------------------------------------------------------------------------
// annotations
// ---------------------------------------------------------------------------

export type AnnotationKind = "level" | "trend" | "rect" | "pen";

export interface Annotation {
  id: number;
  chart: string;
  kind: AnnotationKind;
  /** [[x, y], ...] in data coordinates */
  points: [number, number][];
  color: string;
  label: string | null;
  createdAt?: string;
}

/** Draft annotation being dragged out, before it is committed to the server. */
export interface Draft {
  kind: AnnotationKind;
  points: [number, number][];
  color: string;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Nearest annotation within `tol` pixels of the cursor, or null. */
export function hitAnnotation(
  anns: Annotation[],
  s: Scale,
  mx: number,
  my: number,
  tol = 7,
): Annotation | null {
  let best: Annotation | null = null;
  let bestD = tol;
  for (const a of anns) {
    const pts = a.points.map(([x, y]) => [s.px(x), s.py(y)] as [number, number]);
    let d = Infinity;
    if (a.kind === "level" && pts[0]) {
      d = Math.abs(my - pts[0][1]);
    } else if (a.kind === "rect" && pts.length >= 2) {
      const [ax, ay] = pts[0];
      const [bx, by] = pts[1];
      const l = Math.min(ax, bx);
      const r = Math.max(ax, bx);
      const t = Math.min(ay, by);
      const b = Math.max(ay, by);
      d = Math.min(
        distToSegment(mx, my, l, t, r, t),
        distToSegment(mx, my, r, t, r, b),
        distToSegment(mx, my, r, b, l, b),
        distToSegment(mx, my, l, b, l, t),
      );
      if (mx > l && mx < r && my > t && my < b) d = Math.min(d, tol - 1);
    } else {
      for (let i = 1; i < pts.length; i++) {
        d = Math.min(d, distToSegment(mx, my, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
      }
    }
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

export function drawAnnotation(
  c: CanvasRenderingContext2D,
  a: Annotation | Draft,
  s: Scale,
  selected: boolean,
): void {
  const pts = a.points.map(([x, y]) => [s.px(x), s.py(y)] as [number, number]);
  if (!pts.length) return;
  const { l, t, w, h } = s.plot;
  c.save();
  c.beginPath();
  c.rect(l, t, w, h);
  c.clip();
  c.strokeStyle = a.color;
  c.fillStyle = a.color;
  c.lineWidth = selected ? 2.2 : 1.4;
  // The axis pass leaves textAlign centered; without resetting it here the label
  // slides half its width off its own chip and vanishes against the background.
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  c.setLineDash(selected ? [] : a.kind === "level" ? [6, 4] : []);

  if (a.kind === "level") {
    const y = pts[0][1];
    c.beginPath();
    c.moveTo(l, y);
    c.lineTo(l + w, y);
    c.stroke();
    const label = "label" in a && a.label ? a.label : fmtMult(a.points[0][1]);
    c.setLineDash([]);
    c.font = "10px ui-monospace, monospace";
    const tw = c.measureText(label).width;
    c.globalAlpha = 0.9;
    // Inset from the right edge so the chip never collides with the plot border
    // or with a trend line that happens to end in the same corner.
    const lx = l + w - tw - 48;
    c.fillRect(lx, y - 13, tw + 8, 13);
    c.globalAlpha = 1;
    c.fillStyle = "#05100b";
    c.fillText(label, lx + 4, y - 3);
  } else if (a.kind === "trend" && pts.length >= 2) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    c.lineTo(pts[1][0], pts[1][1]);
    c.stroke();
    for (const p of pts.slice(0, 2)) {
      c.beginPath();
      c.arc(p[0], p[1], selected ? 3.4 : 2.4, 0, Math.PI * 2);
      c.fill();
    }
  } else if (a.kind === "rect" && pts.length >= 2) {
    const x = Math.min(pts[0][0], pts[1][0]);
    const y = Math.min(pts[0][1], pts[1][1]);
    const rw = Math.abs(pts[1][0] - pts[0][0]);
    const rh = Math.abs(pts[1][1] - pts[0][1]);
    c.globalAlpha = 0.13;
    c.fillRect(x, y, rw, rh);
    c.globalAlpha = 1;
    c.strokeRect(x, y, rw, rh);
  } else if (a.kind === "pen") {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.lineJoin = "round";
    c.stroke();
  }
  c.restore();
}

/** Human summary of a drawing, for the annotation list. */
export function describeAnnotation(a: Annotation, xUnit: "round" | "mult"): string {
  const fx = (v: number) => (xUnit === "round" ? `#${Math.round(v)}` : fmtMult(v));
  const p = a.points;
  switch (a.kind) {
    case "level":
      return `level at ${fmtMult(p[0]?.[1] ?? 0)}`;
    case "trend": {
      if (p.length < 2) return "trendline";
      const rise = p[1][1] - p[0][1];
      return `trend ${fx(p[0][0])} → ${fx(p[1][0])}, ${rise >= 0 ? "+" : ""}${rise.toFixed(2)}`;
    }
    case "rect": {
      if (p.length < 2) return "zone";
      const lo = Math.min(p[0][1], p[1][1]);
      const hi = Math.max(p[0][1], p[1][1]);
      return `zone ${fmtMult(lo)}–${fmtMult(hi)} over ${fx(Math.min(p[0][0], p[1][0]))}–${fx(Math.max(p[0][0], p[1][0]))}`;
    }
    default:
      return `freehand, ${p.length} points`;
  }
}
