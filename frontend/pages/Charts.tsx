/**
 * Chart Lab — six views over the same tape, zoomable and drawable.
 *
 * Drawings are stored server-side per visitor in data coordinates, so they
 * reattach to the exact multiplier and round after a reload.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { ChartLab } from "../components/chartlab/ChartLab";
import { ChartPrediction } from "../components/ChartPrediction";
import type { Annotation, AnnotationKind } from "../components/chartlab/engine";
import { describeAnnotation } from "../components/chartlab/engine";
import { type ChartId, VIEWS, viewById } from "../components/chartlab/views";
import {
  Btn,
  ErrorNote,
  Empty,
  Field,
  NumInput,
  PageHeader,
  Panel,
  Select,
  Source,
  Stat,
  ago,
} from "../components/kit";
import { cn } from "../lib/utils";
import { api } from "../lib/api";
import { useRounds } from "../lib/store";

const BUCKETS = [5, 10, 20, 50];

export default function Charts() {
  const { rounds, settings, total } = useRounds();
  const houseEdge = settings?.houseEdge ?? 0.03;

  const [view, setView] = useState<ChartId>("tape");
  const [bucket, setBucket] = useState(10);
  const [target, setTarget] = useState(settings?.defaultTarget ?? 2);
  const [bins, setBins] = useState(26);
  const [follow, setFollow] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const def = useMemo(() => viewById(view), [view]);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ annotations: Annotation[] }>("/annotations");
      setAnnotations(res.annotations);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load drawings");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (kind: AnnotationKind, points: [number, number][], color: string) => {
      // Optimistic: a drawing must appear the instant the pointer lifts, or the
      // tool feels broken. The negative id is replaced by the server's row.
      const temp: Annotation = { id: -Date.now(), chart: view, kind, points, color, label: null };
      setAnnotations((prev) => [...prev, temp]);
      setBusy(true);
      try {
        const saved = await api.post<Annotation>("/annotations", { chart: view, kind, points, color });
        setAnnotations((prev) => prev.map((a) => (a.id === temp.id ? saved : a)));
        setError(null);
      } catch (e) {
        setAnnotations((prev) => prev.filter((a) => a.id !== temp.id));
        setError(e instanceof Error ? e.message : "could not save the drawing");
      } finally {
        setBusy(false);
      }
    },
    [view],
  );

  const remove = useCallback(async (id: number) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    try {
      await api.del(`/annotations/${id}`);
    } catch {
      void load();
    }
  }, [load]);

  const clearView = useCallback(async () => {
    setAnnotations((prev) => prev.filter((a) => a.chart !== view));
    try {
      await api.del(`/annotations?chart=${view}`);
    } catch {
      void load();
    }
  }, [view, load]);

  const mine = annotations.filter((a) => a.chart === view);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader kicker={`${total} rounds on tape · drawings saved server-side`} title="Chart Lab">
        <span className="font-mono-num text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {busy ? "saving…" : `${annotations.length} drawing${annotations.length === 1 ? "" : "s"}`}
        </span>
      </PageHeader>

      {error ? <ErrorNote error={error} onRetry={() => void load()} /> : null}

      {/* view tabs */}
      <div className="mb-3 flex min-w-0 max-w-full gap-1 overflow-x-auto pb-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            aria-pressed={view === v.id}
            className={cn(
              "shrink-0 rounded border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors",
              view === v.id
                ? "border-accent/70 bg-accent/15 text-accent"
                : "border-border text-muted-foreground hover:border-accent/40 hover:text-foreground",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <Panel
        title={`${def.label} — ${def.yLabel} vs ${def.xLabel}`}
        note={def.hint}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {view === "candles" ? (
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                bucket
                <span className="w-[74px]">
                  <Select
                    value={String(bucket)}
                    onChange={(v) => setBucket(Number(v))}
                    options={BUCKETS.map((b) => ({ value: String(b), label: `${b} rds` }))}
                  />
                </span>
              </label>
            ) : null}
            {view === "equity" ? (
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                cash out
                <span className="w-[86px]">
                  <NumInput value={target} onChange={(v) => setTarget(Math.min(50, Math.max(1.01, v)))} step={0.1} min={1.01} max={50} />
                </span>
              </label>
            ) : null}
            {view === "dist" ? (
              <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                bins
                <span className="w-[74px]">
                  <NumInput value={bins} onChange={(v) => setBins(Math.min(60, Math.max(6, Math.round(v))))} step={1} min={6} max={60} />
                </span>
              </label>
            ) : null}
          </div>
        }
      >
        <ChartLab
          rounds={rounds}
          houseEdge={houseEdge}
          view={view}
          bucket={bucket}
          target={target}
          bins={bins}
          annotations={annotations}
          onCreate={create}
          onDelete={remove}
          follow={follow}
          onFollowChange={setFollow}
          height={440}
        />
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="drawings on this view"
          note="Stored as data coordinates, so they stay pinned to the same value through any zoom or reload."
          right={mine.length ? <Btn tone="danger" onClick={clearView}>clear view</Btn> : undefined}
        >
          {mine.length === 0 ? (
            <Empty
              title="nothing drawn here yet"
              body="Pick Level, Trend, Zone or Pen above and draw straight onto the chart. Everything you draw is saved against this view."
            />
          ) : (
            <ul className="divide-y divide-border/60 text-xs">
              {mine.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} aria-hidden />
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    <span className="uppercase tracking-[0.14em] text-muted-foreground">{a.kind}</span>{" "}
                    {describeAnnotation(a, def.xUnit)}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{a.createdAt ? ago(a.createdAt) : "just now"}</span>
                  <button
                    type="button"
                    onClick={() => remove(a.id)}
                    className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-destructive underline underline-offset-2"
                  >
                    delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="what each view is for">
          <dl className="space-y-2.5 text-xs leading-relaxed">
            {VIEWS.map((v) => (
              <div key={v.id}>
                <dt className="uppercase tracking-[0.16em] text-accent">{v.label}</dt>
                <dd className="text-muted-foreground">{v.hint}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      {/* the projected shape, drawn and decomposed — under the lab it belongs to */}
      <ChartPrediction />

      <Panel className="mt-4" title="reading these charts honestly">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="house edge in use" value={`${(houseEdge * 100).toFixed(1)}%`} sub="from Settings" />
          <Stat label="fair P(≥2×)" value={`${(((1 - houseEdge) / 2) * 100).toFixed(1)}%`} tone="muted" />
          <Stat label="fair median crash" value={`${(2 * (1 - houseEdge)).toFixed(2)}×`} tone="muted" />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          A drawing is a note to yourself, not a signal. Trendlines and zones drawn over independent rounds
          will look convincing in hindsight and predict nothing forward — that is exactly what the Return map
          and the Randomness Lab are there to show you. The dashed cyan overlays are the fair-game reference
          from <Source href="https://crashedge.com/guides/crash-gambling-maths/">the crash survival law</Source>{" "}
          P(M ≥ m) = (1 − h)/m, and the Equity view's expected line is just −h per round, which is the only
          reliable long-run slope on this page. If any of this stops feeling like analysis, the{" "}
          <Source href="https://www.begambleaware.org/">BeGambleAware</Source> people are the right next click.
        </p>
      </Panel>
    </div>
  );
}
