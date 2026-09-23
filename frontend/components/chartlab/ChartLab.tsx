/**
 * ChartLab — one interactive canvas that every view plugs into.
 *
 * Interaction model, kept deliberately close to a trading terminal:
 *   wheel            zoom the x axis about the cursor
 *   shift + wheel    pan the x axis
 *   ctrl/⌘ + wheel   zoom the y axis
 *   drag             pan (cursor tool)
 *   shift + drag     box zoom
 *   two fingers      pinch zoom
 *   double click     fit to data
 *   ← → ↑ ↓          pan · + −  zoom · 0 fit · ⌫ delete selected drawing
 *
 * Drawing tools write into DATA space and persist through the parent's
 * onCreate, so a level survives zoom, resize and reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import type { Round } from "../../lib/pipeline";
import {
  type Annotation,
  type AnnotationKind,
  type Draft,
  type Viewport,
  clampViewport,
  describeAnnotation,
  drawAnnotation,
  fmtAxis,
  fmtMult,
  hitAnnotation,
  makeScale,
  panAxis,
  ticksFor,
  zoomAxis,
} from "./engine";
import { type ChartId, GRID, MUTED, type Probe, viewById } from "./views";

export type Tool = "cursor" | AnnotationKind;

const TOOLS: { id: Tool; label: string; glyph: string; hint: string }[] = [
  { id: "cursor", label: "Pan", glyph: "✥", hint: "Drag to pan, shift-drag to box zoom, click a drawing to select it" },
  { id: "level", label: "Level", glyph: "―", hint: "Click to pin a horizontal level at that value" },
  { id: "trend", label: "Trend", glyph: "╱", hint: "Drag from one point to another" },
  { id: "rect", label: "Zone", glyph: "▭", hint: "Drag out a rectangle" },
  { id: "pen", label: "Pen", glyph: "✎", hint: "Draw freehand" },
];

const COLORS = ["#38c7e8", "#ffb020", "#ff4d5e", "#2bd97c", "#e8ecea"];
// Screen readers should hear a colour, not a hex triplet.
const COLOR_NAMES: Record<string, string> = {
  "#38c7e8": "cyan",
  "#ffb020": "amber",
  "#ff4d5e": "red",
  "#2bd97c": "green",
  "#e8ecea": "white",
};

const PAD = { l: 54, r: 16, t: 14, b: 28 };
const MINI_H = 44;

export interface ChartLabProps {
  rounds: Round[];
  houseEdge: number;
  view: ChartId;
  bucket: number;
  target: number;
  bins: number;
  annotations: Annotation[];
  onCreate: (kind: AnnotationKind, points: [number, number][], color: string) => void;
  onDelete: (id: number) => void;
  height?: number;
  /** keep the right edge pinned to the newest round while the feed runs */
  follow: boolean;
  onFollowChange: (v: boolean) => void;
}

export function ChartLab({
  rounds,
  houseEdge,
  view,
  bucket,
  target,
  bins,
  annotations,
  onCreate,
  onDelete,
  height = 420,
  follow,
  onFollowChange,
}: ChartLabProps) {
  const def = useMemo(() => viewById(view), [view]);
  const data = useMemo(
    () => def.build({ rounds, houseEdge, bucket, target, bins }),
    [def, rounds, houseEdge, bucket, target, bins],
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);

  const [size, setSize] = useState({ w: 800, h: height });
  const [vp, setVp] = useState<Viewport | null>(null);
  const [logX, setLogX] = useState(def.logX);
  const [logY, setLogY] = useState(def.logY);
  // The value axis tracks the visible window until the user scales it by hand.
  const [autoY, setAutoY] = useState(true);
  const [tool, setTool] = useState<Tool>("cursor");
  const [color, setColor] = useState(COLORS[0]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<string>(TOOLS[0].hint);

  const panRef = useRef<{ px: number; py: number; vp: Viewport } | null>(null);
  const pinchRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ dist: number; vp: Viewport } | null>(null);
  const miniDrag = useRef<"move" | null>(null);
  const rafRef = useRef(0);

  const mine = useMemo(() => annotations.filter((a) => a.chart === view), [annotations, view]);

  // Axis scale defaults belong to the view, so switching views re-arms them.
  useEffect(() => {
    setLogX(def.logX);
    setLogY(def.logY);
    setAutoY(true);
    setVp(data.empty ? null : data.domain);
    setSelected(null);
    setDraft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id]);

  useEffect(() => {
    if (!vp && !data.empty) setVp(data.domain);
  }, [vp, data]);

  const xLimits = useMemo(
    () => ({ min: data.limits.x0, max: data.limits.x1, minSpan: logX ? 0.08 : Math.max((data.limits.x1 - data.limits.x0) / 4000, 4) }),
    [data, logX],
  );
  const yLimits = useMemo(
    () => ({ min: data.limits.y0, max: data.limits.y1, minSpan: logY ? 0.08 : Math.max((data.limits.y1 - data.limits.y0) / 4000, 0.05) }),
    [data, logY],
  );

  // Follow the live edge: hold the window width, slide it to the newest round.
  const lastId = rounds.length ? rounds[rounds.length - 1].id : 0;
  useEffect(() => {
    if (!follow || !vp || def.xUnit !== "round" || data.empty) return;
    const span = vp.x1 - vp.x0;
    if (Math.abs(vp.x1 - lastId) < 0.5) return;
    setVp({ ...vp, x0: lastId - span, x1: lastId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, follow]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // A fixed 440px plot is nearly square on a phone; scale the height with the
    // available width on narrow screens so the chart keeps a readable ratio.
    const measure = () => {
      const w = el.clientWidth;
      setSize({ w, h: w < 560 ? Math.max(240, Math.round(w * 0.78)) : height });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [height]);

  const plot = useMemo(
    () => ({ l: PAD.l, t: PAD.t, w: Math.max(40, size.w - PAD.l - PAD.r), h: Math.max(40, size.h - PAD.t - PAD.b) }),
    [size],
  );
  /**
   * The viewport actually painted. With autoY on, y is derived from the x window
   * every frame, which is why zooming into a quiet stretch of tape fills the
   * panel instead of hugging the floor under some all-time 450x spike.
   */
  const vpEff = useMemo<Viewport | null>(() => {
    if (!vp) return null;
    if (!autoY || !data.yExtent) return vp;
    const ext = data.yExtent(Math.min(vp.x0, vp.x1), Math.max(vp.x0, vp.x1));
    return ext ? { ...vp, y0: ext[0], y1: ext[1] } : vp;
  }, [vp, autoY, data]);

  const scale = useMemo(() => (vpEff ? makeScale(plot, vpEff, logX, logY) : null), [plot, vpEff, logX, logY]);

  const probe: Probe | null = useMemo(() => {
    if (!scale || !cursor || data.empty || draft) return null;
    if (cursor.x < plot.l || cursor.x > plot.l + plot.w || cursor.y < plot.t || cursor.y > plot.t + plot.h) return null;
    return data.probe(scale.ux(cursor.x), scale, cursor.y);
  }, [scale, cursor, data, draft, plot]);

  // -------------------------------------------------------------------------
  // painting
  // -------------------------------------------------------------------------

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scale) return;
    const c = canvas.getContext("2d");
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== size.w * dpr || canvas.height !== size.h * dpr) {
      canvas.width = Math.max(1, size.w * dpr);
      canvas.height = Math.max(1, size.h * dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size.w, size.h);
    c.font = "9px ui-monospace, monospace";
    c.textBaseline = "alphabetic";

    const { l, t, w, h } = plot;

    // grid + axis labels
    const xt = ticksFor(Math.min(vpEff!.x0, vpEff!.x1), Math.max(vpEff!.x0, vpEff!.x1), logX, Math.max(3, Math.floor(w / 90)));
    const yt = ticksFor(Math.min(vpEff!.y0, vpEff!.y1), Math.max(vpEff!.y0, vpEff!.y1), logY, Math.max(3, Math.floor(h / 48)));
    c.strokeStyle = GRID;
    c.lineWidth = 1;
    c.fillStyle = MUTED;
    for (const v of yt) {
      const py = Math.round(scale.py(v)) + 0.5;
      if (py < t - 1 || py > t + h + 1) continue;
      c.beginPath();
      c.moveTo(l, py);
      c.lineTo(l + w, py);
      c.stroke();
      const label = def.yLabel === "multiplier" ? fmtMult(v) : def.yLabel === "P(reach target)" ? `${(v * 100).toFixed(v < 0.1 ? 2 : 0)}%` : def.yLabel === "share of rounds" ? `${(v * 100).toFixed(0)}%` : fmtAxis(v);
      c.textAlign = "right";
      // The crosshair puts its own value chip on the axis; skip the tick label it
      // would otherwise be printed on top of.
      if (!cursor || Math.abs(py - cursor.y) > 11) c.fillText(label, l - 6, py + 3);
    }
    c.textAlign = "center";
    for (const v of xt) {
      const px = Math.round(scale.px(v)) + 0.5;
      if (px < l - 1 || px > l + w + 1) continue;
      c.beginPath();
      c.moveTo(px, t);
      c.lineTo(px, t + h);
      c.stroke();
      if (!cursor || Math.abs(px - cursor.x) > 34)
        c.fillText(def.xUnit === "mult" ? fmtMult(v) : `#${Math.round(v)}`, px, t + h + 14);
    }
    c.textAlign = "left";

    // series
    data.draw(c, scale);

    // drawings, then the one being dragged out
    for (const a of mine) drawAnnotation(c, a, scale, a.id === selected);
    if (draft) drawAnnotation(c, draft, scale, true);

    // frame
    c.strokeStyle = "rgba(120,150,140,0.28)";
    c.strokeRect(l + 0.5, t + 0.5, w - 1, h - 1);

    // box zoom preview
    if (box) {
      c.fillStyle = "rgba(56,199,232,0.12)";
      c.strokeStyle = "rgba(56,199,232,0.7)";
      const x = Math.min(box.x0, box.x1);
      const y = Math.min(box.y0, box.y1);
      c.fillRect(x, y, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
      c.strokeRect(x, y, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
    }

    // crosshair
    if (cursor && cursor.x >= l && cursor.x <= l + w && cursor.y >= t && cursor.y <= t + h) {
      c.save();
      c.strokeStyle = "rgba(232,236,234,0.35)";
      c.setLineDash([3, 4]);
      c.beginPath();
      c.moveTo(cursor.x, t);
      c.lineTo(cursor.x, t + h);
      c.moveTo(l, cursor.y);
      c.lineTo(l + w, cursor.y);
      c.stroke();
      c.setLineDash([]);
      // axis chips
      const yv = scale.uy(cursor.y);
      const xv = scale.ux(cursor.x);
      const yTxt = def.yLabel === "multiplier" ? fmtMult(yv) : def.yLabel.startsWith("P(") || def.yLabel === "share of rounds" ? `${(yv * 100).toFixed(2)}%` : yv.toFixed(2);
      const xTxt = def.xUnit === "mult" ? fmtMult(xv) : `#${Math.round(xv)}`;
      c.font = "9px ui-monospace, monospace";
      c.textAlign = "left";
      const yw = c.measureText(yTxt).width + 8;
      c.fillStyle = "rgba(5,16,11,0.92)";
      c.fillRect(l - yw - 2, cursor.y - 7, yw, 14);
      c.fillStyle = "#e8ecea";
      c.fillText(yTxt, l - yw + 2, cursor.y + 3);
      const xw = c.measureText(xTxt).width + 10;
      c.fillStyle = "rgba(5,16,11,0.92)";
      c.fillRect(cursor.x - xw / 2, t + h + 3, xw, 13);
      c.fillStyle = "#e8ecea";
      c.fillText(xTxt, cursor.x - xw / 2 + 5, t + h + 13);
      c.restore();
    }

    // probe marker
    if (probe) {
      c.beginPath();
      c.arc(probe.px, probe.py, 4.5, 0, Math.PI * 2);
      c.strokeStyle = "#e8ecea";
      c.lineWidth = 1.4;
      c.stroke();
    }
  }, [scale, size, plot, vpEff, logX, logY, data, def, mine, selected, draft, box, cursor, probe]);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(rafRef.current);
  }, [paint]);

  // minimap
  useEffect(() => {
    const canvas = miniRef.current;
    if (!canvas || !vp || !data.overview.length) return;
    const c = canvas.getContext("2d");
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = size.w;
    if (canvas.width !== w * dpr || canvas.height !== MINI_H * dpr) {
      canvas.width = Math.max(1, w * dpr);
      canvas.height = MINI_H * dpr;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, MINI_H);
    const xs = data.overview.map((p) => p[0]);
    const ys = data.overview.map((p) => p[1]);
    const ax0 = Math.min(...xs);
    const ax1 = Math.max(...xs);
    const ay0 = Math.min(...ys);
    const ay1 = Math.max(...ys);
    // The minimap has to share the main axis transform, otherwise a log-x view
    // squashes its whole overview into the first few pixels.
    const f = (x: number) => (logX ? Math.log10(Math.max(x, 1e-9)) : x);
    const fx0 = f(ax0);
    const fx1 = f(ax1);
    const px = (x: number) => ((f(x) - fx0) / Math.max(fx1 - fx0, 1e-9)) * (w - 2) + 1;
    const py = (y: number) => MINI_H - 3 - ((y - ay0) / Math.max(ay1 - ay0, 1e-9)) * (MINI_H - 8);
    c.beginPath();
    c.moveTo(px(data.overview[0][0]), py(data.overview[0][1]));
    for (const [x, y] of data.overview) c.lineTo(px(x), py(y));
    c.strokeStyle = "rgba(43,217,124,0.55)";
    c.lineWidth = 1;
    c.stroke();
    // window
    const wx0 = px(Math.min(vp.x0, vp.x1));
    const wx1 = px(Math.max(vp.x0, vp.x1));
    c.fillStyle = "rgba(5,16,11,0.55)";
    c.fillRect(0, 0, Math.max(0, wx0), MINI_H);
    c.fillRect(Math.min(w, wx1), 0, w - wx1, MINI_H);
    c.strokeStyle = "rgba(56,199,232,0.8)";
    c.strokeRect(wx0 + 0.5, 0.5, Math.max(2, wx1 - wx0) - 1, MINI_H - 1);
  }, [data, vp, size.w, logX]);

  // -------------------------------------------------------------------------
  // interaction
  // -------------------------------------------------------------------------

  const localPos = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const zoomBoth = view === "returnmap" || view === "dist";

  const handleWheel = (e: WheelEvent) => {
    if (!vp) return;
    e.preventDefault();
    const p = localPos(e);
    const s = makeScale(plot, vp, logX, logY);
    const factor = Math.exp((e.deltaY > 0 ? 1 : -1) * 0.18);
    if (e.shiftKey) {
      const [x0, x1] = panAxis(vp.x0, vp.x1, (e.deltaY > 0 ? 1 : -1) * 0.12, logX, xLimits);
      setVp({ ...vp, x0, x1 });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const base = vpEff ?? vp;
      const [y0, y1] = zoomAxis(base.y0, base.y1, s.uy(p.y), factor, logY, yLimits);
      setAutoY(false);
      setVp({ ...vp, y0, y1 });
      return;
    }
    const [x0, x1] = zoomAxis(vp.x0, vp.x1, s.ux(p.x), factor, logX, xLimits);
    if (zoomBoth) {
      const [y0, y1] = zoomAxis(vp.y0, vp.y1, s.uy(p.y), factor, logY, yLimits);
      setVp({ x0, x1, y0, y1 });
    } else {
      setVp({ ...vp, x0, x1 });
    }
    if (follow) onFollowChange(false);
  };

  // React's onWheel is registered passive, so preventDefault there is ignored
  // and the page scrolls away under the chart. Bind it natively instead.
  const wheelRef = useRef(handleWheel);
  wheelRef.current = handleWheel;
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const fn = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", fn, { passive: false });
    return () => el.removeEventListener("wheel", fn);
    // The canvas is not in the tree until the tape has enough rounds to draw, so
    // this has to re-run when that flips or the listener never lands.
  }, [data.empty]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!vp) return;
    canvasRef.current?.setPointerCapture(e.pointerId);
    pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current.size === 2) {
      const [a, b] = [...pinchRef.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), vp };
      panRef.current = null;
      setDraft(null);
      return;
    }
    const p = localPos(e);
    const s = makeScale(plot, vp, logX, logY);

    if (tool === "cursor") {
      if (e.shiftKey) {
        setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        return;
      }
      const hit = hitAnnotation(mine, s, p.x, p.y);
      setSelected(hit ? hit.id : null);
      panRef.current = { px: p.x, py: p.y, vp };
      return;
    }

    const dx = s.ux(p.x);
    const dy = s.uy(p.y);
    if (tool === "level") {
      onCreate("level", [[dx, dy]], color);
      return;
    }
    setDraft({ kind: tool, points: tool === "pen" ? [[dx, dy]] : [[dx, dy], [dx, dy]], color });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!vp) return;
    const p = localPos(e);
    setCursor(p);
    if (pinchRef.current.has(e.pointerId)) pinchRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchRef.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pinchRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const start = pinchStart.current;
      const factor = Math.min(4, Math.max(0.25, start.dist / Math.max(dist, 1)));
      const s0 = makeScale(plot, start.vp, logX, logY);
      const anchor = s0.ux(plot.l + plot.w / 2);
      const [x0, x1] = zoomAxis(start.vp.x0, start.vp.x1, anchor, factor, logX, xLimits);
      if (zoomBoth) {
        const [y0, y1] = zoomAxis(start.vp.y0, start.vp.y1, s0.uy(plot.t + plot.h / 2), factor, logY, yLimits);
        setAutoY(false);
        setVp({ x0, x1, y0, y1 });
      } else setVp({ ...start.vp, x0, x1 });
      return;
    }

    if (box) {
      setBox({ ...box, x1: p.x, y1: p.y });
      return;
    }

    if (draft) {
      const s = makeScale(plot, vp, logX, logY);
      const pt: [number, number] = [s.ux(p.x), s.uy(p.y)];
      if (draft.kind === "pen") {
        const last = draft.points[draft.points.length - 1];
        const lastPx = [s.px(last[0]), s.py(last[1])];
        if (Math.hypot(lastPx[0] - p.x, lastPx[1] - p.y) < 2.5) return;
        setDraft({ ...draft, points: [...draft.points, pt] });
      } else {
        setDraft({ ...draft, points: [draft.points[0], pt] });
      }
      return;
    }

    const pan = panRef.current;
    if (pan) {
      const s = makeScale(plot, pan.vp, logX, logY);
      const fx = -(p.x - pan.px) / plot.w;
      const [x0, x1] = panAxis(pan.vp.x0, pan.vp.x1, fx, logX, xLimits);
      if (autoY) {
        setVp({ ...pan.vp, x0, x1 });
      } else {
        const fy = (p.y - pan.py) / plot.h;
        const [y0, y1] = panAxis(pan.vp.y0, pan.vp.y1, fy, logY, yLimits);
        setVp({ x0, x1, y0, y1 });
      }
      if (follow && Math.abs(p.x - pan.px) > 3) onFollowChange(false);
      void s;
    }
  };

  const finishPointer = (e: React.PointerEvent) => {
    pinchRef.current.delete(e.pointerId);
    if (pinchRef.current.size < 2) pinchStart.current = null;
    panRef.current = null;

    if (box) {
      const { x0, y0, x1, y1 } = box;
      setBox(null);
      if (Math.abs(x1 - x0) > 8 && Math.abs(y1 - y0) > 8 && vp) {
        const s = makeScale(plot, vp, logX, logY);
        const nx = [s.ux(Math.min(x0, x1)), s.ux(Math.max(x0, x1))];
        const ny = [s.uy(Math.max(y0, y1)), s.uy(Math.min(y0, y1))];
        setAutoY(false);
        setVp(
          clampViewport({ x0: nx[0], x1: nx[1], y0: ny[0], y1: ny[1] }, xLimits, yLimits, logX, logY),
        );
        onFollowChange(false);
      }
      return;
    }

    if (draft) {
      const pts = draft.points;
      const enough =
        draft.kind === "pen"
          ? pts.length > 2
          : Math.abs(pts[1][0] - pts[0][0]) > 0 || Math.abs(pts[1][1] - pts[0][1]) > 0;
      if (enough) onCreate(draft.kind, pts, draft.color);
      setDraft(null);
    }
  };

  const fit = useCallback(() => {
    if (data.empty) return;
    setAutoY(true);
    setVp(data.domain);
  }, [data]);

  // "fit" returns to the view's natural window; "all" frames every round on the
  // tape, which is what people usually mean by zoom-to-fit.
  const fitAll = useCallback(() => {
    if (data.empty) return;
    setAutoY(true);
    setVp(data.limits);
  }, [data]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!vp) return;
    const nudge = (frac: number) => {
      const [x0, x1] = panAxis(vp.x0, vp.x1, frac, logX, xLimits);
      setVp({ ...vp, x0, x1 });
      onFollowChange(false);
    };
    const zoom = (factor: number) => {
      const [x0, x1] = zoomAxis(vp.x0, vp.x1, (vp.x0 + vp.x1) / 2, factor, logX, xLimits);
      setVp({ ...vp, x0, x1 });
    };
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        nudge(-0.12);
        break;
      case "ArrowRight":
        e.preventDefault();
        nudge(0.12);
        break;
      case "ArrowUp": {
        e.preventDefault();
        const base = vpEff ?? vp;
        const [y0, y1] = panAxis(base.y0, base.y1, 0.1, logY, yLimits);
        setAutoY(false);
        setVp({ ...vp, y0, y1 });
        break;
      }
      case "ArrowDown": {
        e.preventDefault();
        const base = vpEff ?? vp;
        const [y0, y1] = panAxis(base.y0, base.y1, -0.1, logY, yLimits);
        setAutoY(false);
        setVp({ ...vp, y0, y1 });
        break;
      }
      case "+":
      case "=":
        zoom(0.8);
        break;
      case "-":
      case "_":
        zoom(1.25);
        break;
      case "0":
        fit();
        break;
      case "Escape":
        setDraft(null);
        setSelected(null);
        break;
      case "Backspace":
      case "Delete":
        if (selected !== null) {
          onDelete(selected);
          setSelected(null);
        }
        break;
      default:
        break;
    }
  };

  // minimap drag: move the window to where the user points
  const miniTo = (clientX: number) => {
    const canvas = miniRef.current;
    if (!canvas || !vp || !data.overview.length) return;
    const r = canvas.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const xs = data.overview.map((p) => p[0]);
    const ax0 = Math.min(...xs);
    const ax1 = Math.max(...xs);
    const f = (x: number) => (logX ? Math.log10(Math.max(x, 1e-9)) : x);
    const fInv = (v: number) => (logX ? Math.pow(10, v) : v);
    const center = fInv(f(ax0) + frac * (f(ax1) - f(ax0)));
    const span = vp.x1 - vp.x0;
    const [x0, x1] = panAxis(vp.x0, vp.x1, (center - (vp.x0 + span / 2)) / span, logX, xLimits);
    setVp({ ...vp, x0, x1 });
    onFollowChange(false);
  };

  const zoomPct = vp && !data.empty
    ? Math.round(((data.limits.x1 - data.limits.x0) / Math.max(vp.x1 - vp.x0, 1e-9)) * 100)
    : 100;

  const selectedAnn = mine.find((a) => a.id === selected) ?? null;

  if (data.empty) {
    return (
      <div className="flex h-64 items-center justify-center rounded border border-border bg-background/40 text-xs text-muted-foreground">
        not enough rounds on the tape for this view yet
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {/* toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="flex overflow-hidden rounded border border-border">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTool(t.id);
                setHint(t.hint);
                setDraft(null);
              }}
              onMouseEnter={() => setHint(t.hint)}
              aria-pressed={tool === t.id}
              title={t.label}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors",
                tool === t.id ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span aria-hidden className="text-xs leading-none">{t.glyph}</span>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded border border-border px-1.5 py-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`draw in ${COLOR_NAMES[c] ?? c}`}
              aria-pressed={color === c}
              className={cn("h-3.5 w-3.5 rounded-full border transition-transform", color === c ? "scale-125 border-foreground" : "border-transparent")}
              style={{ background: c }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setLogY((v) => !v)}
          aria-pressed={logY}
          className={cn(
            "rounded border px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors",
            logY ? "border-accent/60 text-accent" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          log y
        </button>
        <button
          type="button"
          onClick={() => setLogX((v) => !v)}
          aria-pressed={logX}
          className={cn(
            "rounded border px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors",
            logX ? "border-accent/60 text-accent" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          log x
        </button>
        {def.xUnit === "round" ? (
          <button
            type="button"
            onClick={() => onFollowChange(!follow)}
            aria-pressed={follow}
            className={cn(
              "rounded border px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors",
              follow ? "border-accent/60 text-accent" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            follow live
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setAutoY((v) => !v)}
          aria-pressed={autoY}
          title="Rescale the value axis to whatever is in view"
          className={cn(
            "rounded border px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors",
            autoY ? "border-accent/60 text-accent" : "border-border text-muted-foreground hover:text-foreground",
            data.yExtent ? "" : "hidden",
          )}
        >
          auto y
        </button>
        <button
          type="button"
          onClick={fit}
          className="rounded border border-border px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
        >
          fit
        </button>
        <button
          type="button"
          onClick={fitAll}
          className="rounded border border-border px-2 py-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
        >
          all
        </button>
        <span className="ml-auto font-mono-num text-[10px] text-muted-foreground">{zoomPct}% · {Math.round(Math.abs(vp ? vp.x1 - vp.x0 : 0))} {def.xUnit === "round" ? "rounds" : "×"} shown</span>
      </div>

      {/* canvas */}
      <div ref={wrapRef} className="relative min-w-0 select-none rounded border border-border bg-background/40">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          role="img"
          aria-label={`${def.label} chart — ${def.hint}`}
          style={{ width: "100%", height: size.h, display: "block", touchAction: "none", cursor: tool === "cursor" ? (panRef.current ? "grabbing" : "crosshair") : "copy" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          onPointerLeave={() => setCursor(null)}
          onDoubleClick={fit}
          onKeyDown={onKeyDown}
        />
        {probe && cursor ? (
          <div
            className="pointer-events-none absolute z-10 w-[190px] rounded border border-border bg-card/95 p-2 text-[10px] shadow-lg"
            style={{
              left: Math.min(Math.max(cursor.x + 14, 4), Math.max(4, size.w - 198)),
              top: Math.min(Math.max(cursor.y - 10, 4), Math.max(4, size.h - 96)),
            }}
          >
            <p className="mb-1 uppercase tracking-[0.18em] text-muted-foreground">{probe.title}</p>
            {probe.rows.map((r) => (
              <p key={r.k} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{r.k}</span>
                <span
                  className={cn(
                    "font-mono-num",
                    r.tone === "good" ? "text-accent" : r.tone === "warn" ? "text-[#ffb020]" : r.tone === "bad" ? "text-destructive" : "text-foreground",
                  )}
                >
                  {r.v}
                </span>
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {/* minimap */}
      {data.overview.length ? (
        <div className="mt-1.5 min-w-0 rounded border border-border bg-background/30">
          <canvas
            ref={miniRef}
            style={{ width: "100%", height: MINI_H, display: "block", touchAction: "none", cursor: "ew-resize" }}
            aria-label="chart overview — drag to move the visible window"
            onPointerDown={(e) => {
              miniRef.current?.setPointerCapture(e.pointerId);
              miniDrag.current = "move";
              miniTo(e.clientX);
            }}
            onPointerMove={(e) => {
              if (miniDrag.current) miniTo(e.clientX);
            }}
            onPointerUp={() => {
              miniDrag.current = null;
            }}
          />
        </div>
      ) : null}

      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {hint}. Wheel zooms, shift-wheel pans, ⌘/ctrl-wheel zooms the value axis, double click fits.
        {selectedAnn ? (
          <>
            {" "}Selected: <span className="text-foreground">{describeAnnotation(selectedAnn, def.xUnit)}</span> —{" "}
            <button type="button" className="text-destructive underline underline-offset-2" onClick={() => { onDelete(selectedAnn.id); setSelected(null); }}>
              delete
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}

export { TOOLS, COLORS };
export type { Annotation };
