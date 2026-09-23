/**
 * Ingest — seed the tape from a SQLite database.
 *
 * Three deliberate steps: inspect, dry-run, commit. The dry run exists because a
 * wrongly chosen column does not fail loudly — it silently produces confident
 * numbers on every other page. So the file is opened read-only, every candidate
 * column is shown with the evidence behind it, and the tape is scored against the
 * fair curve before a single row is written.
 */
import { useState } from "react";

import {
  Btn,
  Cell,
  ErrorNote,
  Field,
  Grid,
  PageHeader,
  Panel,
  Row,
  Select,
  Stat,
  Table,
  Verdict,
  num,
  pct,
} from "@/components/kit";
import { api } from "@/lib/api";
import { useRounds } from "@/lib/store";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// wire types
// ---------------------------------------------------------------------------

interface ColumnInfo {
  name: string;
  sample: string[];
  /** Set when this is not a real column but a JSON path or an expanded list. */
  derived?: "json" | "list" | null;
  note?: string | null;
}

interface Candidate {
  column: string;
  derived?: "json" | "list" | null;
  note?: string | null;
  valuesPerRow?: number | null;
  score: number;
  numericShare: number;
  inRangeShare: number;
  suggestedScale: number;
  scaleNote: string;
  min: number;
  max: number;
  median: number;
  mean: number;
  distinct: number;
  monotonic: boolean;
  sample: number[];
}

interface TimeCandidate {
  column: string;
  score: number;
  parsedShare: number;
  spanHours: number | null;
  hoursCovered: number;
  earliest: string | null;
  latest: string | null;
}

interface TableInfo {
  table: string;
  rows: number;
  columns: ColumnInfo[];
  multiplierCandidates: Candidate[];
  timestampCandidates: TimeCandidate[];
  sampled: number;
  derivedColumns: {
    name: string;
    kind: "json" | "list";
    note: string;
    valuesPerRow: number | null;
    estimatedRounds: number | null;
  }[];
}

interface Inspection {
  uploadId: string;
  filename: string;
  bytes: number;
  tables: TableInfo[];
  recommendation: {
    table: string | null;
    column: string | null;
    derived?: "json" | "list" | null;
    /** False when the best guess is too weak to seed the engines from unattended. */
    trusted?: boolean;
    confidenceFloor?: number;
    timestampColumn: string | null;
    scale: number;
    confidence: number;
    why: string;
  } | null;
  note: string;
  limits: { maxBytes: number; maxRows: number; expiresInSeconds: number };
}

interface PreviewRow {
  threshold: number;
  hits: number;
  rate: number;
  fair: number;
  ratio: number;
  plausible: boolean;
}

interface IngestResult {
  file: string;
  table: string;
  column: string;
  timestampColumn: string | null;
  extraction: {
    scale: number;
    scaleNote: string;
    rowsRead: number;
    accepted: number;
    belowOne: number;
    unreadable: number;
    stamped: number;
    spanHours: number | null;
    hoursCovered: number;
    tableRows: number;
    truncated: boolean;
    expandedFromList?: boolean;
    jsonPath?: string | null;
    timeNote?: string | null;
  };
  preview: {
    rounds: number;
    median: number;
    mean: number;
    min: number;
    max: number;
    instantCrashes: number;
    rows: PreviewRow[];
    looksLikeCrashTape: boolean;
    verdict: string;
  };
  dryRun: boolean;
  /** Present only when the server chose the table and column itself. */
  auto: {
    table: string;
    column: string;
    timestampColumn: string | null;
    scale: number | null;
    confidence: number;
    why: string;
  } | null;
  note: string;
  inserted?: number;
  total?: number;
  cleared?: number;
  cadence?: { ms: number; measured: boolean; samples: number; note: string };
  hoursCovered?: number;
  phasesTestable?: boolean;
}

/**
 * A candidate that is not a real column: a value read out of a JSON blob, or a
 * row that holds a whole page of rounds. Worth labelling clearly — the user needs
 * to know the terminal is reading inside their data, not just across it.
 */
function DerivedTag({ kind }: { kind: "json" | "list" }) {
  return (
    <span
      className="ml-1 rounded border border-cyan/40 px-1 py-px align-middle text-[9px] uppercase tracking-[0.1em] text-cyan"
      title={
        kind === "json"
          ? "read from inside a JSON column"
          : "one row holds many rounds — expanded in stored order"
      }
    >
      {kind === "json" ? "in json" : "list"}
    </span>
  );
}

const kb = (b: number) =>
  b < 1024 ? `${b} bytes` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;

const SCALES = [
  { value: "auto", label: "auto-detect" },
  { value: "1", label: "as stored (2.34 = 2.34×)" },
  { value: "0.01", label: "hundredths (234 = 2.34×)" },
  { value: "0.001", label: "thousandths (2340 = 2.34×)" },
];

export default function Ingest() {
  const { refresh } = useRounds();

  const [file, setFile] = useState<File | null>(null);
  const [insp, setInsp] = useState<Inspection | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [table, setTable] = useState("");
  const [column, setColumn] = useState("");
  const [tsColumn, setTsColumn] = useState("");
  const [scale, setScale] = useState("auto");
  const [limit, setLimit] = useState("5000");
  const [mode, setMode] = useState("replace");

  const rec = insp?.recommendation ?? null;
  const current = insp?.tables.find((t) => t.table === table) ?? null;
  const chosen = current?.multiplierCandidates.find((c) => c.column === column) ?? null;
  // A list column reads many rounds per row, so the row limit means something
  // different and the label has to say so.
  const listChosen = current?.derivedColumns?.find((d) => d.name === column && d.kind === "list") ?? null;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const onPick = (f: File | null) => {
    setFile(f);
    setInsp(null);
    setResult(null);
    setError(null);
    setFlash(null);
    if (!f) return;
    void run("inspect", async () => {
      const d = await api.upload<Inspection>("/ingest/db/inspect", f);
      setInsp(d);
      const r = d.recommendation;
      const first = d.tables[0];
      setTable(r?.table ?? first?.table ?? "");
      setColumn(r?.column ?? "");
      setTsColumn(r?.timestampColumn ?? "");
      setScale("auto");
      const rows = d.tables.find((t) => t.table === r?.table)?.rows ?? 5000;
      setLimit(String(Math.min(d.limits.maxRows, Math.max(50, rows))));
      setFlash(`Read ${d.tables.length} table${d.tables.length === 1 ? "" : "s"} from ${d.filename}.`);
    });
  };

  const body = () => ({
    uploadId: insp?.uploadId,
    table,
    column,
    timestampColumn: tsColumn || null,
    scale: scale === "auto" ? null : Number(scale),
    limit: Math.max(1, Math.min(insp?.limits.maxRows ?? 20000, Number(limit) || 1)),
    newestFirst: true,
    mode,
  });

  const dryRun = () =>
    run("preview", async () => {
      const d = await api.post<IngestResult>("/ingest/db", { ...body(), dryRun: true });
      setResult(d);
      setFlash(null);
    });

  const commit = () =>
    run("commit", async () => {
      const d = await api.post<IngestResult>("/ingest/db", { ...body(), dryRun: false });
      setResult(d);
      await refresh();
      setInsp(null);
      setFile(null);
      setFlash(`${d.inserted} rounds seeded. Every analysis page now reads this tape.`);
    });

  const onTable = (t: string) => {
    setTable(t);
    setResult(null);
    const info = insp?.tables.find((x) => x.table === t);
    setColumn(info?.multiplierCandidates[0]?.column ?? "");
    setTsColumn(info?.timestampCandidates[0]?.column ?? "");
    setLimit(String(Math.min(insp?.limits.maxRows ?? 20000, Math.max(50, info?.rows ?? 5000))));
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Database ingest"
        kicker="Seed every engine from a real tape — a scraper database, an operator export, your own logger."
      />

      {error ? <ErrorNote error={error} /> : null}
      {flash ? (
        <p className="rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">{flash}</p>
      ) : null}

      <Panel
        title="1 · choose a .db file"
        note="The file is opened read-only and immutable, is never written to, and is deleted after a successful ingest or 30 minutes of inactivity. Nothing leaves this sandbox."
      >
        <div className="space-y-3">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed border-border px-4 py-7 text-center transition-colors hover:border-accent/60">
            <span className="text-xs uppercase tracking-[0.12em] text-accent">
              {busy === "inspect" ? "reading…" : file ? file.name : "select a database"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              .db · .sqlite · .sqlite3 — up to {insp ? kb(insp.limits.maxBytes) : "64 MB"}
            </span>
            <input
              type="file"
              accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/x-sqlite3"
              className="hidden"
              onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            />
          </label>
          {file ? (
            <p className="text-[11px] text-muted-foreground">
              {file.name} · {kb(file.size)}
              {insp ? ` · ${insp.tables.reduce((s, t) => s + t.rows, 0).toLocaleString()} rows across ${insp.tables.length} tables` : ""}
            </p>
          ) : null}
        </div>
      </Panel>

      {insp ? (
        <>
          <Panel title="2 · pick the column" note={insp.note}>
            <div className="space-y-4">
              <div
                className={cn(
                  "rounded border px-3 py-2",
                  rec?.trusted ? "border-accent/30 bg-accent/5" : "border-amber/40 bg-amber/5",
                )}
              >
                <p className="stat-label">{rec?.trusted ? "recommended" : "best guess — check it yourself"}</p>
                <p className="mt-1 text-xs text-foreground">
                  {rec?.table && rec.column ? (
                    <>
                      <span className={rec.trusted ? "text-accent" : "text-amber"}>
                        {rec.table}.{rec.column}
                      </span>{" "}
                      {rec.derived ? <DerivedTag kind={rec.derived} /> : null} — {rec.why}
                    </>
                  ) : (
                    "No column in this file looks like a crash tape. Pick one manually if you disagree."
                  )}
                </p>
                {rec && !rec.trusted ? (
                  <p className="mt-1 text-[11px] text-amber">
                    Below the {rec.confidenceFloor?.toFixed(2) ?? "0.55"} confidence floor, so nothing is
                    pre-selected as safe. Ingesting a column that is not a tape produces confident, wrong
                    numbers on every other page.
                  </p>
                ) : null}
              </div>

              <Grid cols={4}>
                <Field label="table">
                  <Select
                    value={table}
                    onChange={onTable}
                    options={insp.tables.map((t) => ({ value: t.table, label: `${t.table} (${t.rows})` }))}
                  />
                </Field>
                <Field label="multiplier column" hint={chosen?.scaleNote}>
                  <Select
                    value={column}
                    onChange={(v) => {
                      setColumn(v);
                      setResult(null);
                    }}
                    options={(current?.columns ?? []).map((c) => {
                      const cand = current?.multiplierCandidates.find((x) => x.column === c.name);
                      const tag = c.derived === "list" ? " ⋯list" : c.derived === "json" ? " ⋯json" : "";
                      return {
                        value: c.name,
                        label: cand
                          ? `${c.name}${tag} — fit ${cand.score.toFixed(2)}`
                          : `${c.name}${tag} — not numeric`,
                      };
                    })}
                  />
                </Field>
                <Field label="timestamp column" hint="Keeps the real clock, so cadence and the time-of-day test work.">
                  <Select
                    value={tsColumn}
                    onChange={setTsColumn}
                    options={[
                      { value: "", label: "none — space rounds 20s apart" },
                      ...(current?.columns ?? []).filter((c) => !c.derived).map((c) => {
                        const t = current?.timestampCandidates.find((x) => x.column === c.name);
                        return {
                          value: c.name,
                          label: t ? `${c.name} — ${t.spanHours ?? 0}h span` : c.name,
                        };
                      }),
                    ]}
                  />
                </Field>
                <Field label="value scale">
                  <Select value={scale} onChange={setScale} options={SCALES} />
                </Field>
              </Grid>

              {current && current.multiplierCandidates.length ? (
                <Table head={["column", "fit", "numeric", "in range", "median", "max", "distinct", "sorted", "sample"]}>
                  {current.multiplierCandidates.map((c) => (
                    <Row key={c.column} highlight={c.column === column}>
                      <Cell>
                        {c.column} {c.derived ? <DerivedTag kind={c.derived} /> : null}
                      </Cell>
                      <Cell tone={c.score >= 0.7 ? "good" : c.score < 0.4 ? "bad" : undefined}>{c.score.toFixed(2)}</Cell>
                      <Cell>{pct(c.numericShare, 0)}</Cell>
                      <Cell>{pct(c.inRangeShare, 0)}</Cell>
                      <Cell>{num(c.median)}</Cell>
                      <Cell>{num(c.max)}</Cell>
                      <Cell>{c.distinct}</Cell>
                      <Cell tone={c.monotonic ? "bad" : "muted"}>{c.monotonic ? "yes — a counter" : "no"}</Cell>
                      <Cell className="text-muted-foreground">{c.sample.slice(0, 5).join(" ")}</Cell>
                    </Row>
                  ))}
                </Table>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  No numeric column in {table} resembles a multiplier. Try another table.
                </p>
              )}

              {current?.derivedColumns?.length ? (
                <div className="rounded border border-cyan/30 bg-cyan/5 px-3 py-2">
                  <p className="stat-label">read from inside this table</p>
                  <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                    {current.derivedColumns.map((d) => (
                      <li key={d.name}>
                        <span className="text-cyan">{d.name}</span> — {d.note}
                        {d.estimatedRounds
                          ? ` · about ${d.estimatedRounds.toLocaleString()} rounds in total`
                          : ""}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    These are not columns in your database. The terminal reads them out of the text stored
                    there so you do not have to reshape the file — pick one exactly like any other column.
                  </p>
                </div>
              ) : null}

              <Grid cols={3}>
                <Field
                  label={listChosen ? "rows to read" : "rounds to take"}
                  hint={
                    listChosen
                      ? `Newest first. Each row holds about ${listChosen.valuesPerRow ?? "?"} rounds, capped at ${insp.limits.maxRows.toLocaleString()} rounds.`
                      : `Newest first, max ${insp.limits.maxRows.toLocaleString()}.`
                  }
                >
                  <Select
                    value={limit}
                    onChange={setLimit}
                    options={[500, 1000, 3000, 5000, 10000, 20000]
                      .filter((n) => n <= insp.limits.maxRows)
                      .map((n) => ({ value: String(n), label: `${n.toLocaleString()} rounds` }))}
                  />
                </Field>
                <Field label="existing tape" hint="Replace is the honest default — mixing a demo seed into real data corrupts every rate.">
                  <Select
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: "replace", label: "replace the current tape" },
                      { value: "append", label: "append to the current tape" },
                    ]}
                  />
                </Field>
                <div className="flex items-end gap-2">
                  <Btn onClick={dryRun} disabled={!column || busy !== null}>
                    {busy === "preview" ? "checking…" : "preview"}
                  </Btn>
                  <Btn tone="accent" onClick={commit} disabled={!column || busy !== null || !result?.dryRun}>
                    {busy === "commit" ? "seeding…" : "ingest"}
                  </Btn>
                </div>
              </Grid>
              {!result?.dryRun ? (
                <p className="text-[11px] text-muted-foreground">Preview first — ingest unlocks once the extraction has been checked.</p>
              ) : null}
            </div>
          </Panel>
        </>
      ) : null}

      {result ? (
        <Panel
          title={result.dryRun ? "3 · preview — nothing written yet" : "ingested"}
          note={result.note}
          right={<Verdict verdict={result.preview.looksLikeCrashTape ? "consistent" : "suspect"} />}
        >
          <div className="space-y-4">
            {result.auto ? (
              <p className="rounded border border-cyan/40 bg-cyan/5 px-3 py-2 text-[11px] text-cyan">
                Chosen automatically: <span className="text-foreground">{result.auto.table}.{result.auto.column}</span>{" "}
                — {result.auto.why}
              </p>
            ) : null}
            {result.extraction.timeNote ? (
              <p className="rounded border border-amber/40 bg-amber/5 px-3 py-2 text-[11px] text-amber">
                {result.extraction.timeNote}
              </p>
            ) : null}
            <Grid cols={4}>
              <Stat label="rounds extracted" value={result.extraction.accepted.toLocaleString()}
                sub={`of ${result.extraction.tableRows.toLocaleString()} rows in ${result.table}`} />
              <Stat label="median crash" value={`${num(result.preview.median)}×`}
                sub={`fair ≈ 1.94× · max ${num(result.preview.max)}×`} />
              <Stat
                label="clock"
                value={result.extraction.spanHours === null ? "none" : `${num(result.extraction.spanHours, 1)}h`}
                sub={
                  result.extraction.stamped
                    ? `${result.extraction.hoursCovered} clock hours covered`
                    : "no usable timestamps — rounds will be spaced 20s apart"
                }
                tone={result.extraction.stamped ? "default" : "warn"}
              />
              <Stat
                label="discarded"
                value={(result.extraction.belowOne + result.extraction.unreadable).toLocaleString()}
                sub={`${result.extraction.belowOne} below 1.00× · ${result.extraction.unreadable} unreadable`}
                tone={result.extraction.belowOne + result.extraction.unreadable > result.extraction.accepted * 0.1 ? "warn" : "muted"}
              />
            </Grid>

            <p className="text-xs leading-relaxed text-muted-foreground">{result.preview.verdict}</p>

            <Table head={["threshold", "hits", "observed", "fair", "observed ÷ fair", "plausible"]}>
              {result.preview.rows.map((r) => (
                <Row key={r.threshold}>
                  <Cell>≥ {num(r.threshold, r.threshold < 10 ? 1 : 0)}×</Cell>
                  <Cell>{r.hits.toLocaleString()}</Cell>
                  <Cell>{pct(r.rate, 2)}</Cell>
                  <Cell tone="muted">{pct(r.fair, 2)}</Cell>
                  <Cell tone={r.plausible ? undefined : "bad"}>{num(r.ratio)}×</Cell>
                  <Cell tone={r.plausible ? "good" : "bad"}>{r.plausible ? "yes" : "off the curve"}</Cell>
                </Row>
              ))}
            </Table>

            {result.extraction.scaleNote ? (
              <p className="text-[11px] text-muted-foreground">Scale: {result.extraction.scaleNote}.</p>
            ) : null}
            {result.extraction.truncated ? (
              <p className="text-[11px] text-[#ffb020]">
                Took the newest {result.extraction.accepted.toLocaleString()} of {result.extraction.tableRows.toLocaleString()} rows.
                Raise the limit to use more.
              </p>
            ) : null}
            {!result.dryRun && result.cadence ? (
              <Grid cols={3}>
                <Stat
                  label="cadence"
                  value={`${num(result.cadence.ms / 1000, 1)}s`}
                  sub={result.cadence.measured ? `measured from ${result.cadence.samples} gaps` : result.cadence.note}
                  tone={result.cadence.measured ? "good" : "warn"}
                />
                <Stat label="tape size" value={(result.total ?? 0).toLocaleString()}
                  sub={result.cleared ? `${result.cleared.toLocaleString()} previous rounds cleared` : "appended"} />
                <Stat
                  label="time-of-day test"
                  value={result.phasesTestable ? "live" : "not testable"}
                  sub={`${result.hoursCovered ?? 0} clock hours covered`}
                  tone={result.phasesTestable ? "good" : "muted"}
                />
              </Grid>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel title="What this does and does not buy you">
        <ul className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <li>
            <strong className="text-foreground">Real base rates.</strong> Every rate, interval, drought and expected-value
            figure in the app is computed from the loaded tape. Ingesting your own history replaces the demo seed with the
            operator you actually play, at their actual house edge.
          </li>
          <li>
            <strong className="text-foreground">A real clock.</strong> With a timestamp column the cadence is measured
            rather than assumed, so window odds convert rounds into minutes honestly and the hour-of-day test becomes
            testable instead of collapsing into one bucket.
          </li>
          <li>
            <strong className="text-foreground">Not predictive power.</strong> More history makes the estimates tighter,
            not the next round knowable. A provably-fair crash point is drawn from a hash that the tape contains no
            information about. If the fairness and randomness pages say the tape is consistent with fair play, the correct
            forecast for the next round is the base rate, and no amount of ingested data changes that.
          </li>
          <li>
            <strong className="text-foreground">Your schema, not ours.</strong> A multiplier does not need its own
            column. If the round is stored as a JSON blob, the scalar values inside it are offered as
            <span className="text-cyan"> column.path</span> candidates; if one row caches a page of history as a
            list, it is offered as <span className="text-cyan"> column[]</span> and expanded in stored order.
            Integer hundredths, <code>"2.34x"</code> strings and comma decimals are all read. What is never
            invented is a clock: rounds expanded out of a list get no timestamp, because the row's time is the
            time of the page, not of each round inside it.
          </li>
          <li>
            <strong className="text-foreground">Garbage in is worse than nothing.</strong> A stake column or an id column
            ingested as multipliers produces confident, wrong numbers everywhere. That is why the preview scores the column
            against the fair curve before writing, and why sorted columns are flagged as counters.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
