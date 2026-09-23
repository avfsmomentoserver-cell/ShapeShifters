/**
 * Responsible play — the arithmetic of loss, the warning signs, and where to get
 * help. Not a disclaimer footer; a page with numbers in it.
 */
import { useState } from "react";

import { Btn, Field, Grid, NumInput, PageHeader, Panel, Stat, money, num, pct } from "@/components/kit";
import { useRounds } from "@/lib/store";

const SIGNS = [
  "Betting more than the amount you decided on before you started.",
  "Chasing a loss with a bigger stake, or playing on to 'get back to even'.",
  "Playing with money meant for rent, food, school fees or debt.",
  "Borrowing to play, or hiding how much you have played from people close to you.",
  "Feeling you must keep playing to feel normal, or feeling irritable when you stop.",
  "Believing a pattern, streak or tracker has told you the next round is safe.",
];

export default function Responsible() {
  const { settings } = useRounds();
  const currency = settings?.currency ?? "BWP";
  const edge = settings?.houseEdge ?? 0.03;

  const [stake, setStake] = useState(20);
  const [roundsPerHour, setRoundsPerHour] = useState(60);
  const [hoursPerWeek, setHoursPerWeek] = useState(5);

  const perHour = stake * roundsPerHour * edge;
  const perWeek = perHour * hoursPerWeek;
  const perYear = perWeek * 52;

  return (
    <>
      <PageHeader title="Responsible Play" kicker="the cost, in numbers rather than small print" />

      <div className="space-y-4">
        <Panel title="what a crash game costs to play">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The house edge is not a risk of losing — it is the average rate at which money is transferred, and it applies to
            every round regardless of skill, target, timing or tracker. Multiply stake by rounds and by the edge and you
            have the price. Below, put in your own numbers.
          </p>
          <Grid cols={3} className="mt-3">
            <Field label={`stake per round (${currency})`}>
              <NumInput value={stake} onChange={setStake} step={1} min={0.5} />
            </Field>
            <Field label="rounds per hour" hint="Crash rounds are short — 40 to 90 an hour is typical.">
              <NumInput value={roundsPerHour} onChange={setRoundsPerHour} step={5} min={1} max={400} />
            </Field>
            <Field label="hours per week">
              <NumInput value={hoursPerWeek} onChange={setHoursPerWeek} step={1} min={0} max={80} />
            </Field>
          </Grid>
          <Grid cols={4} className="mt-4">
            <Stat label="house edge in use" value={pct(edge)} sub={settings?.operator} />
            <Stat label="expected cost per hour" value={money(perHour, currency)} tone="warn" />
            <Stat label="per week" value={money(perWeek, currency)} tone="bad" />
            <Stat label="per year" value={money(perYear, currency)} tone="bad" />
          </Grid>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            That is the average, not the worst case. Turnover per hour is{" "}
            {money(stake * roundsPerHour, currency)}, so a bad session can lose many times the figures above; a good one
            can win. The average is the only part that is predictable, and it points one way.
          </p>
        </Panel>

        <Grid cols={2}>
          <Panel title="what this terminal will not tell you">
            <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              <li>That a round is "due". A dry streak of twenty carries exactly the same next-round probability as a dry streak of zero.</li>
              <li>That a pattern, state or pressure reading is an entry signal. They are descriptions of rounds that already happened.</li>
              <li>That a staking plan converts a negative expectation into a positive one. None does.</li>
              <li>That a losing session can be recovered by raising the stake. Raising the stake raises the expected loss.</li>
            </ul>
          </Panel>

          <Panel title="warning signs">
            <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
              {SIGNS.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="text-[#ffb020]">—</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </Grid>

        <Panel title="practical limits that work">
          <Grid cols={2}>
            <ol className="space-y-2 text-xs leading-relaxed text-foreground">
              <li>
                <span className="font-mono-num text-accent">01</span> Decide the session budget and the stop-loss before
                opening the game, and write them into the Bankroll page so they are not renegotiated mid-session.
              </li>
              <li>
                <span className="font-mono-num text-accent">02</span> Set a time limit as well as a money limit. Time is
                what converts a small edge into a large loss.
              </li>
              <li>
                <span className="font-mono-num text-accent">03</span> Set the auto-cash-out before the round starts. Never
                decide mid-flight.
              </li>
            </ol>
            <ol className="space-y-2 text-xs leading-relaxed text-foreground">
              <li>
                <span className="font-mono-num text-accent">04</span> Stop after three consecutive losses and step away,
                regardless of what any indicator says.
              </li>
              <li>
                <span className="font-mono-num text-accent">05</span> Treat the budget as an entertainment cost already
                spent, not an investment with an expected return.
              </li>
              <li>
                <span className="font-mono-num text-accent">06</span> Use the operator's deposit limits, reality checks and
                self-exclusion tools. They work better than willpower.
              </li>
            </ol>
          </Grid>
        </Panel>

        <Panel title="getting help">
          <p className="text-xs leading-relaxed text-muted-foreground">
            If any of the warning signs above sound familiar, speaking to someone helps and is free. International
            directories of gambling support services are maintained by{" "}
            <a
              href="https://www.begambleaware.org/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline underline-offset-2"
            >
              BeGambleAware
            </a>{" "}
            and{" "}
            <a
              href="https://www.gamblingtherapy.org/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline underline-offset-2"
            >
              Gambling Therapy
            </a>
            , which offers multilingual online support worldwide.{" "}
            <a
              href="https://www.gamblersanonymous.org/ga/locations"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline underline-offset-2"
            >
              Gamblers Anonymous
            </a>{" "}
            lists local meetings by country. If you are in immediate financial or emotional crisis, contact a local health
            service or crisis line rather than waiting.
          </p>
          <div className="mt-3">
            <Btn onClick={() => window.open("https://www.gamblingtherapy.org/", "_blank", "noopener")}>
              open Gambling Therapy
            </Btn>
          </div>
        </Panel>

        <Panel title="about this build">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Momento is an analytics and verification tool. It does not take bets, hold funds, connect to any operator or
            place wagers on your behalf, and it is not affiliated with Spribe, Aviator or any gaming operator. The demo
            tape is generated locally from a committed seed pair. Nothing here is financial advice, and the expected value
            of playing a crash game at a{" "}
            <span className="text-foreground">{pct(edge)}</span> house edge is {money(-stake * edge, currency)} per{" "}
            {money(stake, currency)} staked — a number stated as {num(-edge * 100, 1)}% on every page that touches money.
          </p>
        </Panel>
      </div>
    </>
  );
}
