/**
 * Window Odds — the chance that a stretch of time contains at least one round
 * above a threshold, from the measured rate and the measured round cadence.
 *
 * Merged from the Momento Platform 6.2.0 bundle's prediction pipeline, with the
 * single number replaced by an interval: the base rate's Wilson bounds carried
 * through 1-(1-p)^n. It answers "how much exposure does an hour buy" — never
 * "which round".
 */
import { useMemo, useState } from "react";

import {
  Async,
  Cell,
  Grid,
  IntervalBar,
  PageHeader,
  Panel,
  Row,
  Source,
  Stat,
  Table,
  TextInput,
  Verdict,
  num,
  pct,
  useApi,
} from "@/components/kit";

interface Prediction {
  threshold: number;
  probability: number;
  ciLow: number;
  ciHigh: number;
  fairProbability: number;
  expectedHits: number;
  currentRun: number;
}

interface WindowRow {
  id: string;
  label: string;
  ms: number;
  expectedRounds: number;
  predictions: Prediction[];
}

interface Component {
  model: string;
  p: number;
  weight: number;
  skill: number | null;
  brier: number | null;
}

interface PerRound {
  p: number;
  baseRate: number;
  ciLow: number;
  ciHigh: number;
  currentRun: number;
  components: Component[];
  scored: number | null;
  note: string;
}

interface WindowsPayload {
  rounds: number;
  houseEdge: number;
  cadence: { ms: number; measured: boolean; samples: number; note: string };
  cadenceSeconds: number;
  windows: WindowRow[];
  perRound: Record<string, PerRound>;
  note: string;
}

const PRESETS = ["2,5,10,50,100", "1.5,2,3,5,10", "10,20,50,100,250"];

/** Window odds saturate fast, and printing 100.00% for a value that is not 1 is a lie. */
const prob = (p: number) => (p > 0.9999 ? "> 99.99%" : p < 0.0001 && p > 0 ? "< 0.01%" : pct(p, 2));

export default function Windows() {
  const [raw, setRaw] = useState("2,5,10,50,100");
  const thresholds = useMemo(
    () =>
      raw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((v) => Number.isFinite(v) && v > 1),
    [raw],
  );
  const query = thresholds.length ? `/windows?thresholds=${thresholds.join(",")}` : "/windows";
  const q = useApi<WindowsPayload>(query);

  return (
    <div className="space-y-4">
      <PageHeader title="WINDOW ODDS" kicker="exposure mathematics">
        <div className="flex items-center gap-2">
          <div className="w-52">
            <TextInput value={raw} onChange={setRaw} placeholder="2,5,10,50,100" />
          </div>
        </div>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setRaw(p)}
            className={`rounded border px-2 py-1 text-[10px] uppercase tracking-[0.14em] transition-colors ${
              raw === p ? "border-accent/60 bg-accent/10 text-accent" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.replace(/,/g, " · ")}
          </button>
        ))}
      </div>

      <Async query={q} rows={6}>
        {(d) => (
          <div className="space-y-4">
            <Grid cols={4}>
              <Stat label="rounds measured" value={d.rounds.toLocaleString()} />
              <Stat
                label="round cadence"
                value={`${num(d.cadenceSeconds, 1)}s`}
                sub={d.cadence.measured ? `${d.cadence.samples} gaps sampled` : "assumed — timestamps unusable"}
                tone={d.cadence.measured ? "default" : "warn"}
              />
              <Stat label="house edge" value={pct(d.houseEdge, 1)} sub="used for the fair reference" />
              <Stat
                label="rounds per hour"
                value={(d.windows.find((w) => w.id === "1h")?.expectedRounds ?? 0).toLocaleString()}
                sub={d.cadence.measured ? "at the measured cadence" : "at the assumed 20 s cadence"}
              />
            </Grid>

            <Panel
              title="P(at least one hit) by window"
              note={d.cadence.measured ? d.note : `${d.cadence.note}. ${d.note}`}
              right={<span className="text-[10px] text-muted-foreground">bar = estimate · band = 95% interval · tick = fair model</span>}
            >
              <div className="space-y-5">
                {d.windows.map((w) => (
                  <div key={w.id} className="min-w-0">
                    <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                      <h3 className="text-xs uppercase tracking-[0.16em] text-foreground">{w.label}</h3>
                      <span className="font-mono-num text-[11px] text-muted-foreground">
                        ≈ {w.expectedRounds.toLocaleString()} rounds
                      </span>
                    </div>
                    <Table head={["threshold", "probability", "95% interval", "fair model", "expected hits", "since last", ""]}>
                      {w.predictions.map((p) => {
                        const saturated = p.ciLow > 0.999;
                        return (
                          <Row key={p.threshold}>
                            <Cell>{p.threshold}×</Cell>
                            <Cell tone={saturated ? "good" : undefined}>{prob(p.probability)}</Cell>
                            <Cell tone="muted">
                              {prob(p.ciLow)} – {prob(p.ciHigh)}
                            </Cell>
                            <Cell tone="muted">{prob(p.fairProbability)}</Cell>
                            <Cell>{num(p.expectedHits, 1)}</Cell>
                            <Cell tone="muted">{p.currentRun.toLocaleString()} rds</Cell>
                            <Cell className="w-[140px]">
                              <IntervalBar
                                value={p.probability}
                                low={p.ciLow}
                                high={p.ciHigh}
                                reference={p.fairProbability}
                                tone={p.threshold >= 50 ? "amber" : p.threshold >= 10 ? "cyan" : "green"}
                              />
                            </Cell>
                          </Row>
                        );
                      })}
                    </Table>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel
              title="Per-round ensemble"
              note="Components only earn weight by beating the measured base rate walk-forward. When none do, the baseline takes the full weight and the window odds are pure exposure arithmetic."
            >
              <div className="space-y-4">
                {Object.entries(d.perRound).map(([threshold, pr]) => (
                  <div key={threshold} className="min-w-0 rounded border border-border/60 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs uppercase tracking-[0.16em] text-foreground">{threshold}×</span>
                      <span className="font-mono-num text-[11px] text-muted-foreground">
                        p = {pct(pr.p, 3)} · base {pct(pr.baseRate, 3)} ({pct(pr.ciLow, 2)} – {pct(pr.ciHigh, 2)})
                      </span>
                      <Verdict verdict={pr.components.some((c) => c.model !== "baseline" && c.weight > 0) ? "drifting" : "consistent"} />
                      {pr.scored ? (
                        <span className="text-[10px] text-muted-foreground">{pr.scored.toLocaleString()} rounds scored</span>
                      ) : null}
                    </div>
                    <Table head={["component", "its estimate", "weight", "brier", "skill vs base"]}>
                      {pr.components.map((c) => (
                        <Row key={c.model} highlight={c.weight > 0.5}>
                          <Cell>{c.model}</Cell>
                          <Cell>{pct(c.p, 3)}</Cell>
                          <Cell tone={c.weight > 0 ? "good" : "muted"}>{pct(c.weight, 1)}</Cell>
                          <Cell tone="muted">{c.brier === null ? "—" : num(c.brier, 5)}</Cell>
                          <Cell tone={c.skill && c.skill > 0 ? "good" : "muted"}>
                            {c.skill === null || c.skill === undefined ? "—" : num(c.skill, 5)}
                          </Cell>
                        </Row>
                      ))}
                    </Table>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{pr.note}</p>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="How to read this page">
              <ul className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
                <li>
                  <strong className="text-foreground">Exposure, not timing.</strong> A 99% chance of a 10× inside an hour
                  does not tell you which of those rounds it is, and you cannot bet the window — only individual rounds,
                  each at its own negative expected value.
                </li>
                <li>
                  <strong className="text-foreground">The interval is the point.</strong> With 900 rounds the 100× rate is
                  known to roughly ±0.5 percentage points, which is why long-window odds at high thresholds are wide.
                </li>
                <li>
                  <strong className="text-foreground">Fair model tick.</strong> The reference is{" "}
                  <span className="font-mono-num">(1 − houseEdge) / x</span> per round, the exceedance a correctly
                  implemented crash game pays. If the bar and the tick sit on top of each other, the tape is behaving.
                </li>
                <li>
                  Method references:{" "}
                  <Source href="https://crashedge.com/guides/crash-gambling-maths/">CrashEdge crash maths</Source>,{" "}
                  <Source href="https://provenlyfair.com/blog/verify-provably-fair-crash/">
                    ProvenlyFair on verifying crash rounds
                  </Source>
                  , and{" "}
                  <Source href="https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval#Wilson_score_interval">
                    the Wilson score interval
                  </Source>
                  .
                </li>
              </ul>
            </Panel>
          </div>
        )}
      </Async>
    </div>
  );
}
