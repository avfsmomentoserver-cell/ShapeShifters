/**
 * Fairness Verifier — the only page in this terminal that produces a provable
 * answer. Given the seeds an operator publishes after a round, the crash point is
 * recomputed locally and compared with what was displayed.
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
  Source,
  Stat,
  Table,
  TextInput,
  Verdict,
  ago,
  mult,
  num,
  pct,
  useApi,
} from "@/components/kit";
import { api, ApiError } from "@/lib/api";

interface Conventions {
  templates: { id: string; pattern: string }[];
  default: string;
  algorithms: string[];
  edgePresets: { id: string; label: string; edge: number; rtp: number }[];
}

interface VerifyResult {
  algorithm: string;
  template?: string;
  message: string;
  digest: string;
  first_4_bytes_hex: string;
  integer: number;
  integer_max: number;
  raw: number;
  house_edge: number;
  instant_crash: boolean;
  crash_point: number;
  server_seed: string;
  client_seed: string;
  nonce: number;
  computed_server_seed_hash: string;
  committed_server_seed_hash: string | null;
  seed_commitment_valid: boolean | null;
  observed: number | null;
  match: boolean | null;
}

interface SolveResult {
  observed: number;
  combinationsTried: number;
  conclusive: boolean;
  note: string;
  matches: { template: string; pattern: string; algorithm: string; house_edge: number; crash_point: number; message: string }[];
}

interface BatchResult {
  rounds: number;
  matches: number;
  mismatches: number;
  audit_passed: boolean;
  results: { nonce: number; expected: number; observed: number; match: boolean }[];
}

interface Audits {
  audits: { id: number; label: string | null; serverSeedHash: string; nonce: number; expected: number; observed: number | null; matched: boolean | null; createdAt: string }[];
  verified: number;
  failed: number;
}

export default function Fairness() {
  const conventions = useApi<Conventions>("/fair/conventions", { staleTime: Infinity });
  const audits = useApi<Audits>("/fair/audits");

  const [serverSeed, setServerSeed] = useState("");
  const [clientSeed, setClientSeed] = useState("");
  const [committedHash, setCommittedHash] = useState("");
  const [nonce, setNonce] = useState(1);
  const [observed, setObserved] = useState(0);
  const [edge, setEdge] = useState(0.03);
  const [algorithm, setAlgorithm] = useState("hmac_sha256");
  const [template, setTemplate] = useState("client:nonce");

  const [result, setResult] = useState<VerifyResult | null>(null);
  const [solved, setSolved] = useState<SolveResult | null>(null);
  const [batch, setBatch] = useState<BatchResult | null>(null);
  const [batchInput, setBatchInput] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (kind: "verify" | "solve" | "batch") => {
    setErr(null);
    setBusy(kind);
    try {
      if (kind === "verify") {
        const res = await api.post<VerifyResult>("/fair/verify", {
          serverSeed,
          clientSeed,
          nonce,
          observed: observed > 0 ? observed : null,
          houseEdge: edge,
          algorithm,
          template,
          serverSeedHash: committedHash || null,
          save: observed > 0,
          label: `nonce ${nonce}`,
        });
        setResult(res);
        setSolved(null);
        void audits.refetch();
      } else if (kind === "solve") {
        setSolved(await api.post<SolveResult>("/fair/solve", { serverSeed, clientSeed, nonce, observed }));
      } else {
        const values = batchInput
          .split(/[\s,;]+/)
          .map(Number)
          .filter((v) => Number.isFinite(v) && v >= 1);
        setBatch(
          await api.post<BatchResult>("/fair/verify-batch", {
            serverSeed,
            clientSeed,
            startNonce: nonce,
            observed: values,
            houseEdge: edge,
            algorithm,
            template,
          }),
        );
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e : e);
    } finally {
      setBusy(null);
    }
  };

  const seedsReady = serverSeed.trim().length > 0;

  return (
    <>
      <PageHeader title="Fairness Verifier" kicker="recompute a round from its seeds — the one provable check">
        <Btn
          onClick={async () => {
            const sv = "momento-demo-server-seed-2f9c41a7b6e5";
            const cl = "momento-demo-client";
            setServerSeed(sv);
            setClientSeed(cl);
            setEdge(0.03);
            setTemplate("client:nonce");
            // pull a real round off the demo tape so the check has something to
            // compare against — a prefill with observed = 0 only ever says
            // "computed", never "matches".
            try {
              const tape = await api.get<{ rounds: { nonce: number; crashPoint: number }[] }>(
                `/fair/tape?serverSeed=${encodeURIComponent(sv)}&clientSeed=${encodeURIComponent(cl)}` +
                  `&count=200&startNonce=1&houseEdge=0.03`,
              );
              const pick = tape.rounds.find((r) => r.crashPoint >= 3) ?? tape.rounds[0];
              setNonce(pick.nonce);
              setObserved(pick.crashPoint);
            } catch {
              setNonce(42);
              setObserved(0);
            }
          }}
        >
          load the demo tape seeds
        </Btn>
      </PageHeader>

      <div className="space-y-4">
        <Panel title="why this page exists">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Every other engine in this terminal describes the past. This one settles a question with a yes or a no: did the
            operator deal the round it committed to? A provably fair crash game publishes the hash of a server seed before
            play, then reveals the seed afterwards. The crash point is{" "}
            <code className="rounded bg-foreground/5 px-1 font-mono text-[11px] text-accent">
              floor(max(1, 2³² / (i + 1) × (1 − h)) × 100) / 100
            </code>{" "}
            where <em>i</em> is the first four bytes of HMAC-SHA256 over the seed pair, as documented by{" "}
            <Source href="https://provenlyfair.com/blog/verify-provably-fair-crash/">ProvenlyFair</Source>. Operators agree
            on the primitive but not on how the message is assembled, so the exact convention is selectable — and the
            solver below can work it out for you from a single known round.
          </p>
        </Panel>

        <Grid cols={2}>
          <Panel title="inputs">
            <div className="space-y-3">
              <Field label="server seed (revealed after the round)">
                <TextInput value={serverSeed} onChange={setServerSeed} placeholder="e.g. 8f14e45fceea167a5a36dedd4bea2543" />
              </Field>
              <Field label="client seed">
                <TextInput value={clientSeed} onChange={setClientSeed} placeholder="your seed, or the operator's public one" />
              </Field>
              <Field label="committed server-seed hash (optional)" hint="Pasting this proves the revealed seed is the one that was committed.">
                <TextInput value={committedHash} onChange={setCommittedHash} placeholder="sha256 published before the round" />
              </Field>
              <Grid cols={2} className="gap-3">
                <Field label="nonce / round number">
                  <NumInput value={nonce} onChange={setNonce} step={1} min={0} />
                </Field>
                <Field label="observed crash point" hint="Leave at 0 to just compute.">
                  <NumInput value={observed} onChange={setObserved} step={0.01} min={0} />
                </Field>
              </Grid>
              <Async query={conventions} rows={2}>
                {(c) => (
                  <Grid cols={2} className="gap-3">
                    <Field label="message template">
                      <Select
                        value={template}
                        onChange={setTemplate}
                        options={c.templates.map((t) => ({ value: t.id, label: `${t.id}  ${t.pattern}` }))}
                      />
                    </Field>
                    <Field label="hash">
                      <Select
                        value={algorithm}
                        onChange={setAlgorithm}
                        options={c.algorithms.map((a) => ({ value: a, label: a }))}
                      />
                    </Field>
                  </Grid>
                )}
              </Async>
              <Field label="house edge used in the derivation">
                <NumInput value={edge} onChange={setEdge} step={0.001} min={0} max={0.2} />
              </Field>
              <div className="flex flex-wrap gap-2 pt-1">
                <Btn tone="accent" onClick={() => void run("verify")} disabled={!seedsReady || busy !== null}>
                  {busy === "verify" ? "computing…" : "verify round"}
                </Btn>
                <Btn onClick={() => void run("solve")} disabled={!seedsReady || observed <= 0 || busy !== null}>
                  {busy === "solve" ? "searching…" : "find the convention"}
                </Btn>
              </div>
              {err ? <ErrorNote error={err} /> : null}
            </div>
          </Panel>

          <Panel
            title="result"
            right={result ? <Verdict verdict={result.match === null ? "computed" : result.match ? "verified" : "mismatch"} /> : undefined}
          >
            {!result ? (
              <Empty
                title="nothing computed yet"
                body="Enter the seeds an operator published for a round and the crash point will be recomputed byte by byte."
              />
            ) : (
              <div className="space-y-3">
                <Grid cols={2} className="gap-2">
                  <Stat
                    label="computed crash point"
                    value={mult(result.crash_point)}
                    tone={result.match === false ? "bad" : "good"}
                    sub={result.instant_crash ? "instant crash" : undefined}
                  />
                  <Stat
                    label="operator displayed"
                    value={result.observed === null ? "—" : mult(result.observed)}
                    tone={result.match === null ? "muted" : result.match ? "good" : "bad"}
                    sub={result.match === null ? "not supplied" : result.match ? "matches to the cent" : "does not match"}
                  />
                </Grid>

                <dl className="space-y-1.5 text-[11px]">
                  <Line label="message hashed" value={result.message} mono />
                  <Line label="digest" value={result.digest} mono break />
                  <Line label="first 4 bytes" value={result.first_4_bytes_hex} mono />
                  <Line
                    label="integer"
                    value={`${result.integer.toLocaleString()} of ${result.integer_max.toLocaleString()}`}
                  />
                  <Line label="raw before flooring" value={num(result.raw, 6)} />
                  <Line label="edge applied" value={pct(result.house_edge)} />
                  <Line label="sha256(server seed)" value={result.computed_server_seed_hash} mono break />
                  {result.committed_server_seed_hash ? (
                    <Line
                      label="commitment check"
                      value={result.seed_commitment_valid ? "the revealed seed hashes to the published commitment" : "the revealed seed does NOT match the commitment"}
                    />
                  ) : null}
                </dl>

                {result.match === false ? (
                  <p className="rounded border border-destructive/50 bg-destructive/5 p-2.5 text-[11px] leading-relaxed text-destructive">
                    A mismatch is not automatically proof of cheating — try a different message template or house edge
                    first, since operators differ. If no convention reproduces the round, the operator cannot support the
                    fairness claim it is making for that round.
                  </p>
                ) : null}
                {result.seed_commitment_valid === false ? (
                  <p className="rounded border border-destructive/50 bg-destructive/5 p-2.5 text-[11px] leading-relaxed text-destructive">
                    The revealed server seed does not hash to the commitment that was published beforehand. That is the
                    one failure a provably fair scheme has no innocent explanation for.
                  </p>
                ) : null}
              </div>
            )}
          </Panel>
        </Grid>

        {solved ? (
          <Panel title="convention solver" right={<Verdict verdict={solved.conclusive ? "conclusive" : solved.matches.length ? "ambiguous" : "no match"} />}>
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              Searched {solved.combinationsTried} combinations of message layout, hash and house edge for one producing{" "}
              {mult(solved.observed)}. {solved.note}
            </p>
            {solved.matches.length === 0 ? (
              <Empty title="no convention reproduced this round" body="Check the seeds and the round number, then try a neighbouring nonce — operators sometimes index from zero." />
            ) : (
              <Table head={["template", "pattern", "hash", "edge", "message"]}>
                {solved.matches.map((m, i) => (
                  <Row key={i}>
                    <Cell tone="good">{m.template}</Cell>
                    <Cell tone="muted">{m.pattern}</Cell>
                    <Cell>{m.algorithm}</Cell>
                    <Cell>{pct(m.house_edge)}</Cell>
                    <Cell tone="muted" className="max-w-[180px] truncate">{m.message}</Cell>
                  </Row>
                ))}
              </Table>
            )}
          </Panel>
        ) : null}

        <Panel
          title="batch audit"
          note="One matching round can be luck. A run of consecutive rounds from the same seed pair either all verify or the claim fails."
        >
          <Field label="observed crash points, starting at the nonce above" hint="Paste a run: 1.24 5.60 1.01 22.40 …">
            <textarea
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              rows={3}
              spellCheck={false}
              className="w-full rounded border border-border bg-background/60 px-2.5 py-2 font-mono text-xs text-foreground outline-none transition-colors focus:border-accent"
              placeholder="1.24, 5.60, 1.01, 22.40"
            />
          </Field>
          <div className="mt-2">
            <Btn tone="accent" onClick={() => void run("batch")} disabled={!seedsReady || busy !== null || batchInput.trim() === ""}>
              {busy === "batch" ? "auditing…" : "run batch audit"}
            </Btn>
          </div>
          {batch ? (
            <div className="mt-3 space-y-2">
              <Grid cols={4} className="gap-2">
                <Stat label="rounds" value={batch.rounds} />
                <Stat label="matched" value={batch.matches} tone="good" />
                <Stat label="mismatched" value={batch.mismatches} tone={batch.mismatches ? "bad" : "muted"} />
                <Stat
                  label="audit"
                  value={batch.audit_passed ? "passed" : "failed"}
                  tone={batch.audit_passed ? "good" : "bad"}
                />
              </Grid>
              <Table head={["nonce", "expected", "observed", "match"]}>
                {batch.results.map((r) => (
                  <Row key={r.nonce}>
                    <Cell tone="muted">{r.nonce}</Cell>
                    <Cell>{mult(r.expected)}</Cell>
                    <Cell>{mult(r.observed)}</Cell>
                    <Cell tone={r.match ? "good" : "bad"}>{r.match ? "yes" : "no"}</Cell>
                  </Row>
                ))}
              </Table>
            </div>
          ) : null}
        </Panel>

        <Panel title="saved audit trail" right={<Async query={audits} rows={1}>{(a) => <span className="font-mono-num text-[11px] text-muted-foreground">{a.verified} verified · {a.failed} failed</span>}</Async>}>
          <Async query={audits} rows={3}>
            {(a) =>
              a.audits.length === 0 ? (
                <Empty title="no audits saved yet" body="Verifying a round with an observed crash point files it here permanently." />
              ) : (
                <Table head={["label", "nonce", "expected", "observed", "result", "when"]}>
                  {[...a.audits].reverse().map((row) => (
                    <Row key={row.id}>
                      <Cell tone="muted">{row.label ?? "—"}</Cell>
                      <Cell>{row.nonce}</Cell>
                      <Cell>{mult(row.expected)}</Cell>
                      <Cell>{row.observed === null ? "—" : mult(row.observed)}</Cell>
                      <Cell tone={row.matched ? "good" : row.matched === false ? "bad" : "muted"}>
                        {row.matched === null ? "computed" : row.matched ? "verified" : "mismatch"}
                      </Cell>
                      <Cell tone="muted">{ago(row.createdAt)}</Cell>
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

function Line({ label, value, mono, break: brk }: { label: string; value: string; mono?: boolean; break?: boolean }) {
  return (
    <div className={brk ? "" : "flex items-baseline justify-between gap-3"}>
      <dt className="stat-label shrink-0">{label}</dt>
      <dd className={`${mono ? "font-mono" : ""} ${brk ? "mt-0.5 break-all" : "truncate text-right"} text-[11px] text-foreground`}>
        {value}
      </dd>
    </div>
  );
}
