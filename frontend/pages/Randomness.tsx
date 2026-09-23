/**
 * Randomness Lab — the test that decides whether any of the pattern engines can
 * work at all. If the tape passes, the engines are descriptive by definition.
 */
import {
  Async,
  Btn,
  Cell,
  Grid,
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

interface HouseEdgeTest {
  rounds: number;
  instant_crash_rate: number;
  edge_from_instant_crashes: number;
  implied_rtp: number;
  edge_from_rtp: number;
  rtp_by_target: Record<string, number>;
  verdict?: string;
}

interface ChiTest {
  test: string;
  rounds: number;
  statistic: number;
  df: number;
  p_value: number;
  verdict: string;
  bins: { band: string; observed: number; expected: number; residual: number }[];
}

interface KsTest {
  test: string;
  rounds: number;
  statistic: number;
  p_value: number;
  verdict: string;
}

interface RunsTest {
  test: string;
  runs_observed: number;
  runs_expected: number;
  z: number;
  p_value: number;
  verdict: string;
  interpretation: string;
}

interface AcfTest {
  test: string;
  lags: number;
  ci95: number;
  acf: { lag: number; r: number; significant: boolean }[];
  ljung_box?: { statistic: number; p_value: number };
  p_value?: number;
  verdict: string;
  interpretation?: string;
}

interface DepTest {
  test: string;
  statistic: number;
  df: number;
  p_value: number;
  verdict: string;
  baseline_hit_rate: number;
  rows: { previous_band: string; samples: number; hit_rate: number }[];
  interpretation?: string;
}

interface DigitTest {
  test: string;
  counts: Record<string, number>;
  statistic: number;
  df: number;
  p_value: number;
  verdict: string;
}

interface Battery {
  tests: {
    house_edge: HouseEdgeTest;
    chi_square_fit: ChiTest;
    ks: KsTest;
    runs: RunsTest;
    autocorrelation: AcfTest;
    conditional_dependence: DepTest;
    digit_uniformity: DigitTest;
  };
  overall: { verdict: string; passed: number; total: number; flagged: string[]; summary: string };
  summary: { conclusion: string };
}

export default function Randomness() {
  const battery = useApi<Battery>("/randomness");

  return (
    <>
      <PageHeader title="Randomness Lab" kicker="independence and distribution testing">
        <Btn onClick={() => void battery.refetch()}>re-run battery</Btn>
      </PageHeader>

      <Async query={battery} rows={8}>
        {(b) => {
          const t = b.tests;
          return (
            <div className="space-y-4">
              <Panel
                title="verdict"
                right={<Verdict verdict={b.overall.verdict} />}
                note="Every pattern engine in this terminal depends on this page. If the tape is indistinguishable from independent draws, then streaks, ladders, pressure and DNA analogues are structure in noise — real as descriptions, worthless as forecasts."
              >
                <p className="text-sm leading-relaxed text-foreground">{b.overall.summary}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{b.summary.conclusion}</p>
              </Panel>

              <Grid cols={4}>
                <Stat
                  label="implied RTP"
                  value={pct(t.house_edge.implied_rtp)}
                  sub={`edge ${pct(t.house_edge.edge_from_rtp)} from realised returns`}
                />
                <Stat label="instant-crash rate" value={pct(t.house_edge.instant_crash_rate)} sub="often equals the edge by design" />
                <Stat label="rounds tested" value={t.house_edge.rounds.toLocaleString()} />
                <Stat
                  label="tests consistent"
                  value={`${b.overall.passed}/${b.overall.total}`}
                  tone={b.overall.passed === b.overall.total ? "good" : "warn"}
                />
              </Grid>

              <Grid cols={2}>
                <Panel
                  title="distribution fit · chi-square"
                  right={<Verdict verdict={t.chi_square_fit.verdict} />}
                  note="Compares how many rounds landed in each band against the count the fair law predicts. A large residual in one band is where an operator's deviation would show."
                >
                  <div className="mb-2 flex gap-4 text-[11px] text-muted-foreground">
                    <span>χ² = <span className="font-mono-num text-foreground">{num(t.chi_square_fit.statistic, 3)}</span></span>
                    <span>df = <span className="font-mono-num text-foreground">{t.chi_square_fit.df}</span></span>
                    <span>p = <span className="font-mono-num text-foreground">{num(t.chi_square_fit.p_value, 4)}</span></span>
                  </div>
                  <Table head={["band", "observed", "expected", "residual"]}>
                    {t.chi_square_fit.bins.map((bin) => (
                      <Row key={bin.band}>
                        <Cell tone="muted">{bin.band}</Cell>
                        <Cell>{bin.observed}</Cell>
                        <Cell tone="muted">{num(bin.expected, 1)}</Cell>
                        <Cell tone={Math.abs(bin.residual) > 2 ? "bad" : undefined}>{num(bin.residual, 2)}</Cell>
                      </Row>
                    ))}
                  </Table>
                </Panel>

                <div className="space-y-4">
                  <Panel
                    title="continuous fit · Kolmogorov-Smirnov"
                    right={<Verdict verdict={t.ks.verdict} />}
                    note="Tests the whole shape of the distribution against 1 − 1/m rather than binned counts, so it catches drift the chi-square can hide."
                  >
                    <Grid cols={2} className="gap-2">
                      <Stat label="D statistic" value={num(t.ks.statistic, 4)} />
                      <Stat label="p value" value={num(t.ks.p_value, 4)} tone={t.ks.p_value > 0.05 ? "good" : "bad"} />
                    </Grid>
                  </Panel>

                  <Panel
                    title="streak structure · Wald-Wolfowitz runs"
                    right={<Verdict verdict={t.runs.verdict} />}
                    note={t.runs.interpretation}
                  >
                    <Grid cols={2} className="gap-2">
                      <Stat label="runs observed" value={t.runs.runs_observed} />
                      <Stat label="runs expected" value={num(t.runs.runs_expected, 1)} />
                      <Stat label="z score" value={num(t.runs.z, 3)} />
                      <Stat label="p value" value={num(t.runs.p_value, 4)} tone={t.runs.p_value > 0.05 ? "good" : "bad"} />
                    </Grid>
                  </Panel>
                </div>
              </Grid>

              <Panel
                title="serial dependence · autocorrelation"
                right={<Verdict verdict={t.autocorrelation.verdict} />}
                note="Each bar is the correlation between a round and the round n places before it. Anything inside the dashed band is indistinguishable from zero — and zero means the previous round tells you nothing."
              >
                <AcfChart acf={t.autocorrelation.acf} ci={t.autocorrelation.ci95} />
                <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
                  <span>lags tested: <span className="font-mono-num text-foreground">{t.autocorrelation.lags}</span></span>
                  <span>95% band: ±<span className="font-mono-num text-foreground">{num(t.autocorrelation.ci95, 4)}</span></span>
                  {t.autocorrelation.ljung_box ? (
                    <span>
                      Ljung-Box p ={" "}
                      <span className="font-mono-num text-foreground">{num(t.autocorrelation.ljung_box.p_value, 4)}</span>
                    </span>
                  ) : null}
                  <span>
                    significant lags:{" "}
                    <span className="font-mono-num text-foreground">
                      {t.autocorrelation.acf.filter((a) => a.significant).length}
                    </span>
                  </span>
                </div>
              </Panel>

              <Grid cols={2}>
                <Panel
                  title="conditional dependence"
                  right={<Verdict verdict={t.conditional_dependence.verdict} />}
                  note={
                    t.conditional_dependence.interpretation ??
                    "If the previous round's band changed the odds of the next one clearing 2×, the hit rates in this table would separate. They do not."
                  }
                >
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    baseline P(next ≥ 2×) ={" "}
                    <span className="font-mono-num text-foreground">{pct(t.conditional_dependence.baseline_hit_rate)}</span>{" "}
                    · p = <span className="font-mono-num text-foreground">{num(t.conditional_dependence.p_value, 4)}</span>
                  </p>
                  <Table head={["previous round", "samples", "P(next ≥ 2×)", "vs baseline"]}>
                    {t.conditional_dependence.rows.map((r) => {
                      const delta = r.hit_rate - t.conditional_dependence.baseline_hit_rate;
                      return (
                        <Row key={r.previous_band}>
                          <Cell tone="muted">{r.previous_band}</Cell>
                          <Cell>{r.samples}</Cell>
                          <Cell>{pct(r.hit_rate)}</Cell>
                          <Cell tone={Math.abs(delta) > 0.06 ? "bad" : "muted"}>
                            {delta >= 0 ? "+" : ""}
                            {pct(delta)}
                          </Cell>
                        </Row>
                      );
                    })}
                  </Table>
                </Panel>

                <Panel
                  title="digit uniformity"
                  right={<Verdict verdict={t.digit_uniformity.verdict} />}
                  note="The second decimal of a fairly generated crash point should be uniform. Rounding tricks and truncated randomness both show up here first."
                >
                  <DigitChart counts={t.digit_uniformity.counts} />
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    χ² = <span className="font-mono-num text-foreground">{num(t.digit_uniformity.statistic, 3)}</span> · p ={" "}
                    <span className="font-mono-num text-foreground">{num(t.digit_uniformity.p_value, 4)}</span>
                  </p>
                </Panel>
              </Grid>

              <Panel title="realised RTP by cash-out target">
                <Table head={["target", "realised RTP", "vs published"]}>
                  {Object.entries(t.house_edge.rtp_by_target).map(([target, rtp]) => (
                    <Row key={target}>
                      <Cell>{Number(target).toFixed(2)}×</Cell>
                      <Cell tone={rtp > 1 ? "good" : undefined}>{pct(rtp)}</Cell>
                      <Cell tone="muted">
                        {rtp >= 0.95 && rtp <= 1.02 ? "within sampling noise" : "outside the expected range"}
                      </Cell>
                    </Row>
                  ))}
                </Table>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Realised RTP wandering either side of the published figure is ordinary sampling noise over a few hundred
                  rounds; it is not an edge. The identities being tested here are set out in{" "}
                  <Source href="https://crashedge.com/guides/crash-gambling-maths/">CrashEdge's crash maths guide</Source>,
                  and Aviator's published 97% RTP is documented in this{" "}
                  <Source href="https://crashgamesplay.com/guides/aviator-review/">Aviator review</Source>.
                </p>
              </Panel>
            </div>
          );
        }}
      </Async>
    </>
  );
}

function AcfChart({ acf, ci }: { acf: { lag: number; r: number; significant: boolean }[]; ci: number }) {
  const max = Math.max(ci * 1.6, ...acf.map((a) => Math.abs(a.r))) || 0.1;
  const h = 130;
  const mid = h / 2;
  const w = Math.max(240, acf.length * 22);
  const step = w / acf.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[130px] w-full" role="img" aria-label="Autocorrelation by lag">
      <line x1="0" y1={mid} x2={w} y2={mid} stroke="currentColor" strokeWidth="1" className="text-border" />
      <line x1="0" y1={mid - (ci / max) * mid} x2={w} y2={mid - (ci / max) * mid} stroke="#ffb020" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
      <line x1="0" y1={mid + (ci / max) * mid} x2={w} y2={mid + (ci / max) * mid} stroke="#ffb020" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
      {acf.map((a, i) => {
        const x = i * step + step / 2;
        const y = mid - (a.r / max) * (mid - 6);
        return (
          <g key={a.lag}>
            <line x1={x} y1={mid} x2={x} y2={y} stroke={a.significant ? "#ff4d5e" : "#2bd97c"} strokeWidth="3" strokeLinecap="round" />
            <circle cx={x} cy={y} r="2" fill={a.significant ? "#ff4d5e" : "#2bd97c"} />
          </g>
        );
      })}
    </svg>
  );
}

function DigitChart({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => Number(a[0]) - Number(b[0]));
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const expected = total / (entries.length || 1);
  const max = Math.max(...entries.map(([, v]) => v), expected) * 1.1;
  return (
    <div className="flex h-[120px] items-end gap-1.5">
      {entries.map(([digit, count]) => (
        <div key={digit} className="flex flex-1 flex-col items-center gap-1">
          <div className="relative flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t bg-accent/70"
              style={{ height: `${(count / max) * 100}%` }}
              title={`${digit}: ${count}`}
            />
            <div className="absolute left-0 w-full border-t border-dashed border-[#ffb020]/70" style={{ bottom: `${(expected / max) * 100}%` }} />
          </div>
          <span className="font-mono-num text-[10px] text-muted-foreground">{digit}</span>
        </div>
      ))}
    </div>
  );
}
