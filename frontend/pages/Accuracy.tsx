/**
 * Accuracy — scores the engine against forecasts it locked before the round
 * landed, and against the fair price it has to beat to be worth anything.
 */
import { useState } from "react";

import {
  Async,
  Cell,
  Empty,
  Grid,
  NumInput,
  PageHeader,
  Panel,
  Row,
  Stat,
  Table,
  Verdict,
  ago,
  mult,
  num,
  pct,
  useApi,
} from "@/components/kit";

interface Calibration {
  threshold: number;
  scored: number;
  brierScore: number;
  brierBaseline: number;
  brierSkillScore: number;
  logLossModel: number;
  logLossFairPrice: number;
  beatsFairPrice: boolean;
  observedHitRate: number;
  fairHitRate: number;
  meanPrediction: number;
  buckets: { predictedLow: number; predictedHigh: number; predictedMean: number; observedRate: number; samples: number }[];
  verdict: string;
}

interface Ledger {
  open: null | { state: string; probability: number; rangeLow: number; rangeHigh: number | null; createdAt: string };
  entries: {
    id: number;
    state: string;
    probability: number;
    rangeLow: number;
    rangeHigh: number | null;
    actual: number | null;
    bandHit: boolean | null;
    brier: number | null;
    createdAt: string;
  }[];
  resolvedCount: number;
  bandAccuracy: number;
  accuracy2x: number;
  accuracy10x: number;
  avgBrier: number | null;
  byState: { state: string; samples: number; bandAccuracy: number }[];
}

export default function Accuracy() {
  const [threshold, setThreshold] = useState(2);
  const cal = useApi<Calibration>(`/calibration?threshold=${threshold}`, { enabled: threshold > 1 });
  const ledger = useApi<Ledger>("/ledger?limit=200", { refetchInterval: 20_000 });

  return (
    <>
      <PageHeader title="Accuracy Ledger" kicker="scored against locked forecasts, never re-scored after the fact" />

      <div className="space-y-4">
        <Panel title="how a forecast earns the right to be called accurate">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Any model can claim 90% accuracy by predicting "above 1.01×". The tests that matter are whether the stated
            probability matches the observed frequency (calibration) and whether it beats simply quoting the fair price
            (1 − h)/m (skill). The Brier skill score below is the honest headline: positive means the engine knows
            something the fair price doesn't, zero or negative means it doesn't. Forecasts are locked and stored before the
            round resolves, so nothing here can be tuned after the outcome.
          </p>
        </Panel>

        <Panel
          title="calibration"
          right={<Async query={cal} rows={1}>{(c) => <Verdict verdict={c.beatsFairPrice ? "has skill" : "no skill"} />}</Async>}
        >
          <div className="mb-3 max-w-[180px]">
            <label className="stat-label mb-1 block">threshold</label>
            <NumInput value={threshold} onChange={setThreshold} step={0.5} min={1.1} max={100} />
          </div>
          <Async query={cal} rows={5}>
            {(c) => (
              <div className="space-y-3">
                <Grid cols={4}>
                  <Stat
                    label="Brier skill score"
                    value={num(c.brierSkillScore, 4)}
                    tone={c.brierSkillScore > 0.01 ? "good" : "bad"}
                    sub="vs quoting the fair price"
                  />
                  <Stat label="Brier score" value={num(c.brierScore, 4)} sub={`baseline ${num(c.brierBaseline, 4)}`} />
                  <Stat label="log loss" value={num(c.logLossModel, 4)} sub={`fair price ${num(c.logLossFairPrice, 4)}`} />
                  <Stat label="rounds scored" value={c.scored.toLocaleString()} />
                </Grid>
                <Grid cols={3}>
                  <Stat label="mean prediction" value={pct(c.meanPrediction)} />
                  <Stat label="observed rate" value={pct(c.observedHitRate)} />
                  <Stat label="fair rate" value={pct(c.fairHitRate)} />
                </Grid>
                <p
                  className={`rounded border px-3 py-2 text-xs leading-relaxed ${
                    c.beatsFairPrice
                      ? "border-[#ffb020]/40 bg-[#ffb020]/[0.06] text-[#ffb020]"
                      : "border-border bg-foreground/[0.02] text-muted-foreground"
                  }`}
                >
                  {c.verdict}
                </p>
                <ReliabilityChart buckets={c.buckets} />
                <Table head={["predicted band", "mean predicted", "observed", "samples", "gap"]}>
                  {c.buckets.map((b, i) => (
                    <Row key={i}>
                      <Cell tone="muted">
                        {pct(b.predictedLow)} – {pct(b.predictedHigh)}
                      </Cell>
                      <Cell>{pct(b.predictedMean)}</Cell>
                      <Cell>{pct(b.observedRate)}</Cell>
                      <Cell tone="muted">{b.samples}</Cell>
                      <Cell tone={Math.abs(b.observedRate - b.predictedMean) > 0.12 ? "bad" : "good"}>
                        {b.observedRate - b.predictedMean >= 0 ? "+" : ""}
                        {pct(b.observedRate - b.predictedMean)}
                      </Cell>
                    </Row>
                  ))}
                </Table>
              </div>
            )}
          </Async>
        </Panel>

        <Async query={ledger} rows={6}>
          {(l) => (
            <>
              <Grid cols={4}>
                <Stat label="forecasts resolved" value={l.resolvedCount} />
                <Stat label="band accuracy" value={pct(l.bandAccuracy)} tone={l.bandAccuracy > 0.5 ? "good" : "muted"} />
                <Stat label="P(≥2×) calls correct" value={pct(l.accuracy2x)} />
                <Stat label="mean Brier" value={l.avgBrier === null ? "—" : num(l.avgBrier, 4)} />
              </Grid>

              <Grid cols={2}>
                <Panel title="accuracy by predicted state" note="Small samples per state make these figures noisy; treat anything under 30 samples as indicative only.">
                  {l.byState.length === 0 ? (
                    <Empty title="no resolved forecasts yet" body="Start the live feed and the engine begins locking forecasts." />
                  ) : (
                    <Table head={["state", "samples", "band accuracy"]}>
                      {l.byState.map((s) => (
                        <Row key={s.state}>
                          <Cell>{s.state}</Cell>
                          <Cell tone="muted">{s.samples}</Cell>
                          <Cell tone={s.bandAccuracy > 0.5 ? "good" : undefined}>{pct(s.bandAccuracy)}</Cell>
                        </Row>
                      ))}
                    </Table>
                  )}
                </Panel>

                <Panel title="open forecast" note="Locked before the next round resolves.">
                  {l.open ? (
                    <Grid cols={2} className="gap-2">
                      <Stat label="state" value={l.open.state} />
                      <Stat label="P(≥2×)" value={pct(l.open.probability)} />
                      <Stat
                        label="band"
                        value={`${mult(l.open.rangeLow)} – ${l.open.rangeHigh === null ? "∞" : mult(l.open.rangeHigh)}`}
                      />
                      <Stat label="locked" value={ago(l.open.createdAt)} />
                    </Grid>
                  ) : (
                    <Empty title="nothing locked" body="The next round will open a forecast." />
                  )}
                </Panel>
              </Grid>

              <Panel title="forecast ledger" right={<span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">newest first</span>}>
                {l.entries.length === 0 ? (
                  <Empty title="ledger empty" body="No forecasts have been locked for this session." />
                ) : (
                  <Table head={["#", "state", "band", "P(≥2×)", "actual", "band hit", "Brier", "when"]}>
                    {[...l.entries].reverse().slice(0, 60).map((e) => (
                      <Row key={e.id}>
                        <Cell tone="muted">{e.id}</Cell>
                        <Cell>{e.state}</Cell>
                        <Cell tone="muted">
                          {mult(e.rangeLow)}–{e.rangeHigh === null ? "∞" : mult(e.rangeHigh)}
                        </Cell>
                        <Cell>{pct(e.probability)}</Cell>
                        <Cell>{e.actual === null ? "pending" : mult(e.actual)}</Cell>
                        <Cell tone={e.bandHit ? "good" : e.bandHit === false ? "bad" : "muted"}>
                          {e.bandHit === null ? "—" : e.bandHit ? "yes" : "no"}
                        </Cell>
                        <Cell tone="muted">{e.brier === null ? "—" : num(e.brier, 3)}</Cell>
                        <Cell tone="muted">{ago(e.createdAt)}</Cell>
                      </Row>
                    ))}
                  </Table>
                )}
              </Panel>
            </>
          )}
        </Async>
      </div>
    </>
  );
}

function ReliabilityChart({ buckets }: { buckets: Calibration["buckets"] }) {
  const size = 220;
  const pad = 26;
  const x = (v: number) => pad + v * (size - pad * 2);
  const y = (v: number) => size - pad - v * (size - pad * 2);
  const maxSamples = Math.max(1, ...buckets.map((b) => b.samples));
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-[220px] w-[220px]" role="img" aria-label="Reliability diagram">
        <rect x={pad} y={pad} width={size - pad * 2} height={size - pad * 2} fill="none" stroke="currentColor" className="text-border" />
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#ffb020" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
        <polyline
          points={buckets.map((b) => `${x(b.predictedMean)},${y(b.observedRate)}`).join(" ")}
          fill="none"
          stroke="#2bd97c"
          strokeWidth="1.5"
        />
        {buckets.map((b, i) => (
          <circle
            key={i}
            cx={x(b.predictedMean)}
            cy={y(b.observedRate)}
            r={3 + (b.samples / maxSamples) * 4}
            fill="#2bd97c"
            opacity="0.75"
          />
        ))}
        <text x={size / 2} y={size - 6} textAnchor="middle" className="fill-muted-foreground" fontSize="8">
          predicted probability
        </text>
        <text x={8} y={size / 2} textAnchor="middle" transform={`rotate(-90 8 ${size / 2})`} className="fill-muted-foreground" fontSize="8">
          observed frequency
        </text>
      </svg>
      <p className="max-w-[340px] text-[11px] leading-relaxed text-muted-foreground">
        Perfect calibration sits on the amber diagonal: when the engine says 48%, the event happens 48% of the time. Dot
        size is sample count. Sitting on the diagonal proves honesty, not usefulness — a model that always quotes the fair
        price is perfectly calibrated and has no edge whatsoever.
      </p>
    </div>
  );
}
