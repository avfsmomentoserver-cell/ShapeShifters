/**
 * Skill Ledger — walk-forward Brier scores for every ensemble component at every
 * threshold. This is the page that decides whether any pattern engine gets weight
 * in the forecast, and on a fair tape the honest answer is none of them.
 *
 * Merged from the Momento Platform 6.2.0 bundle's accuracy engine, re-scored
 * walk-forward in this backend so no component can see a round before predicting
 * it.
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
  useApi,
} from "@/components/kit";

interface SkillRow {
  threshold: number;
  scored: number | null;
  baselineBrier: number | null;
  brier: Record<string, number> | null;
  skill: Record<string, number> | null;
  best: string | null;
  anySkill: boolean;
}

interface SkillPayload {
  rounds: number;
  rows: SkillRow[];
  withSkill: number;
  verdict: string;
  note: string;
}

const MODELS = ["markov", "streak", "recent"] as const;

const DESCRIPTIONS: Record<string, string> = {
  markov: "P(hit | the previous round hit or missed) — the whole 'hot and cold' theory in one number.",
  streak: "P(hit | the current miss-streak is exactly this long) — the 'it's due' theory.",
  recent: "the hit rate over the last 200 rounds — the 'the table is running hot' theory.",
  baseline: "the measured rate over all history, updated as rounds resolve.",
};

export default function Skill() {
  const q = useApi<SkillPayload>("/skill");

  return (
    <div className="space-y-4">
      <PageHeader title="SKILL LEDGER" kicker="does any pattern beat the base rate?" />

      <Async query={q} rows={6}>
        {(d) => {
          const best = d.rows.reduce(
            (acc, r) => {
              for (const m of MODELS) {
                const v = r.skill?.[m] ?? 0;
                if (v > acc.value) acc = { value: v, model: m, threshold: r.threshold };
              }
              return acc;
            },
            { value: 0, model: "none", threshold: 0 },
          );
          return (
            <div className="space-y-4">
              <Grid cols={4}>
                <Stat label="rounds" value={d.rounds.toLocaleString()} />
                <Stat
                  label="thresholds with any skill"
                  value={`${d.withSkill} / ${d.rows.length}`}
                  tone={d.withSkill === 0 ? "good" : "warn"}
                />
                <Stat
                  label="best component"
                  value={best.value > 0 ? best.model : "none"}
                  sub={best.value > 0 ? `skill ${num(best.value, 4)} at ${best.threshold}×` : "baseline wins everywhere"}
                  tone={best.value > 0 ? "warn" : "good"}
                />
                <Stat
                  label="rounds scored"
                  value={(d.rows[0]?.scored ?? 0).toLocaleString()}
                  sub="first 100 rounds are warm-up"
                />
              </Grid>

              <Panel title="Brier skill by threshold" note={d.note} right={<Verdict verdict={d.withSkill === 0 ? "consistent" : "suspect"} />}>
                <Table head={["threshold", "scored", "baseline brier", "markov", "streak", "recent", "winner", ""]}>
                  {d.rows.map((r) => (
                    <Row key={r.threshold} highlight={r.anySkill}>
                      <Cell>{r.threshold}×</Cell>
                      <Cell tone="muted">{(r.scored ?? 0).toLocaleString()}</Cell>
                      <Cell>{r.baselineBrier === null ? "—" : num(r.baselineBrier, 5)}</Cell>
                      {MODELS.map((m) => {
                        const s = r.skill?.[m] ?? 0;
                        return (
                          <Cell key={m} tone={s > 0 ? "good" : "muted"}>
                            {num(r.brier?.[m] ?? null, 5)}
                            <span className="ml-1 text-[10px]">{s > 0 ? `(+${num(s, 4)})` : "(0)"}</span>
                          </Cell>
                        );
                      })}
                      <Cell tone={r.anySkill ? "good" : "muted"}>{r.anySkill ? r.best : "baseline"}</Cell>
                      <Cell className="w-[120px]">
                        <IntervalBar
                          value={Math.min(1, Math.max(...MODELS.map((m) => r.skill?.[m] ?? 0)) * 20)}
                          tone={r.anySkill ? "amber" : "green"}
                        />
                      </Cell>
                    </Row>
                  ))}
                </Table>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  Lower Brier is better. Skill is 1 − Brier / BrierBaseline, so 0 means "no better than the measured rate"
                  and the bar is that skill magnified twenty times just to make any non-zero value visible.
                </p>
              </Panel>

              <Panel title="What each component claims">
                <dl className="space-y-2.5">
                  {["baseline", ...MODELS].map((m) => (
                    <div key={m} className="min-w-0">
                      <dt className="text-[11px] uppercase tracking-[0.16em] text-foreground">{m}</dt>
                      <dd className="text-[11px] leading-relaxed text-muted-foreground">{DESCRIPTIONS[m]}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Each is scored on rounds it had not seen: at round <span className="font-mono-num">i</span> the component
                  is rebuilt from rounds <span className="font-mono-num">0…i−1</span> only, predicts, and is then shown the
                  answer. That is the only scoring that cannot flatter a pattern engine — and it is why{" "}
                  <Source href="https://en.wikipedia.org/wiki/Brier_score">the Brier score</Source> is the metric here
                  rather than a hit-rate screenshot. Expected-value maths is unchanged by any of it:{" "}
                  <Source href="https://crashedge.com/strategy/optimal-bet-sizing-crash-games/">
                    every stake keeps the house edge
                  </Source>
                  .
                </p>
              </Panel>
            </div>
          );
        }}
      </Async>
    </div>
  );
}
