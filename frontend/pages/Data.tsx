/**
 * Data — import, export, reseed, and the API surface reference.
 */
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  Async,
  Btn,
  Cell,
  ErrorNote,
  Field,
  Grid,
  PageHeader,
  Panel,
  Row,
  Stat,
  Table,
  TextInput,
  num,
  useApi,
} from "@/components/kit";
import { SourceDownloadPanel } from "@/components/SourceDownload";
import { api, downloadUrl } from "@/lib/api";
import { useRounds } from "@/lib/store";

interface Meta {
  version: string;
  visitor: string;
  rounds: number;
  liveClients: number;
  seedSource: { serverSeed: string; clientSeed: string; note: string };
}

const ENDPOINTS: { group: string; rows: [string, string][] }[] = [
  {
    group: "tape",
    rows: [
      ["GET /api/rounds", "stored rounds plus the total count"],
      ["POST /api/rounds", "ingest one round, resolves the open forecast first"],
      ["POST /api/rounds/bulk", "ingest many, append or replace"],
      ["POST /api/rounds/reseed", "regenerate a provably-fair tape"],
      ["POST /api/ingest/db/inspect", "upload a .db, list tables and score candidate columns"],
      ["POST /api/ingest/db", "extract a column and seed the tape (dryRun previews it)"],
      ["GET /api/export", "download as json or csv"],
      ["WS /ws/rounds", "live round stream with forecasts and alert events"],
    ],
  },
  {
    group: "analysis",
    rows: [
      ["GET /api/analysis", "full pipeline output for the stored tape"],
      ["GET /api/forecast", "candidate states with calibrated probabilities"],
      ["GET /api/survival", "empirical survival with Hill tail estimate"],
      ["GET /api/curves", "survival curve for charting"],
      ["GET /api/ladder", "ladder and pressure metrics"],
      ["GET /api/dna", "sequence-analogue matches"],
      ["GET /api/context", "dry streaks and live context"],
      ["GET /api/stats/summary", "headline figures against fair baselines"],
    ],
  },
  {
    group: "scoring",
    rows: [
      ["GET /api/ledger", "locked forecasts and their resolution"],
      ["GET /api/calibration", "Brier, log loss, reliability buckets"],
      ["GET /api/randomness", "the full independence battery"],
      ["GET /api/randomness/{test}", "one test in isolation"],
    ],
  },
  {
    group: "money",
    rows: [
      ["GET /api/ev/table", "EV, variance and wait time by target"],
      ["GET /api/ev/kelly", "Kelly fraction against the fair price"],
      ["POST /api/ev/ruin", "Monte Carlo risk of ruin"],
      ["GET /api/ev/martingale", "step-by-step martingale exposure"],
      ["GET /api/ev/plan", "bankroll plan and house rules"],
      ["POST /api/backtest", "walk-forward backtest"],
      ["GET /api/backtest/grid", "target × staking grid"],
    ],
  },
  {
    group: "fairness",
    rows: [
      ["POST /api/fair/verify", "recompute one round from its seeds"],
      ["POST /api/fair/verify-batch", "audit a run of consecutive rounds"],
      ["POST /api/fair/solve", "brute-force the operator's convention"],
      ["GET /api/fair/conventions", "supported templates and hashes"],
      ["GET /api/fair/audits", "stored audit trail"],
    ],
  },
  {
    group: "session",
    rows: [
      ["GET/POST /api/alerts", "watch CRUD"],
      ["GET/POST /api/sessions", "bankroll sessions and logged bets"],
      ["GET/PUT /api/settings", "operator, edge, bankroll, limits"],
      ["POST /api/sim/start|stop", "control the verifiable round generator"],
    ],
  },
];

export default function Data() {
  const { rounds, total, importRounds, resetToSeed, clearAll, refresh } = useRounds();
  const meta = useApi<Meta>("/meta");
  const [bulk, setBulk] = useState("");
  const [seedServer, setSeedServer] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => {
    setNotice(m);
    window.setTimeout(() => setNotice(null), 3000);
  };

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await Promise.all([refresh(), meta.refetch()]);
      flash(label);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  const parseValues = (text: string) =>
    text
      .split(/[\s,;\n\t]+/)
      .map((s) => parseFloat(s.replace(",", ".")))
      .filter((v) => Number.isFinite(v) && v >= 1);

  const onFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      let values: number[] = [];
      try {
        const parsed = JSON.parse(text) as unknown;
        const arr = Array.isArray(parsed)
          ? parsed
          : typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { rounds?: unknown[] }).rounds)
            ? (parsed as { rounds: unknown[] }).rounds
            : [];
        values = arr
          .map((r) => {
            if (typeof r === "number") return r;
            if (typeof r === "object" && r !== null) {
              const o = r as Record<string, unknown>;
              const v = o.m ?? o.multiplier ?? o.crashPoint ?? o.crash_point;
              return typeof v === "number" ? v : NaN;
            }
            return NaN;
          })
          .filter((v) => Number.isFinite(v) && v >= 1);
      } catch {
        values = parseValues(text);
      }
      if (values.length === 0) {
        flash("no usable multipliers found in that file");
        return;
      }
      void act(`${values.length} rounds imported from ${f.name}`, () => importRounds(values, "append"));
    };
    reader.readAsText(f);
  };

  return (
    <>
      <PageHeader title="Data & Export" kicker={`${total.toLocaleString()} rounds · server-side storage`}>
        <Btn onClick={() => window.open(downloadUrl("/export?fmt=json"), "_blank")}>export json</Btn>
        <Btn onClick={() => window.open(downloadUrl("/export?fmt=csv"), "_blank")}>export csv</Btn>
      </PageHeader>

      <div className="space-y-4">
        {notice ? (
          <div className="rounded border border-accent/50 bg-accent/[0.07] px-3 py-2 text-xs text-accent">{notice}</div>
        ) : null}
        {err ? <ErrorNote error={err} /> : null}

        <Async query={meta} rows={2}>
          {(m) => (
            <Grid cols={4}>
              <Stat label="engine version" value={m.version} />
              <Stat label="rounds stored" value={m.rounds.toLocaleString()} />
              <Stat label="live subscribers" value={m.liveClients} />
              <Stat label="workspace" value={m.visitor} sub="rounds, settings and audits are scoped to this id" />
            </Grid>
          )}
        </Async>

        <Grid cols={2}>
          <Panel title="import" note="Values are appended in the order given, then the whole tape is re-analysed.">
            <Field label="paste multipliers" hint="Any separator: spaces, commas, newlines.">
              <textarea
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                rows={5}
                spellCheck={false}
                className="w-full rounded border border-border bg-background/60 px-2.5 py-2 font-mono text-xs text-foreground outline-none transition-colors focus:border-accent"
                placeholder="1.24 5.60 1.01 22.40 2.35 …"
              />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn
                tone="accent"
                disabled={busy || parseValues(bulk).length === 0}
                onClick={() => {
                  const values = parseValues(bulk);
                  void act(`${values.length} rounds appended`, async () => {
                    await importRounds(values, "append");
                    setBulk("");
                  });
                }}
              >
                append {parseValues(bulk).length || ""} rounds
              </Btn>
              <Btn disabled={busy} onClick={() => fileRef.current?.click()}>
                import a file
              </Btn>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="mt-3 border-t border-border/60 pt-2 text-[11px] leading-relaxed text-muted-foreground">
              Have a scraper database instead of a list of numbers?{" "}
              <Link to="/ingest" className="text-accent underline decoration-dotted">
                Database ingest
              </Link>{" "}
              reads a .db file directly, finds the multiplier column, and keeps its real timestamps so cadence and the
              time-of-day test work.
            </p>
          </Panel>

          <Panel
            title="regenerate the tape"
            note="Seeding uses the provably-fair algorithm rather than a plain random number generator, so every seeded round can be recomputed on the Fairness page."
          >
            <Field label="server seed (optional)" hint="Leave blank to use the built-in demo seed.">
              <TextInput value={seedServer} onChange={setSeedServer} placeholder="momento-demo-server-seed-…" />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn
                disabled={busy}
                onClick={() =>
                  void act("tape regenerated with 900 verifiable rounds", () =>
                    api.post(
                      `/rounds/reseed?count=900${seedServer.trim() ? `&serverSeed=${encodeURIComponent(seedServer.trim())}` : ""}`,
                    ),
                  )
                }
              >
                reseed 900 rounds
              </Btn>
              <Btn disabled={busy} onClick={() => void act("reset to the default demo tape", () => resetToSeed())}>
                reset to demo tape
              </Btn>
              <Btn tone="danger" disabled={busy} onClick={() => void act("tape cleared", () => clearAll())}>
                clear all rounds
              </Btn>
            </div>
            <Async query={meta} rows={2}>
              {(m) => (
                <div className="mt-4 space-y-1.5 border-t border-border/60 pt-3">
                  <p className="stat-label">demo tape seed pair</p>
                  <p className="break-all font-mono text-[10px] text-foreground">server: {m.seedSource.serverSeed}</p>
                  <p className="break-all font-mono text-[10px] text-foreground">client: {m.seedSource.clientSeed}</p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">{m.seedSource.note}</p>
                </div>
              )}
            </Async>
          </Panel>
        </Grid>

        <SourceDownloadPanel />

        <Panel
          title="tape preview"
          right={<span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">last 40 rounds</span>}
        >
          <div className="flex flex-wrap gap-1.5">
            {rounds.slice(-40).map((r) => (
              <span
                key={r.id}
                className="rounded border border-border/70 bg-background/40 px-1.5 py-0.5 font-mono-num text-[11px] text-muted-foreground"
              >
                {num(r.m)}×
              </span>
            ))}
          </div>
        </Panel>

        <Panel
          title="API surface"
          note="Every view in this terminal reads the same public REST surface — nothing is computed in the browser and hidden from you."
        >
          <div className="space-y-4">
            {ENDPOINTS.map((g) => (
              <div key={g.group}>
                <p className="stat-label mb-1.5">{g.group}</p>
                <Table head={["endpoint", "returns"]}>
                  {g.rows.map(([path, desc]) => (
                    <Row key={path}>
                      <Cell className="whitespace-nowrap text-accent">{path}</Cell>
                      <Cell tone="muted" className="font-sans">
                        {desc}
                      </Cell>
                    </Row>
                  ))}
                </Table>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
