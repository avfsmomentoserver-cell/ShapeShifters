/**
 * EV Desk — expected value, Kelly, risk of ruin, martingale. The arithmetic the
 * rest of the crash-analytics category leaves out.
 */
import { useEffect, useState } from "react";

import {
  Async,
  Btn,
  Cell,
  ErrorNote,
  Field,
  Grid,
  NumInput,
  PageHeader,
  Panel,
  Row,
  Source,
  Stat,
  Table,
  money,
  num,
  pct,
  signed,
  useApi,
} from "@/components/kit";
import { api } from "@/lib/api";
import { useRounds } from "@/lib/store";

interface EvTable {
  house_edge: number;
  rtp: number;
  stake: number;
  median_crash_point: number;
  rows: {
    target: number;
    win_probability: number;
    profit_if_win: number;
    ev: number;
    ev_per_unit: number;
    std_dev: number;
    median_rounds_between_wins: number;
  }[];
}

interface Kelly {
  target: number;
  fair_probability: number;
  model_probability: number | null;
  net_odds: number;
  edge: number;
  fraction: number;
  fraction_clamped: number;
  note: string;
  source?: string;
}

interface Ruin {
  bankroll: number;
  stake: number;
  stake_pct: number;
  rounds: number;
  trials: number;
  win_probability: number;
  risk_of_ruin: number;
  median_final_bankroll: number;
  p05_final_bankroll: number;
  p95_final_bankroll: number;
  probability_in_profit: number;
  median_max_drawdown_pct: number;
  median_rounds_to_ruin: number | null;
  mean_final_bankroll: number;
  expected_final_bankroll: number;
  note: string;
}

interface Martingale {
  bankroll: number;
  base_stake: number;
  target: number;
  max_steps: number;
  steps: { step: number; stake: number; cumulative_risk: number; probability_of_reaching: number }[];
  probability_of_busting_the_sequence: number;
  expected_sequences_before_bust: number;
  note: string;
}

export default function Ev() {
  const { settings } = useRounds();
  const currency = settings?.currency ?? "BWP";

  const [stake, setStake] = useState(10);
  const [target, setTarget] = useState(2);
  const [bankroll, setBankroll] = useState(1000);
  const [rounds, setRounds] = useState(500);

  useEffect(() => {
    if (settings) {
      setStake(Math.max(1, Math.round(settings.bankroll * settings.maxRiskPerRound)));
      setTarget(settings.defaultTarget);
      setBankroll(settings.bankroll);
    }
  }, [settings]);

  const table = useApi<EvTable>(`/ev/table?stake=${stake}`, { enabled: stake > 0 });
  const kelly = useApi<Kelly>(`/ev/kelly?target=${target}`, { enabled: target > 1 });
  const mart = useApi<Martingale>(`/ev/martingale?bankroll=${bankroll}&baseStake=${stake}&target=${target}`);

  const [ruin, setRuin] = useState<Ruin | null>(null);
  const [ruinErr, setRuinErr] = useState<unknown>(null);
  const [ruinBusy, setRuinBusy] = useState(false);

  const runRuin = async () => {
    setRuinBusy(true);
    setRuinErr(null);
    try {
      setRuin(await api.post<Ruin>("/ev/ruin", { bankroll, stake, target, rounds, trials: 3000 }));
    } catch (e) {
      setRuinErr(e);
    } finally {
      setRuinBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="EV Desk" kicker="what each cash-out target actually costs" />

      <div className="space-y-4">
        <Panel title="the one result that governs everything else">
          <p className="text-xs leading-relaxed text-muted-foreground">
            In a crash game with house edge h, the chance of reaching multiplier m is (1 − h)/m and the payout is m, so
            expected value is <span className="text-foreground">−h × stake for every target you can pick</span>. Cashing at
            1.2× and cashing at 100× have identical expected value and wildly different variance. That is why this desk
            reports variance, drawdown and survival time rather than "best target" — there isn't one. See{" "}
            <Source href="https://crashedge.com/guides/crash-gambling-maths/">CrashEdge's derivation</Source>.
          </p>
        </Panel>

        <Panel title="parameters">
          <Grid cols={4}>
            <Field label={`stake per round (${currency})`}>
              <NumInput value={stake} onChange={setStake} step={1} min={1} />
            </Field>
            <Field label="cash-out target">
              <NumInput value={target} onChange={setTarget} step={0.1} min={1.01} />
            </Field>
            <Field label={`bankroll (${currency})`}>
              <NumInput value={bankroll} onChange={setBankroll} step={50} min={10} />
            </Field>
            <Field label="rounds to simulate">
              <NumInput value={rounds} onChange={setRounds} step={50} min={10} max={5000} />
            </Field>
          </Grid>
        </Panel>

        <Panel title="expected value by target" note="Every row has the same EV per unit staked. Only the shape of the ride changes.">
          <Async query={table} rows={6}>
            {(t) => (
              <>
                <Grid cols={4} className="mb-3">
                  <Stat label="house edge" value={pct(t.house_edge)} />
                  <Stat label="RTP" value={pct(t.rtp)} />
                  <Stat label="median crash point" value={`${num(t.median_crash_point)}×`} sub="= 2(1 − h)" />
                  <Stat label="EV per unit staked" value={pct(-t.house_edge)} tone="bad" sub="identical at every target" />
                </Grid>
                <Table head={["target", "P(win)", "profit if win", "EV", "std dev", "typical wait"]}>
                  {t.rows.map((r) => (
                    <Row key={r.target} highlight={Math.abs(r.target - target) < 0.001}>
                      <Cell>{r.target.toFixed(2)}×</Cell>
                      <Cell>{pct(r.win_probability)}</Cell>
                      <Cell tone="good">{money(r.profit_if_win, currency)}</Cell>
                      <Cell tone="bad">{signed(r.ev, 2)}</Cell>
                      <Cell tone="muted">{money(r.std_dev, currency)}</Cell>
                      <Cell tone="muted">{num(1 / r.win_probability, 1)} rounds</Cell>
                    </Row>
                  ))}
                </Table>
              </>
            )}
          </Async>
        </Panel>

        <Grid cols={2}>
          <Panel
            title="Kelly stake"
            note="Kelly sizing needs a positive edge as an input. With a house edge and honest probabilities, the formula returns zero or negative — the mathematically correct bet size is no bet."
          >
            <Async query={kelly} rows={4}>
              {(k) => (
                <div className="space-y-3">
                  <Grid cols={2} className="gap-2">
                    <Stat label="fair probability" value={pct(k.fair_probability)} />
                    <Stat
                      label="engine estimate"
                      value={k.model_probability === null ? "n/a" : pct(k.model_probability)}
                      sub={k.source}
                    />
                    <Stat label="edge" value={pct(k.edge)} tone={k.edge > 0 ? "warn" : "bad"} />
                    <Stat
                      label="Kelly fraction"
                      value={k.fraction_clamped <= 0 ? "0 — do not bet" : pct(k.fraction_clamped)}
                      tone={k.fraction_clamped <= 0 ? "bad" : "warn"}
                    />
                  </Grid>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{k.note}</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Background:{" "}
                    <Source href="https://en.wikipedia.org/wiki/Kelly_criterion">the Kelly criterion</Source> and{" "}
                    <Source href="https://crashedge.com/strategy/optimal-bet-sizing-crash-games/">
                      optimal bet sizing in crash games
                    </Source>
                    .
                  </p>
                </div>
              )}
            </Async>
          </Panel>

          <Panel
            title="risk of ruin"
            note="A Monte Carlo over independent rounds at the fair win probability. It answers the question players actually care about: how long does this bankroll last?"
          >
            <Btn tone="accent" onClick={() => void runRuin()} disabled={ruinBusy}>
              {ruinBusy ? "simulating…" : `simulate ${rounds} rounds × 3,000 paths`}
            </Btn>
            {ruinErr ? <div className="mt-2"><ErrorNote error={ruinErr} /></div> : null}
            {ruin ? (
              <div className="mt-3 space-y-3">
                <Grid cols={2} className="gap-2">
                  <Stat
                    label="risk of ruin"
                    value={pct(ruin.risk_of_ruin)}
                    tone={ruin.risk_of_ruin > 0.2 ? "bad" : "warn"}
                    sub={`staking ${pct(ruin.stake_pct)} of bankroll per round`}
                  />
                  <Stat label="chance of finishing ahead" value={pct(ruin.probability_in_profit)} tone="warn" />
                  <Stat label="median final bankroll" value={money(ruin.median_final_bankroll, currency)} />
                  <Stat label="simulated mean final" value={money(ruin.mean_final_bankroll, currency)} tone="bad"
                    sub={`analytic expectation ${money(ruin.expected_final_bankroll, currency)}`} />
                  <Stat label="5th percentile" value={money(ruin.p05_final_bankroll, currency)} tone="bad" />
                  <Stat label="95th percentile" value={money(ruin.p95_final_bankroll, currency)} tone="good" />
                  <Stat label="median max drawdown" value={pct(ruin.median_max_drawdown_pct)} />
                  <Stat
                    label="median rounds to ruin"
                    value={ruin.median_rounds_to_ruin === null ? "survived" : ruin.median_rounds_to_ruin}
                  />
                </Grid>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{ruin.note}</p>
              </div>
            ) : null}
          </Panel>
        </Grid>

        <Panel
          title="martingale autopsy"
          note="Doubling after a loss works until the one sequence that doesn't, and that sequence is not rare enough. The cumulative-risk column is the number that ends accounts."
        >
          <Async query={mart} rows={5}>
            {(m) => (
              <>
                <Grid cols={3} className="mb-3">
                  <Stat label="steps affordable" value={m.max_steps} sub={`on ${money(m.bankroll, currency)}`} />
                  <Stat
                    label="chance the sequence busts"
                    value={pct(m.probability_of_busting_the_sequence)}
                    tone="bad"
                  />
                  <Stat
                    label="expected sequences before a bust"
                    value={num(m.expected_sequences_before_bust, 1)}
                    sub="one bust erases every prior win"
                  />
                </Grid>
                <Table head={["step", "stake", "cumulative at risk", "chance of getting here"]}>
                  {m.steps.map((s) => (
                    <Row key={s.step}>
                      <Cell tone="muted">{s.step}</Cell>
                      <Cell>{money(s.stake, currency)}</Cell>
                      <Cell tone={s.cumulative_risk > m.bankroll * 0.5 ? "bad" : undefined}>
                        {money(s.cumulative_risk, currency)}
                      </Cell>
                      <Cell tone="muted">{pct(s.probability_of_reaching)}</Cell>
                    </Row>
                  ))}
                </Table>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{m.note}</p>
              </>
            )}
          </Async>
        </Panel>
      </div>
    </>
  );
}
