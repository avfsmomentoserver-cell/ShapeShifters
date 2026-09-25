/**
 * Dashboard — the one screen that answers "what is the tape doing, how honest is
 * the engine about it, and what is this costing".
 */
import { Link } from "react-router-dom";

import { CommandCenter } from "@/components/CommandCenter";
import { SourceDownloadButton } from "@/components/SourceDownload";
import {
  Async,
  Grid,
  PageHeader,
  Panel,
  Source,
  Stat,
  Verdict,
  mult,
  num,
  pct,
  useApi,
} from "@/components/kit";
import { useRounds } from "@/lib/store";

interface Summary {
  rounds: number;
  houseEdge: number;
  rtp: number;
  operator: string;
  hitRate2x: number;
  fairHitRate2x: number;
  hitRate10x: number;
  fairHitRate10x: number;
  instantCrashRate: number;
  medianObserved: number;
  medianFair: number;
  maxObserved: number;
  ledger: {
    locked: number;
    resolved: number;
    bandAccuracy: number;
    accuracy2x: number;
    avgBrier: number | null;
  };
  context: {
    dryStreak: number;
    dryStreak10x: number;
    pressure: number;
    recentHitRate2x: number;
    gamblersFallacyWarning?: string;
  };
}

interface Battery {
  overall: { verdict: string; summary?: string; passed?: number; total?: number };
  tests: Record<string, { verdict?: string; p_value?: number }>;
}

export default function Dashboard() {
  const { total, context, settings } = useRounds();
  const summary = useApi<Summary>("/stats/summary", { refetchInterval: 20_000 });
  const battery = useApi<Battery>("/randomness", { staleTime: 120_000 });

  return (
    <>
      <PageHeader
        title="Command Center"
        kicker={`${settings?.operator ?? "crash game"} · ${total.toLocaleString()} rounds on tape`}
      >
        <SourceDownloadButton />
      </PageHeader>

      <div className="space-y-4">
        {/* the next-round forecast leads the page: it re-commits on every dropped round */}
        <CommandCenter />

        <Async query={summary} rows={3}>
          {(s) => (
            <Grid cols={4}>
              <Stat
                label="observed P(≥2×)"
                value={pct(s.hitRate2x)}
                sub={`fair price ${pct(s.fairHitRate2x)} at a ${pct(s.houseEdge, 1)} edge`}
                tone={Math.abs(s.hitRate2x - s.fairHitRate2x) < 0.03 ? "good" : "warn"}
              />
              <Stat
                label="observed P(≥10×)"
                value={pct(s.hitRate10x)}
                sub={`fair price ${pct(s.fairHitRate10x)}`}
                tone={Math.abs(s.hitRate10x - s.fairHitRate10x) < 0.02 ? "good" : "warn"}
              />
              <Stat
                label="median crash"
                value={mult(s.medianObserved)}
                sub={`theory says ${mult(s.medianFair)} — that is 2(1 − h)`}
              />
              <Stat label="instant crashes" value={pct(s.instantCrashRate)} sub={`max seen ${mult(s.maxObserved)}`} />
            </Grid>
          )}
        </Async>

        <Grid cols={2}>
          <Panel
            title="is this tape random?"
            right={<Async query={battery} rows={1}>{(b) => <Verdict verdict={b.overall.verdict} />}</Async>}
            note="If the battery says consistent, no pattern engine on this site can have predictive power — the tape carries no exploitable structure. That is the expected result for a correctly implemented game."
          >
            <Async query={battery} rows={3}>
              {(b) => (
                <div className="space-y-2">
                  <p className="text-xs leading-relaxed text-muted-foreground">{b.overall.summary}</p>
                  <ul className="grid grid-cols-2 gap-1.5 text-[11px]">
                    {Object.entries(b.tests).map(([key, t]) => (
                      <li key={key} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1">
                        <span className="text-muted-foreground">{key.replace(/_/g, " ")}</span>
                        <span className="font-mono-num text-foreground">
                          {t.p_value !== undefined && t.p_value !== null ? `p=${num(t.p_value, 3)}` : (t.verdict ?? "—")}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/randomness" className="inline-block text-[11px] text-accent underline underline-offset-2">
                    open the Randomness Lab →
                  </Link>
                </div>
              )}
            </Async>
          </Panel>

          <Panel
            title="engine scorecard"
            note="Band accuracy is measured against forecasts locked before each round landed, never re-scored afterwards."
          >
            <Async query={summary} rows={3}>
              {(s) => (
                <div className="space-y-3">
                  <Grid cols={2} className="gap-2">
                    <Stat label="forecasts locked" value={s.ledger.locked} />
                    <Stat label="resolved" value={s.ledger.resolved} />
                    <Stat
                      label="band accuracy"
                      value={pct(s.ledger.bandAccuracy)}
                      tone={s.ledger.bandAccuracy > 0.5 ? "good" : "muted"}
                    />
                    <Stat label="mean Brier" value={num(s.ledger.avgBrier, 4)} sub="lower is better" />
                  </Grid>
                  <Link to="/accuracy" className="inline-block text-[11px] text-accent underline underline-offset-2">
                    calibration curve and per-state breakdown →
                  </Link>
                </div>
              )}
            </Async>
          </Panel>
        </Grid>

        {context?.gamblersFallacyWarning ? (
          <div className="rounded border border-[#ffb020]/40 bg-[#ffb020]/[0.07] px-3.5 py-2.5 text-xs leading-relaxed text-[#ffb020]">
            <strong className="uppercase tracking-[0.14em]">pattern warning · </strong>
            {context.gamblersFallacyWarning}
          </div>
        ) : null}

        <Panel title="what the numbers above are compared against">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Every "fair" figure on this page comes from the crash payout identity P(reach m) = (1 − h) / m, with expected
            value −h × stake for every cash-out target, documented in{" "}
            <Source href="https://crashedge.com/guides/crash-gambling-maths/">CrashEdge's crash gambling maths guide</Source>
            . The house edge defaults to 3% because Spribe publishes a 97% RTP for Aviator (
            <Source href="https://playstories.co/aviator-rtp/">Aviator RTP breakdown</Source>); change it on the{" "}
            <Link to="/settings" className="text-accent underline underline-offset-2">
              Settings
            </Link>{" "}
            page to match your operator. Round verification follows the HMAC-SHA256 construction described by{" "}
            <Source href="https://provenlyfair.com/blog/verify-provably-fair-crash/">ProvenlyFair</Source>.
          </p>
        </Panel>
      </div>
    </>
  );
}
