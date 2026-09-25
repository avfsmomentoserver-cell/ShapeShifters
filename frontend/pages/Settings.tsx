/**
 * Settings — the house edge set here propagates into every probability, EV figure
 * and fairness derivation in the terminal, so it matters more than it looks.
 */
import { useEffect, useState } from "react";

import {
  Async,
  Btn,
  Field,
  Grid,
  NumInput,
  PageHeader,
  Panel,
  Select,
  Source,
  Stat,
  TextInput,
  Toggle,
  num,
  pct,
  useApi,
} from "@/components/kit";
import type { Settings as SettingsShape } from "@/lib/api";
import { useRounds } from "@/lib/store";

interface Preset {
  id: string;
  label: string;
  edge: number;
  rtp: number;
}

interface Payload {
  settings: SettingsShape;
  presets: Preset[];
  defaults: SettingsShape;
}

export default function Settings() {
  const { saveSettings } = useRounds();
  const query = useApi<Payload>("/settings");
  const [draft, setDraft] = useState<SettingsShape | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (query.data && !draft) setDraft(query.data.settings);
  }, [query.data, draft]);

  const set = <K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setSaved(false);
  };

  const commit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await saveSettings(draft);
      await query.refetch();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" kicker="the house edge here drives every number in the terminal">
        <Btn tone="accent" onClick={() => void commit()} disabled={busy || !draft}>
          {busy ? "saving…" : saved ? "saved" : "save settings"}
        </Btn>
      </PageHeader>

      <Async query={query} rows={8}>
        {(p) => {
          const d = draft ?? p.settings;
          return (
            <div className="space-y-4">
              <Panel
                title="operator"
                note="Presets carry each operator's published RTP. If yours is not listed, set the edge by hand — a wrong edge quietly biases every probability, EV row and fairness derivation on the site."
              >
                <Grid cols={3}>
                  <Field label="preset">
                    <Select
                      value={d.edgePreset}
                      onChange={(v) => {
                        const preset = p.presets.find((x) => x.id === v);
                        setDraft({
                          ...d,
                          edgePreset: v,
                          houseEdge: preset ? preset.edge : d.houseEdge,
                          operator: preset ? preset.label : d.operator,
                        });
                        setSaved(false);
                      }}
                      options={[
                        ...p.presets.map((x) => ({ value: x.id, label: `${x.label} — ${pct(x.rtp)} RTP` })),
                        { value: "custom", label: "custom" },
                      ]}
                    />
                  </Field>
                  <Field label="operator name">
                    <TextInput value={d.operator} onChange={(v) => set("operator", v)} />
                  </Field>
                  <Field label="currency">
                    <TextInput value={d.currency} onChange={(v) => set("currency", v)} />
                  </Field>
                  <Field label="house edge" hint="0.03 means a 97% RTP.">
                    <NumInput
                      value={d.houseEdge}
                      onChange={(v) => {
                        setDraft({ ...d, houseEdge: v, edgePreset: "custom" });
                        setSaved(false);
                      }}
                      step={0.001}
                      min={0}
                      max={0.2}
                    />
                  </Field>
                  <Field label="default cash-out target">
                    <NumInput value={d.defaultTarget} onChange={(v) => set("defaultTarget", v)} step={0.1} min={1.01} />
                  </Field>
                </Grid>
                <Grid cols={3} className="mt-4">
                  <Stat label="implied RTP" value={pct(1 - d.houseEdge)} />
                  <Stat label="fair P(≥2×)" value={pct((1 - d.houseEdge) / 2)} />
                  <Stat label="median crash point" value={`${num(2 * (1 - d.houseEdge))}×`} />
                </Grid>
              </Panel>

              <Panel title="bankroll and limits" note="These feed the bankroll plan, the EV desk defaults and the session stop-loss.">
                <Grid cols={4}>
                  <Field label={`bankroll (${d.currency})`}>
                    <NumInput value={d.bankroll} onChange={(v) => set("bankroll", v)} step={50} min={1} />
                  </Field>
                  <Field label="max risk per round" hint="Fraction of bankroll.">
                    <NumInput value={d.maxRiskPerRound} onChange={(v) => set("maxRiskPerRound", v)} step={0.005} min={0.001} max={0.5} />
                  </Field>
                  <Field label="session loss limit" hint="Fraction of bankroll.">
                    <NumInput value={d.sessionLossLimit} onChange={(v) => set("sessionLossLimit", v)} step={0.01} min={0.01} max={1} />
                  </Field>
                  <Field label="confidence floor" hint="Forecasts below this are shown as no-call.">
                    <NumInput value={d.confidenceFloor} onChange={(v) => set("confidenceFloor", v)} step={0.01} min={0} max={1} />
                  </Field>
                </Grid>
                <Grid cols={3} className="mt-4">
                  <Stat label="stake per round" value={`${d.currency} ${num(d.bankroll * d.maxRiskPerRound)}`} />
                  <Stat label="stop-loss" value={`${d.currency} ${num(d.bankroll * d.sessionLossLimit)}`} tone="warn" />
                  <Stat
                    label="expected cost per round"
                    value={`${d.currency} ${num(d.bankroll * d.maxRiskPerRound * d.houseEdge, 3)}`}
                    tone="bad"
                  />
                </Grid>
              </Panel>

              <Panel title="feed and interface">
                <Grid cols={2}>
                  <Field label="generator interval (ms)" hint="How fast the verifiable round generator produces rounds.">
                    <NumInput
                      value={d.liveFeedIntervalMs}
                      onChange={(v) => set("liveFeedIntervalMs", v)}
                      step={250}
                      min={500}
                      max={60000}
                    />
                  </Field>
                  <div className="space-y-2.5 pt-1">
                    <Toggle
                      on={d.simulatorEnabled}
                      label="allow the round generator (off by default — the live tape is fed by the file watcher)"
                      onChange={(v) => set("simulatorEnabled", v)}
                    />
                    <Toggle
                      on={d.showResponsibleBanner}
                      label="show the responsible-play banner"
                      onChange={(v) => set("showResponsibleBanner", v)}
                    />
                  </div>
                </Grid>
              </Panel>

              <Panel title="where these defaults come from">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The 3% default edge matches the 97% RTP Spribe publishes for Aviator (
                  <Source href="https://playstories.co/aviator-rtp/">RTP breakdown</Source>,{" "}
                  <Source href="https://crashgamesplay.com/guides/aviator-review/">operator review</Source>). Stake Crash
                  and Bustabit-style games run near 1%, the latter from the bust-when-hash-mod-101-is-zero rule described by{" "}
                  <Source href="https://provenlyfair.com/blog/verify-provably-fair-crash/">ProvenlyFair</Source>. The
                  default 2% risk per round and 15% session stop-loss follow standard bankroll guidance for negative-edge
                  games (<Source href="https://crashedge.com/strategy/bankroll-management-crash-games/">CrashEdge</Source>
                  ), which controls survival time rather than expectation.
                </p>
              </Panel>

              <Panel title="reset">
                <Btn
                  onClick={() => {
                    setDraft(p.defaults);
                    setSaved(false);
                  }}
                >
                  restore defaults
                </Btn>
              </Panel>
            </div>
          );
        }}
      </Async>
    </>
  );
}
