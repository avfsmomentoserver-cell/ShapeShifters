/**
 * Live Feed — the raw tape, manual entry, and the verifiable round generator.
 */
import { useState } from "react";

import { ScopeChart, colorFor } from "@/components/charts";
import {
  Async,
  Btn,
  Cell,
  Empty,
  Field,
  Grid,
  NumInput,
  PageHeader,
  Panel,
  Row,
  Stat,
  Table,
  ago,
  mult,
  num,
  pct,
  useApi,
} from "@/components/kit";
import { api } from "@/lib/api";
import { useRounds } from "@/lib/store";

interface SimStatus {
  running: boolean;
  liveClients: number;
  state: null | {
    serverSeed: string;
    clientSeed: string;
    serverSeedHash: string;
    nonce: number;
    intervalMs: number;
    houseEdge: number;
  };
}

export default function Feed() {
  const { rounds, total, isLive, setIsLive, conn, context, lastAddedAt, addManual, refresh } = useRounds();
  const [entry, setEntry] = useState(2);
  const [busy, setBusy] = useState(false);
  const sim = useApi<SimStatus>("/sim/status", { refetchInterval: 5_000 });

  const submit = async () => {
    if (!Number.isFinite(entry) || entry < 1) return;
    setBusy(true);
    try {
      await addManual(Math.round(entry * 100) / 100);
    } finally {
      setBusy(false);
    }
  };

  const tail = rounds.slice(-120).reverse();

  return (
    <>
      <PageHeader title="Live Feed" kicker={`socket ${conn} · ${total.toLocaleString()} rounds stored`}>
        <Btn tone={isLive ? "danger" : "accent"} onClick={() => void setIsLive(!isLive)}>
          {isLive ? "stop generator" : "start generator"}
        </Btn>
        <Btn onClick={() => void refresh()}>refresh</Btn>
      </PageHeader>

      <div className="space-y-4">
        {context ? (
          <Grid cols={4}>
            <Stat label="last round" value={mult(context.last)} sub={lastAddedAt ? ago(new Date(lastAddedAt).toISOString()) : "from stored tape"} />
            <Stat
              label="dry streak under 2×"
              value={context.dryStreak}
              sub="the next round is drawn independently of this number"
              tone={context.dryStreak > 6 ? "warn" : "default"}
            />
            <Stat label="rounds since 10×" value={context.dryStreak10x} />
            <Stat
              label="P(≥2×) last 100"
              value={pct(context.recentHitRate2x)}
              sub={`fair ${pct(context.fairHitRate2x)}`}
            />
          </Grid>
        ) : null}

        <Panel title="tape" right={<span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">last 90 rounds</span>}>
          {rounds.length > 2 ? <ScopeChart rounds={rounds} visible={90} /> : <Empty title="no rounds yet" body="Start the generator or add a round by hand." />}
        </Panel>

        <Grid cols={2}>
          <Panel
            title="log a real round"
            note="Rounds you type in are stored server-side and scored exactly like generated ones, so you can run the terminal against a real operator's results."
          >
            <div className="flex items-end gap-2">
              <Field label="multiplier" className="flex-1">
                <NumInput value={entry} onChange={setEntry} step={0.01} min={1} />
              </Field>
              <Btn tone="accent" onClick={() => void submit()} disabled={busy}>
                {busy ? "saving…" : "add"}
              </Btn>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[1, 1.25, 1.6, 2, 3.5, 7, 15, 40].map((v) => (
                <button
                  key={v}
                  onClick={() => setEntry(v)}
                  className="rounded border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                >
                  {v.toFixed(2)}×
                </button>
              ))}
            </div>
          </Panel>

          <Panel
            title="generator"
            note="The generator is not a random number faker: each round is derived from a committed seed pair with HMAC-SHA256, so every value it produces can be recomputed on the Fairness page."
          >
            <Async query={sim} rows={3}>
              {(s) => (
                <div className="space-y-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="stat-label">status</span>
                    <span className={s.running ? "text-accent" : "text-muted-foreground"}>
                      {s.running ? "running" : "stopped"}
                    </span>
                  </div>
                  {s.state ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="stat-label">nonce</span>
                        <span className="font-mono-num">{s.state.nonce}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="stat-label">interval</span>
                        <span className="font-mono-num">{(s.state.intervalMs / 1000).toFixed(1)}s</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="stat-label">house edge</span>
                        <span className="font-mono-num">{pct(s.state.houseEdge)}</span>
                      </div>
                      <div>
                        <p className="stat-label">client seed</p>
                        <p className="mt-0.5 break-all font-mono text-[10px] text-foreground">{s.state.clientSeed}</p>
                      </div>
                      <div>
                        <p className="stat-label">server seed hash (commitment)</p>
                        <p className="mt-0.5 break-all font-mono text-[10px] text-accent">{s.state.serverSeedHash}</p>
                      </div>
                      <div>
                        <p className="stat-label">server seed (revealed)</p>
                        <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">{s.state.serverSeed}</p>
                      </div>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Start the generator to commit a seed pair.</p>
                  )}
                  <div className="pt-1">
                    <Btn
                      onClick={async () => {
                        await api.post("/rounds/reseed?count=900");
                        await refresh();
                      }}
                    >
                      regenerate 900-round tape
                    </Btn>
                  </div>
                </div>
              )}
            </Async>
          </Panel>
        </Grid>

        <Panel title="round log" right={<span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">newest first</span>}>
          {tail.length === 0 ? (
            <Empty title="empty tape" body="No rounds stored for this session yet." />
          ) : (
            <Table head={["#", "multiplier", "band", "time"]}>
              {tail.map((r) => (
                <Row key={r.id}>
                  <Cell tone="muted">{r.id}</Cell>
                  <Cell>
                    <span style={{ color: colorFor(r.m) }}>{num(r.m)}×</span>
                  </Cell>
                  <Cell tone="muted">{r.m < 2 ? "floor" : r.m < 10 ? "mid" : "moon"}</Cell>
                  <Cell tone="muted">{ago(r.ts)}</Cell>
                </Row>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
