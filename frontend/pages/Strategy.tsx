/**
 * Strategy Lab — run any staking plan over the stored tape and see what it would
 * actually have done, plus a full grid so no single lucky cell can be mistaken
 * for a system.
 */
import { useEffect, useState } from "react";

import { BacktestLab } from "@/components/BacktestLab";
import {
  Async,
  Btn,
  Cell,
  Empty,
  ErrorNote,
  Field,
  Grid,
  NumInput,
  PageHeader,
  Panel,
  Row,
  Select,
  Stat,
  Table,
  Verdict,
  money,
  num,
  pct,
  useApi,
} from "@/components/kit";
import { api } from "@/lib/api";
import { useRounds } from "@/lib/store";

interface Backtest {
  config: Record<string, unknown>;
  rounds: number;
  roundsScored: number;
  bets: number;
  skippedNoEdge: number;
  hits: number;
  hitRate: number;
  fairHitRate: number;
  finalBankroll: number;
  roi: number;
  turnover: number;
  avgStake: number;
  maxDrawdown: number;
  longestLossRun: number;
  busted: boolean;
  expectedLossFromEdge: number;
  actualPnl: number;
  equity: number[];
  verdict: string;
}

interface GridRow {
  target: number;
  staking: string;
  roi: number;
  bets: number;
  hitRate: number;
  maxDrawdown: number;
  busted: boolean;
  turnover: number;
  finalBankroll: number;
}

interface GridResult {
  rows: GridRow[];
  bestByRoi: GridRow;
  worstByRoi: GridRow;
  meanRoi: number;
  bustedCount: number;
  verdict: string;
}

const STAKING = [
  { value: "flat", label: "flat stake" },
  { value: "percent", label: "percent of bankroll" },
  { value: "kelly", label: "fractional Kelly" },
  { value: "martingale", label: "martingale (double on loss)" },
];

export default function Strategy() {
  const { settings } = useRounds();
  const currency = settings?.currency ?? "BWP";

  const [target, setTarget] = useState(2);
  const [startBankroll, setStartBankroll] = useState(1000);
  const [staking, setStaking] = useState("flat");
  const [stake, setStake] = useState(10);
  const [kellyFraction, setKellyFraction] = useState(0.25);
  const [minEdge, setMinEdge] = useState(0);

  const [result, setResult] = useState<Backtest | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const grid = useApi<GridResult>("/backtest/grid", { staleTime: 60_000 });

  useEffect(() => {
    if (settings) {
      setTarget(settings.defaultTarget);
      setStartBankroll(settings.bankroll);
      setStake(Math.max(1, Math.round(settings.bankroll * settings.maxRiskPerRound)));
    }
  }, [settings]);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setResult(
        await api.post<Backtest>("/backtest", {
          target,
          startBankroll,
          staking,
          stake,
          kellyFraction,
          minEdge,
          warmup: 120,
        }),
      );
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Strategy Lab" kicker="walk-forward backtesting over the stored tape" />

      <div className="space-y-4">
        <Panel title="read this before interpreting any result below">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The backtest is walk-forward: probabilities at round n are estimated only from rounds before n, so there is no
            look-ahead. A positive ROI on one run is variance, not a system — run the grid and look at the spread. The
            expected cost of a strategy is turnover × house edge, full stop; staking rules change the distribution of
            outcomes and the speed of turnover, never the sign of the expectation.
          </p>
        </Panel>

        <Panel title="configuration">
          <Grid cols={3}>
            <Field label="cash-out target">
              <NumInput value={target} onChange={setTarget} step={0.1} min={1.01} />
            </Field>
            <Field label={`starting bankroll (${currency})`}>
              <NumInput value={startBankroll} onChange={setStartBankroll} step={50} min={10} />
            </Field>
            <Field label="staking plan">
              <Select value={staking} onChange={setStaking} options={STAKING} />
            </Field>
            <Field label={`base stake (${currency})`} hint={staking === "percent" ? "used as percent of bankroll × 100" : undefined}>
              <NumInput value={stake} onChange={setStake} step={1} min={0.5} />
            </Field>
            <Field label="Kelly fraction" hint="Only used by the Kelly plan.">
              <NumInput value={kellyFraction} onChange={setKellyFraction} step={0.05} min={0.01} max={1} />
            </Field>
            <Field label="minimum edge to bet" hint="Skip rounds where the engine's estimate does not exceed the fair price by this much.">
              <NumInput value={minEdge} onChange={setMinEdge} step={0.005} min={0} max={0.2} />
            </Field>
          </Grid>
          <div className="mt-3">
            <Btn tone="accent" onClick={() => void run()} disabled={busy}>
              {busy ? "running…" : "run backtest"}
            </Btn>
          </div>
          {err ? <div className="mt-2"><ErrorNote error={err} /></div> : null}
        </Panel>

        {result ? (
          <Panel
            title="backtest result"
            right={<Verdict verdict={result.busted ? "busted" : result.roi >= 0 ? "variance win" : "loss"} />}
          >
            <Grid cols={4} className="mb-3">
              <Stat
                label="ROI"
                value={pct(result.roi)}
                tone={result.roi >= 0 ? "warn" : "bad"}
                sub={`on ${money(result.turnover, currency)} turnover`}
              />
              <Stat label="final bankroll" value={money(result.finalBankroll, currency)} sub={`from ${money(startBankroll, currency)}`} />
              <Stat label="expected cost of the edge" value={money(result.expectedLossFromEdge, currency)} />
              <Stat label="actual P&L" value={money(result.actualPnl, currency)} tone={result.actualPnl >= 0 ? "good" : "bad"} />
              <Stat label="bets placed" value={result.bets} sub={`${result.skippedNoEdge} skipped`} />
              <Stat label="hit rate" value={pct(result.hitRate)} sub={`fair ${pct(result.fairHitRate)}`} />
              <Stat label="max drawdown" value={pct(result.maxDrawdown)} tone={result.maxDrawdown > 0.3 ? "bad" : "warn"} />
              <Stat label="longest losing run" value={result.longestLossRun} />
            </Grid>
            <EquityCurve equity={result.equity} start={startBankroll} />
            <p className="mt-3 rounded border border-border bg-foreground/[0.02] px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {result.verdict}
            </p>
          </Panel>
        ) : null}

        <Panel
          title="full strategy grid"
          right={<Btn onClick={() => void grid.refetch()}>re-run</Btn>}
          note="Every target crossed with every staking plan over the same tape. The point of this table is the spread, not the winner."
        >
          <Async query={grid} rows={6}>
            {(g) => !g.rows?.length || !g.bestByRoi ? (
              <Empty title="grid unavailable" body="not enough rounds on the tape to sweep the strategy grid — import or generate more rounds first." />
            ) : (
              <>
                <Grid cols={4} className="mb-3">
                  <Stat label="mean ROI across grid" value={pct(g.meanRoi)} />
                  <Stat label="best cell" value={pct(g.bestByRoi.roi)} tone="good" sub={`${g.bestByRoi.target}× ${g.bestByRoi.staking}`} />
                  <Stat label="worst cell" value={pct(g.worstByRoi.roi)} tone="bad" sub={`${g.worstByRoi.target}× ${g.worstByRoi.staking}`} />
                  <Stat label="cells that went bust" value={g.bustedCount} tone={g.bustedCount ? "bad" : "good"} />
                </Grid>
                <Table head={["target", "staking", "ROI", "bets", "hit rate", "max DD", "turnover", "final"]}>
                  {g.rows.map((r, i) => (
                    <Row key={i} highlight={r.busted}>
                      <Cell>{r.target.toFixed(2)}×</Cell>
                      <Cell tone="muted">{r.staking}</Cell>
                      <Cell tone={r.roi >= 0 ? "good" : "bad"}>{pct(r.roi)}</Cell>
                      <Cell tone="muted">{r.bets}</Cell>
                      <Cell>{pct(r.hitRate)}</Cell>
                      <Cell tone={r.maxDrawdown > 0.5 ? "bad" : "muted"}>{pct(r.maxDrawdown)}</Cell>
                      <Cell tone="muted">{money(r.turnover, currency)}</Cell>
                      <Cell tone={r.busted ? "bad" : undefined}>{r.busted ? "bust" : money(r.finalBankroll, currency)}</Cell>
                    </Row>
                  ))}
                </Table>
                <p className="mt-3 rounded border border-[#ffb020]/40 bg-[#ffb020]/[0.06] px-3 py-2 text-xs leading-relaxed text-[#ffb020]">
                  {g.verdict}
                </p>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Note how martingale cells post the highest ROI and the deepest drawdowns in the same row — that is the
                  shape of a strategy that borrows from its own tail risk. Mean ROI across the grid tracks −h × turnover,
                  the only number the plans have in common.
                </p>
              </>
            )}
          </Async>
        </Panel>

        <Panel title="in-browser lab" note="The original client-side backtester, kept for quick what-ifs without a server round trip.">
          <BacktestLab />
        </Panel>
      </div>
    </>
  );
}

function EquityCurve({ equity, start }: { equity: number[]; start: number }) {
  // A backtest that busts early, or a bankroll field the user has cleared, can
  // hand us non-finite numbers; an SVG with NaN coordinates renders nothing and
  // fills the console with attribute errors, so filter first.
  const series = equity.filter((v) => Number.isFinite(v));
  const base = Number.isFinite(start) ? start : (series[0] ?? 0);
  if (series.length < 2) return null;
  const w = 720;
  const h = 150;
  const min = Math.min(...series, base);
  const max = Math.max(...series, base);
  const span = max - min || 1;
  const pts = series
    .map((v, i) => `${(i / (series.length - 1)) * w},${h - ((v - min) / span) * (h - 8) - 4}`)
    .join(" ");
  const baseY = h - ((base - min) / span) * (h - 8) - 4;
  const ends = series[series.length - 1] >= base;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[150px] w-full" role="img" aria-label="Equity curve">
      <line x1="0" y1={baseY} x2={w} y2={baseY} stroke="#ffb020" strokeWidth="1" strokeDasharray="4 3" opacity="0.6" />
      <polyline points={pts} fill="none" stroke={ends ? "#2bd97c" : "#ff4d5e"} strokeWidth="1.5" />
    </svg>
  );
}
