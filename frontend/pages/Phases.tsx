/**
 * Time of Day — the most common claim in crash communities ("play after midnight",
 * "the server is generous at 3am") measured properly: hit rate per hour with
 * intervals, and a chi-square test against a single rate.
 *
 * Merged from the Momento Platform 6.2.0 bundle's session-phase view, converted
 * from a descriptive table into a test with a verdict.
 */
import { useState } from "react";

import {
  Async,
  Cell,
  Grid,
  PageHeader,
  Panel,
  Row,
  Select,
  Source,
  Stat,
  Table,
  Verdict,
  num,
  pct,
  useApi,
} from "@/components/kit";

interface PhaseRow {
  hour: number;
  rounds: number;
  hits: number;
  rate: number;
  ciLow: number;
  ciHigh: number;
  mean: number;
  max: number;
  expectedHits: number;
  phase: string;
}

interface PhasePayload {
  threshold: number;
  rounds: number;
  overallRate: number;
  rows: PhaseRow[];
  chiSquare: number;
  df: number;
  pValue: number;
  testable: boolean;
  hoursCovered: number;
  significant: boolean;
  best: PhaseRow | null;
  worst: PhaseRow | null;
  verdict: string;
  note: string;
}

const OPTIONS = [
  { value: "1.5", label: "≥ 1.5×" },
  { value: "2", label: "≥ 2×" },
  { value: "5", label: "≥ 5×" },
  { value: "10", label: "≥ 10×" },
];

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export default function Phases() {
  const [threshold, setThreshold] = useState("2");
  const q = useApi<PhasePayload>(`/phases?threshold=${threshold}`);

  return (
    <div className="space-y-4">
      <PageHeader title="TIME OF DAY" kicker="is there a best hour to play?">
        <div className="w-28">
          <Select value={threshold} onChange={setThreshold} options={OPTIONS} />
        </div>
      </PageHeader>

      <Async query={q} rows={6}>
        {(d) => {
          // scale to a little past the widest interval so a one-hour tape still renders
          // a readable bar rather than one pinned against the right edge
          const peak = Math.min(1, Math.max(...d.rows.map((r) => r.ciHigh), d.overallRate, 0.02) * 1.15);
          return (
            <div className="space-y-4">
              <Grid cols={4}>
                <Stat label="rounds with a clock" value={d.rounds.toLocaleString()} sub={`${d.hoursCovered} ${d.hoursCovered === 1 ? "hour" : "hours"} covered`} />
                <Stat label={`overall P(≥ ${d.threshold}×)`} value={pct(d.overallRate, 2)} />
                <Stat
                  label="chi-square"
                  value={d.testable ? num(d.chiSquare, 2) : "—"}
                  sub={d.testable ? `${d.df} degrees of freedom` : "needs two hours of rounds"}
                  tone={d.significant ? "warn" : "default"}
                />
                <Stat
                  label="p-value"
                  value={d.testable ? num(d.pValue, 4) : "—"}
                  tone={!d.testable ? "default" : d.significant ? "bad" : "good"}
                  sub={!d.testable ? "not testable yet" : d.significant ? "differs more than chance" : "no time effect"}
                />
              </Grid>

              <Panel
                title="Hit rate by hour"
                right={<Verdict verdict={!d.testable ? "not testable" : d.significant ? "suspect" : "consistent"} />}
                note={d.note}
              >
                <div className="space-y-1.5">
                  {d.rows.map((r) => (
                    <div key={r.hour} className="flex min-w-0 items-center gap-2">
                      <span className="font-mono-num w-12 shrink-0 text-[11px] text-muted-foreground">{hh(r.hour)}</span>
                      <div className="relative h-4 min-w-0 flex-1 rounded-sm border border-border/60 bg-background/50">
                        {/* interval band */}
                        <div
                          className="absolute inset-y-0 bg-accent/20"
                          style={{ left: `${(r.ciLow / peak) * 100}%`, width: `${Math.max(0, (r.ciHigh - r.ciLow) / peak) * 100}%` }}
                          aria-hidden
                        />
                        {/* point estimate */}
                        <div
                          className="absolute inset-y-0 w-[2px] bg-accent"
                          style={{ left: `calc(${(r.rate / peak) * 100}% - 1px)` }}
                          aria-hidden
                        />
                        {/* overall rate reference */}
                        <div
                          className="absolute inset-y-0 w-[1px] bg-foreground/60"
                          style={{ left: `${(d.overallRate / peak) * 100}%` }}
                          aria-hidden
                        />
                      </div>
                      <span className="font-mono-num w-16 shrink-0 text-right text-[11px] text-foreground">{pct(r.rate, 1)}</span>
                      <span className="font-mono-num hidden w-20 shrink-0 text-right text-[10px] text-muted-foreground sm:block">
                        {r.rounds.toLocaleString()} rds
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Band = 95% interval for that hour · bright tick = the hour's rate · pale line = the overall rate. An hour
                  whose band crosses the pale line is indistinguishable from every other hour.
                </p>
              </Panel>

              <Panel title="Hour detail">
                <Table head={["hour", "rounds", "hits", "expected", "rate", "95% interval", "mean", "max", "label"]}>
                  {d.rows.map((r) => (
                    <Row key={r.hour} highlight={d.best?.hour === r.hour}>
                      <Cell>{hh(r.hour)}</Cell>
                      <Cell>{r.rounds.toLocaleString()}</Cell>
                      <Cell>{r.hits.toLocaleString()}</Cell>
                      <Cell tone="muted">{num(r.expectedHits, 1)}</Cell>
                      <Cell>{pct(r.rate, 2)}</Cell>
                      <Cell tone="muted">
                        {pct(r.ciLow, 2)} – {pct(r.ciHigh, 2)}
                      </Cell>
                      <Cell tone="muted">{num(r.mean, 2)}×</Cell>
                      <Cell tone="muted">{num(r.max, 2)}×</Cell>
                      <Cell tone="muted">{r.phase}</Cell>
                    </Row>
                  ))}
                </Table>
              </Panel>

              <Panel title="Verdict">
                <p className="text-[12px] leading-relaxed text-foreground">{d.verdict}</p>
                <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
                  <li>
                    <strong className="text-foreground">The best hour always looks good.</strong> Rank 24 hours by a random
                    rate and the winner beats the average every single time — that is what ranking does, not what the clock
                    does. Only the chi-square across all hours can tell you whether any of it is real.
                  </li>
                  <li>
                    <strong className="text-foreground">If it does come out significant</strong>, suspect the data first:
                    rounds imported in one sitting all share a timestamp hour, which manufactures an effect out of nothing.
                  </li>
                  <li>
                    A provably-fair round is generated from seeds and a nonce, not from a clock — see{" "}
                    <Source href="https://provenlyfair.com/blog/verify-provably-fair-crash/">
                      how a crash round is actually derived
                    </Source>{" "}
                    and verify it yourself on the Fairness page.
                  </li>
                </ul>
              </Panel>
            </div>
          );
        }}
      </Async>
    </div>
  );
}
