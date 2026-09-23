/**
 * Exceedance Grid — observed vs fair exceedance at twelve thresholds, each with a
 * Wilson 95% interval, plus the drought tracker that shows how ordinary a long
 * gap actually is.
 *
 * Merged from the Momento Platform 6.2.0 bundle (Eagle Eye + gap tracker). The
 * addition here is the interval and the fair-rate comparison on every row, so
 * the grid reads as a fairness test rather than a hunting ground.
 */
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
  Verdict,
  num,
  pct,
  useApi,
} from "@/components/kit";

interface GridRow {
  threshold: number;
  hits: number;
  rate: number;
  ciLow: number;
  ciHigh: number;
  fair: number;
  z: number;
  insideInterval: boolean;
  etaMedian: number | null;
  etaP90: number | null;
  fairEtaMedian: number | null;
  currentRun: number;
  fairPrice: number | null;
}

interface GridPayload {
  rounds: number;
  houseEdge: number;
  rows: GridRow[];
  insideInterval: number;
  measured: number;
  verdict: string;
  note: string;
}

interface DroughtRow {
  threshold: number;
  since: number;
  rate: number;
  hits: number;
  etaMedian: number | null;
  etaP90: number | null;
  longestGap: number;
  pAtLeastThisLong: number | null;
  share: number | null;
  unusual: boolean;
}

interface DroughtPayload {
  rounds: number;
  rows: DroughtRow[];
  note: string;
}

export default function Exceedance() {
  const grid = useApi<GridPayload>("/exceedance");
  const drought = useApi<DroughtPayload>("/droughts");

  return (
    <div className="space-y-4">
      <PageHeader title="EXCEEDANCE GRID" kicker="observed vs fair, with intervals" />

      <Async query={grid} rows={6}>
        {(d) => (
          <div className="space-y-4">
            <Grid cols={4}>
              <Stat label="rounds" value={d.rounds.toLocaleString()} />
              <Stat
                label="fair rate inside interval"
                value={`${d.insideInterval} / ${d.rows.length}`}
                tone={d.insideInterval >= d.measured - 1 ? "good" : "warn"}
                sub={`of which ${d.measured} have hits to measure`}
              />
              <Stat label="house edge" value={pct(d.houseEdge, 1)} sub="fair = (1 − edge) / x" />
              <Stat
                label="largest deviation"
                value={`z ${num(d.rows.reduce((a, r) => (Math.abs(r.z) > Math.abs(a) ? r.z : a), 0), 2)}`}
                tone={Math.abs(d.rows.reduce((a, r) => (Math.abs(r.z) > Math.abs(a) ? r.z : a), 0)) > 3 ? "bad" : "default"}
                sub="standard errors from fair"
              />
            </Grid>

            <Panel title="Exceedance by threshold" note={d.note}>
              <Table
                head={["threshold", "hits", "observed", "95% interval", "fair", "z", "median wait", "p90 wait", "since last", "fair price", ""]}
              >
                {d.rows.map((r) => (
                  <Row key={r.threshold} highlight={!r.insideInterval && r.hits >= 20}>
                    <Cell>{r.threshold}×</Cell>
                    <Cell tone={r.hits === 0 ? "muted" : undefined}>{r.hits.toLocaleString()}</Cell>
                    <Cell>{pct(r.rate, 3)}</Cell>
                    <Cell tone="muted">
                      {pct(r.ciLow, 3)} – {pct(r.ciHigh, 3)}
                    </Cell>
                    <Cell tone="muted">{pct(r.fair, 3)}</Cell>
                    <Cell tone={Math.abs(r.z) > 3 ? "bad" : Math.abs(r.z) > 2 ? undefined : "muted"}>{num(r.z, 2)}</Cell>
                    <Cell>{r.etaMedian === null ? "—" : `${r.etaMedian.toLocaleString()} rds`}</Cell>
                    <Cell tone="muted">{r.etaP90 === null ? "—" : `${r.etaP90.toLocaleString()} rds`}</Cell>
                    <Cell tone="muted">{r.currentRun.toLocaleString()}</Cell>
                    <Cell tone="muted">{r.fairPrice === null ? "—" : `${num(r.fairPrice, 2)}×`}</Cell>
                    <Cell className="w-[130px]">
                      {r.hits === 0 ? (
                        <span className="text-[10px] text-muted-foreground">unmeasured</span>
                      ) : (
                        <IntervalBar
                          value={Math.min(1, r.rate / Math.max(r.fair * 2, 1e-9))}
                          low={Math.min(1, r.ciLow / Math.max(r.fair * 2, 1e-9))}
                          high={Math.min(1, r.ciHigh / Math.max(r.fair * 2, 1e-9))}
                          reference={0.5}
                          tone={r.insideInterval ? "green" : "amber"}
                        />
                      )}
                    </Cell>
                  </Row>
                ))}
              </Table>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                The bar is the observed rate as a share of twice the fair rate, so the centre tick is exactly fair: a bar
                ending on the tick means the tape pays what the model says it should. Thresholds with no hits are
                unmeasured — 1000× at 900 rounds says nothing either way.
              </p>
            </Panel>
          </div>
        )}
      </Async>

      <Async query={drought} rows={4}>
        {(d) => (
          <Panel title="Drought tracker" note={d.note}>
            <Table head={["threshold", "since last", "median wait", "p90 wait", "share of median", "P(gap ≥ this)", "longest seen", "verdict"]}>
              {d.rows.map((r) => (
                <Row key={r.threshold} highlight={r.unusual}>
                  <Cell>{r.threshold}×</Cell>
                  <Cell tone={r.unusual ? "bad" : undefined}>{r.since.toLocaleString()} rds</Cell>
                  <Cell tone="muted">{r.etaMedian === null ? "—" : r.etaMedian.toLocaleString()}</Cell>
                  <Cell tone="muted">{r.etaP90 === null ? "—" : r.etaP90.toLocaleString()}</Cell>
                  <Cell className="w-[130px]">
                    <IntervalBar value={Math.min(1, (r.share ?? 0) / 3)} tone={r.unusual ? "red" : "cyan"} />
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {r.share === null ? "—" : `${num(r.share, 2)}×`}
                    </span>
                  </Cell>
                  <Cell>{r.pAtLeastThisLong === null ? "—" : pct(r.pAtLeastThisLong, 1)}</Cell>
                  <Cell tone="muted">{r.longestGap.toLocaleString()}</Cell>
                  <Cell>
                    <Verdict verdict={r.unusual ? "suspect" : "consistent"} />
                  </Cell>
                </Row>
              ))}
            </Table>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              A gap that has reached three times its median wait still happens on a fair tape — the right column shows how
              often. Nothing here is due:{" "}
              <Source href="https://crashedge.com/guides/crash-gambling-maths/">each round is drawn independently</Source>,
              so the chance on the next round is the observed rate whether the gap is 2 rounds or 200.
            </p>
          </Panel>
        )}
      </Async>
    </div>
  );
}
