/**
 * Alerts — server-side watches evaluated on every round as it lands, so they fire
 * whether or not this tab is open.
 */
import { useState } from "react";

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
  TextInput,
  Toggle,
  ago,
  num,
  useApi,
} from "@/components/kit";
import { api } from "@/lib/api";
import type { AlertEventRow, AlertRow } from "@/lib/api";

interface AlertsPayload {
  alerts: AlertRow[];
  events: AlertEventRow[];
  kinds: { id: string; label: string; unit: string }[];
}

const COMPARATORS = [
  { value: ">=", label: "at or above" },
  { value: "<=", label: "at or below" },
];

export default function Alerts() {
  const alerts = useApi<AlertsPayload>("/alerts", { refetchInterval: 15_000 });

  const [name, setName] = useState("");
  const [kind, setKind] = useState("multiplier");
  const [comparator, setComparator] = useState(">=");
  const [threshold, setThreshold] = useState(10);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await alerts.refetch();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const unitFor = (id: string) => alerts.data?.kinds.find((k) => k.id === id)?.unit ?? "";

  return (
    <>
      <PageHeader title="Alerts" kicker="evaluated server-side on every round" />

      <div className="space-y-4">
        <Panel title="an alert is a notification, not a signal">
          <p className="text-xs leading-relaxed text-muted-foreground">
            These watches tell you a condition has occurred — a 50× landed, a dry streak reached twelve rounds, the engine's
            estimate crossed a threshold. None of them predict the next round, because the randomness battery shows the
            rounds are independent. Use them to stop staring at a screen, not as entry triggers.
          </p>
        </Panel>

        <Async query={alerts} rows={6}>
          {(a) => (
            <>
              <Grid cols={4}>
                <Stat label="watches" value={a.alerts.length} />
                <Stat label="active" value={a.alerts.filter((x) => x.active).length} tone="good" />
                <Stat label="total triggers" value={a.alerts.reduce((s, x) => s + x.triggerCount, 0)} />
                <Stat label="recent events" value={a.events.length} />
              </Grid>

              <Panel title="new watch">
                <Grid cols={4}>
                  <Field label="name">
                    <TextInput value={name} onChange={setName} placeholder="e.g. moonshot landed" />
                  </Field>
                  <Field label="metric">
                    <Select
                      value={kind}
                      onChange={(v) => setKind(v)}
                      options={a.kinds.map((k) => ({ value: k.id, label: k.label }))}
                    />
                  </Field>
                  <Field label="condition">
                    <Select value={comparator} onChange={setComparator} options={COMPARATORS} />
                  </Field>
                  <Field label={`threshold (${unitFor(kind)})`}>
                    <NumInput value={threshold} onChange={setThreshold} step={kind === "dry_streak" ? 1 : 0.05} min={0} />
                  </Field>
                </Grid>
                <div className="mt-3">
                  <Btn
                    tone="accent"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await api.post("/alerts", {
                          name:
                            name.trim() ||
                            `${a.kinds.find((k) => k.id === kind)?.label ?? kind} ${comparator} ${threshold}`,
                          kind,
                          comparator,
                          threshold,
                        });
                        setName("");
                      })
                    }
                  >
                    {busy ? "saving…" : "create watch"}
                  </Btn>
                </div>
                {err ? <div className="mt-2"><ErrorNote error={err} /></div> : null}
              </Panel>

              <Panel title="watches">
                {a.alerts.length === 0 ? (
                  <Empty title="no watches yet" body="Create one above and it starts evaluating on the next round." />
                ) : (
                  <div className="space-y-2">
                    {a.alerts.map((row) => (
                      <div
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded border border-border/70 bg-background/40 px-3 py-2.5"
                      >
                        <div className="min-w-[200px] flex-1">
                          <p className="text-xs text-foreground">{row.name}</p>
                          <p className="stat-label mt-0.5">
                            {a.kinds.find((k) => k.id === row.kind)?.label ?? row.kind}{" "}
                            {row.comparator === ">=" ? "≥" : "≤"} {num(row.threshold)} {unitFor(row.kind)}
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-mono-num text-xs text-foreground">{row.triggerCount}</p>
                            <p className="stat-label">triggers</p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono-num text-xs text-muted-foreground">
                              {row.lastTriggeredAt ? ago(row.lastTriggeredAt) : "never"}
                            </p>
                            <p className="stat-label">last fired</p>
                          </div>
                          <Toggle
                            on={row.active}
                            label={row.active ? "on" : "off"}
                            onChange={(v) => void act(() => api.patch(`/alerts/${row.id}`, { active: v }))}
                          />
                          <Btn tone="danger" onClick={() => void act(() => api.del(`/alerts/${row.id}`))}>
                            delete
                          </Btn>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              <Panel title="trigger log" right={<span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">newest first</span>}>
                {a.events.length === 0 ? (
                  <Empty title="nothing has fired yet" body="Start the live feed and watches evaluate against each round as it lands." />
                ) : (
                  <Table head={["watch", "value", "round", "when"]}>
                    {a.events.map((e) => (
                      <Row key={e.id}>
                        <Cell>{e.name}</Cell>
                        <Cell tone="good">{num(e.value)}</Cell>
                        <Cell tone="muted">{e.roundId ?? "—"}</Cell>
                        <Cell tone="muted">{ago(e.firedAt)}</Cell>
                      </Row>
                    ))}
                  </Table>
                )}
              </Panel>
            </>
          )}
        </Async>
      </div>
    </>
  );
}
