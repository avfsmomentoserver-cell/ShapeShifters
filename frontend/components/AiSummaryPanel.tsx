/**
 * The overall AI summary — Entrim's read of every metric the two tiers publish.
 *
 * Two things make this safe to render on a betting-adjacent dashboard. First,
 * the whole write-up is computed server-side, so the API key never reaches the
 * browser; this component only ever sees prose and a verdict. Second, the
 * backend audits that prose against the repository's overriding rule and
 * publishes the verdict rather than laundering the text — so if the model ever
 * claims the next round is knowable, the panel says so instead of hiding it.
 */
import { AlertTriangle, Bot, RefreshCw } from "lucide-react";

import { Async, Panel, useApi } from "@/components/kit";
import type { AiSummary } from "@/lib/api";

export function AiSummaryPanel() {
  // Refetch on a schedule: the summary is keyed on the realtime revision
  // server-side, so a moved tape returns a different summary rather than a
  // stale one, and the gateway itself is spared by the server-side cache.
  const query = useApi<AiSummary>("/stats/ai-summary", {
    refetchInterval: 60_000,
  });
  const status = useApi<{ configured: boolean; model: string }>("/stats/ai-status", {
    staleTime: 300_000,
  });

  return (
    <Panel
      title="overall AI summary"
      right={
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <Bot className="h-3.5 w-3.5" />
          {status.data?.model ?? "Entrim"}
        </span>
      }
      note="An AI write-up of the measurements above, describing the past tape and the current distribution. It is not a call to bet and carries no edge — the model is audited for language that claims otherwise."
    >
      <Async query={query} rows={3}>
        {(s) => {
          if (!s.available) {
            // A missing key or a gateway failure is a state, not an error state.
            // The honest thing is to say which, so the reader knows whether to
            // configure something or simply try again.
            return (
              <div className="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                  <p>{s.reason ?? "the summary is unavailable right now"}</p>
                  {!status.data?.configured ? (
                    <p className="text-[11px] text-muted-foreground/80">
                      Set <code className="font-mono-num">ENTRIM_API_KEY</code> in the backend environment (see{" "}
                      <code className="font-mono-num">docs/ai/runbook.md</code>) to enable it.
                    </p>
                  ) : null}
                </div>
              </div>
            );
          }

          const body = s.summary?.body ?? [];
          const watch = s.summary?.watch ?? [];
          const guard = s.guard;

          return (
            <div className="space-y-3">
              <p className="text-sm font-medium leading-snug text-foreground">
                {s.headline ?? s.text ?? "summary"}
              </p>

              {body.length ? (
                <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  {body.map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {watch.length ? (
                <div className="rounded border border-border/60 px-2.5 py-2">
                  <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">what to watch</p>
                  <ul className="space-y-1 text-[11px] text-foreground/80">
                    {watch.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <span>rev {s.revision ?? "—"}</span>
                <span>{s.rounds?.toLocaleString() ?? "—"} rounds</span>
                {s.elapsedMs !== undefined ? <span>{Math.round(s.elapsedMs)} ms</span> : null}
                {s.cached ? (
                  <span className="flex items-center gap-1">
                    <RefreshCw className="h-3 w-3" /> cached
                  </span>
                ) : null}
              </div>

              {guard && !guard.passed ? (
                // Published, not swallowed: the reader is entitled to know the
                // summary tripped the check rather than be handed a laundered
                // version that hides the fact the model tried.
                <div className="rounded border border-destructive/40 bg-destructive/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-destructive">
                  <strong className="uppercase tracking-[0.14em]">copy check failed · </strong>
                  the model used language this project forbids. Treat the text above as unverified.
                  <ul className="mt-1 space-y-0.5">
                    {guard.violations.slice(0, 4).map((v, i) => (
                      <li key={i}>
                        “{v.phrase}” — {v.why}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          );
        }}
      </Async>
    </Panel>
  );
}
