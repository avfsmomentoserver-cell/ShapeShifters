/**
 * Bankroll — session discipline. Plan the limits before playing, log real bets,
 * and let the terminal enforce the stop rather than the player's judgement.
 */
import { useEffect, useState } from "react";

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
  Stat,
  Table,
  TextInput,
  ago,
  money,
  num,
  pct,
  useApi,
} from "@/components/kit";
import { api } from "@/lib/api";
import type { BetRow, BetSessionRow } from "@/lib/api";
import { useRounds } from "@/lib/store";

interface Plan {
  bankroll: number;
  stake_per_round: number;
  session_loss_limit: number;
  target: number;
  win_probability: number;
  expected_loss_per_round: number;
  expected_rounds_to_hit_loss_limit: number;
  rounds_of_pure_losing_streak_affordable: number;
  probability_of_that_streak: number;
  rules: string[];
}

interface Sessions {
  sessions: BetSessionRow[];
  totalPnl: number;
  openSession: BetSessionRow | null;
}

export default function Bankroll() {
  const { settings, multipliers } = useRounds();
  const currency = settings?.currency ?? "BWP";

  const plan = useApi<Plan>("/ev/plan");
  const sessions = useApi<Sessions>("/sessions", { refetchInterval: 30_000 });

  const [name, setName] = useState("");
  const [bankroll, setBankroll] = useState(1000);
  const [stake, setStake] = useState(20);
  const [target, setTarget] = useState(2);
  const [lossLimit, setLossLimit] = useState(150);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const [betResult, setBetResult] = useState(0);
  const lastRound = multipliers.length ? multipliers[multipliers.length - 1] : 0;
  const [bets, setBets] = useState<BetRow[]>([]);

  const open = sessions.data?.openSession ?? null;

  useEffect(() => {
    if (settings) {
      setBankroll(settings.bankroll);
      setStake(Math.max(1, Math.round(settings.bankroll * settings.maxRiskPerRound)));
      setTarget(settings.defaultTarget);
      setLossLimit(Math.round(settings.bankroll * settings.sessionLossLimit));
    }
  }, [settings]);

  useEffect(() => {
    if (!open) {
      setBets([]);
      return;
    }
    void api
      .get<{ bets: BetRow[] }>(`/sessions/${open.id}/bets`)
      .then((r) => setBets(r.bets))
      .catch(() => setBets([]));
  }, [open?.id, open?.bets]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await sessions.refetch();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const lossLimitHit = open ? open.pnl <= -open.lossLimit : false;

  return (
    <>
      <PageHeader title="Bankroll" kicker="limits set in advance, logged as you go" />

      <div className="space-y-4">
        <Panel title="what bankroll management does and does not do">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sizing rules control how long a bankroll survives and how deep the drawdowns get. They do not change expected
            value, because nothing staked at a negative edge can — see{" "}
            <a
              href="https://crashedge.com/strategy/bankroll-management-crash-games/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline underline-offset-2"
            >
              CrashEdge on bankroll management
            </a>
            . The useful function of this page is enforcement: the stop-loss is decided while you are calm and then held to
            afterwards.
          </p>
        </Panel>

        <Async query={plan} rows={5}>
          {(p) => (
            <Grid cols={2}>
              <Panel title="plan from your settings">
                <Grid cols={2} className="gap-2">
                  <Stat label="bankroll" value={money(p.bankroll, currency)} />
                  <Stat label="stake per round" value={money(p.stake_per_round, currency)} />
                  <Stat label="session stop-loss" value={money(p.session_loss_limit, currency)} tone="warn" />
                  <Stat label="target" value={`${num(p.target)}×`} sub={`P(win) ${pct(p.win_probability)}`} />
                  <Stat label="expected cost per round" value={money(p.expected_loss_per_round, currency)} tone="bad" />
                  <Stat
                    label="rounds until the stop-loss on average"
                    value={num(p.expected_rounds_to_hit_loss_limit, 0)}
                  />
                  <Stat
                    label="consecutive losses affordable"
                    value={p.rounds_of_pure_losing_streak_affordable}
                    sub={`a streak that long happens ${pct(p.probability_of_that_streak, 2)} of the time`}
                  />
                </Grid>
              </Panel>
              <Panel title="house rules" note="Adjust the inputs behind these on the Settings page.">
                <ol className="space-y-2">
                  {p.rules.map((r, i) => (
                    <li key={i} className="flex gap-2.5 text-xs leading-relaxed text-foreground">
                      <span className="font-mono-num shrink-0 text-accent">{String(i + 1).padStart(2, "0")}</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ol>
              </Panel>
            </Grid>
          )}
        </Async>

        {err ? <ErrorNote error={err} /> : null}

        {open ? (
          <Panel
            title={`open session · ${open.name}`}
            right={
              <Btn tone="danger" onClick={() => void act(() => api.post(`/sessions/${open.id}/close`, {}))} disabled={busy}>
                close session
              </Btn>
            }
          >
            {lossLimitHit ? (
              <div className="mb-3 rounded border border-destructive/60 bg-destructive/[0.08] px-3 py-2.5 text-xs leading-relaxed text-destructive">
                <strong className="uppercase tracking-[0.14em]">stop-loss reached · </strong>
                This session has hit the loss limit you set. Close it. Continuing past a pre-set limit is the single
                strongest predictor of a session becoming a problem.
              </div>
            ) : null}
            <Grid cols={4} className="mb-3">
              <Stat label="bankroll now" value={money(open.bankrollCurrent, currency)} sub={`started ${money(open.bankrollStart, currency)}`} />
              <Stat label="P&L" value={money(open.pnl, currency)} tone={open.pnl >= 0 ? "good" : "bad"} />
              <Stat label="bets" value={open.bets} sub={`${open.wins} won`} />
              <Stat
                label="hit rate"
                value={open.bets ? pct(open.wins / open.bets) : "—"}
                sub={`stake ${money(open.stake, currency)} at ${num(open.target)}×`}
              />
            </Grid>

            <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
              <Field label="round result (crash point)" className="w-[180px]">
                <NumInput value={betResult} onChange={setBetResult} step={0.01} min={1} />
              </Field>
              {lastRound >= 1 ? (
                <Btn onClick={() => setBetResult(lastRound)} disabled={busy}>
                  use last round ({num(lastRound)}×)
                </Btn>
              ) : null}
              <Btn
                tone="accent"
                disabled={busy || betResult < 1}
                onClick={() =>
                  void act(() =>
                    api.post(`/sessions/${open.id}/bets`, {
                      stake: open.stake,
                      target: open.target,
                      result: Math.round(betResult * 100) / 100,
                    }),
                  )
                }
              >
                log bet
              </Btn>
              <span className="pb-2 text-[11px] text-muted-foreground">
                Anything at or above {num(open.target)}× counts as a cash-out; below it the stake is lost.
              </span>
            </div>

            {bets.length > 0 ? (
              <div className="mt-3">
                <Table head={["#", "stake", "target", "result", "outcome", "P&L", "bankroll", "when"]}>
                  {[...bets].reverse().map((b) => (
                    <Row key={b.id}>
                      <Cell tone="muted">{b.id}</Cell>
                      <Cell>{money(b.stake, currency)}</Cell>
                      <Cell tone="muted">{num(b.target)}×</Cell>
                      <Cell>{num(b.result)}×</Cell>
                      <Cell tone={b.won ? "good" : "bad"}>{b.won ? "cashed" : "busted"}</Cell>
                      <Cell tone={b.pnl >= 0 ? "good" : "bad"}>{money(b.pnl, currency)}</Cell>
                      <Cell tone="muted">{money(b.bankrollAfter, currency)}</Cell>
                      <Cell tone="muted">{ago(b.createdAt)}</Cell>
                    </Row>
                  ))}
                </Table>
              </div>
            ) : null}
          </Panel>
        ) : (
          <Panel title="start a session" note="Only one session can be open at a time — that is deliberate.">
            <Grid cols={3}>
              <Field label="session name">
                <TextInput value={name} onChange={setName} placeholder="e.g. Friday evening" />
              </Field>
              <Field label={`bankroll (${currency})`}>
                <NumInput value={bankroll} onChange={setBankroll} step={50} min={10} />
              </Field>
              <Field label={`stake per round (${currency})`}>
                <NumInput value={stake} onChange={setStake} step={1} min={0.5} />
              </Field>
              <Field label="target">
                <NumInput value={target} onChange={setTarget} step={0.1} min={1.01} />
              </Field>
              <Field label={`stop-loss (${currency})`} hint="The session locks a warning once P&L reaches this.">
                <NumInput value={lossLimit} onChange={setLossLimit} step={10} min={1} />
              </Field>
            </Grid>
            <div className="mt-3">
              <Btn
                tone="accent"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    api.post("/sessions", {
                      name: name.trim() || `session ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
                      bankroll,
                      stake,
                      target,
                      lossLimit,
                    }),
                  )
                }
              >
                {busy ? "opening…" : "open session"}
              </Btn>
            </div>
          </Panel>
        )}

        <Panel
          title="session history"
          right={
            <Async query={sessions} rows={1}>
              {(s) => (
                <span className={`font-mono-num text-[11px] ${s.totalPnl >= 0 ? "text-accent" : "text-destructive"}`}>
                  lifetime {money(s.totalPnl, currency)}
                </span>
              )}
            </Async>
          }
        >
          <Async query={sessions} rows={3}>
            {(s) =>
              s.sessions.length === 0 ? (
                <Empty title="no sessions logged" body="Open a session above to start keeping an honest record." />
              ) : (
                <Table head={["session", "status", "bets", "hit rate", "P&L", "started", "closed"]}>
                  {[...s.sessions].reverse().map((row) => (
                    <Row key={row.id} highlight={row.status === "open"}>
                      <Cell>{row.name}</Cell>
                      <Cell tone={row.status === "open" ? "good" : "muted"}>{row.status}</Cell>
                      <Cell tone="muted">{row.bets}</Cell>
                      <Cell>{row.bets ? pct(row.wins / row.bets) : "—"}</Cell>
                      <Cell tone={row.pnl >= 0 ? "good" : "bad"}>{money(row.pnl, currency)}</Cell>
                      <Cell tone="muted">{ago(row.startedAt)}</Cell>
                      <Cell tone="muted">{row.closedAt ? ago(row.closedAt) : "—"}</Cell>
                    </Row>
                  ))}
                </Table>
              )
            }
          </Async>
        </Panel>
      </div>
    </>
  );
}
