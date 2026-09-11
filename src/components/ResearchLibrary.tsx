import { useMemo } from "react";
import { BookOpenText, Download, ShieldCheck } from "lucide-react";
import { RESEARCH_DOC } from "@/lib/researchDoc";
import { calculateEta } from "@/lib/analysis";
import { analyzeMoonshots, analyzeStreaks, predictDryZone } from "@/lib/analysis";
import type { Round } from "@/lib/types";

/** Renders the bundled research compendium as long-form prose. */
function renderDoc(doc: string) {
  const blocks = doc.split("\n\n");
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("### "))
      return (
        <h3 key={i} className="mt-6 text-lg font-semibold text-sky-300">
          {trimmed.slice(4)}
        </h3>
      );
    if (trimmed.startsWith("## "))
      return (
        <h2 key={i} className="mt-10 border-b border-slate-700/60 pb-2 text-2xl font-bold text-white">
          {trimmed.slice(3)}
        </h2>
      );
    if (trimmed.startsWith("# "))
      return (
        <h1 key={i} className="mb-1 text-3xl font-bold text-white">
          {trimmed.slice(2)}
        </h1>
      );
    if (trimmed.startsWith("### ")) return null;
    if (trimmed.startsWith("---"))
      return <hr key={i} className="my-8 border-slate-700/40" />;
    if (trimmed.startsWith("> "))
      return (
        <blockquote key={i} className="border-l-4 border-sky-500/50 bg-sky-500/5 px-4 py-3 text-sm italic text-slate-300">
          {trimmed.slice(2)}
        </blockquote>
      );
    if (trimmed.startsWith("|")) {
      const rows = trimmed.split("\n").filter((l) => l.startsWith("|"));
      const parse = (row: string) =>
        row.split("|").slice(1, -1).map((c) => c.trim());
      const header = parse(rows[0]);
      const body = rows.slice(2).map(parse);
      return (
        <div key={i} className="my-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-600 text-slate-300">
                {header.map((h, j) => (
                  <th key={j} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, j) => (
                <tr key={j} className="border-b border-slate-800 text-slate-400">
                  {row.map((c, k) => (
                    <td key={k} className="px-3 py-2">{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return (
      <p key={i} className="text-sm leading-relaxed text-slate-300 whitespace-pre-line">
        {trimmed}
      </p>
    );
  });
}

export default function ResearchLibrary({ rounds }: { rounds: Round[] }) {
  // Live validation readout (§7 of the compendium), recomputed from the feed.
  const validation = useMemo(() => {
    const eta = calculateEta(1, rounds);
    const streaks = analyzeStreaks(rounds);
    const moon = analyzeMoonshots(rounds);
    const dry = predictDryZone(rounds);
    return { eta, streaks, moon, dry };
  }, [rounds]);

  const handleDownloadDoc = () => {
    const blob = new Blob([RESEARCH_DOC], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "RESEARCH.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/20 p-3">
              <BookOpenText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Research Compendium</h3>
              <p className="text-xs text-slate-400">
                Full derivations · proofs · validation methodology · bundled with every source download
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleDownloadDoc} className="btn-secondary flex items-center gap-2 text-sm">
              <Download className="h-4 w-4" />
              RESEARCH.md
            </button>
          </div>
        </div>

        {/* Live validation readout */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="stat-card text-center">
            <p className="mb-1 text-xs text-slate-400">Sample Size (n)</p>
            <p className="text-2xl font-bold text-white">{rounds.length}</p>
          </div>
          <div className="stat-card text-center">
            <p className="mb-1 text-xs text-slate-400">Window σ (volatility)</p>
            <p className="text-2xl font-bold text-yellow-400">
              {validation.eta.stdDev !== undefined ? `±${validation.eta.stdDev}` : "--"}
            </p>
          </div>
          <div className="stat-card text-center">
            <p className="mb-1 text-xs text-slate-400">Runs Detected</p>
            <p className="text-2xl font-bold text-green-400">{validation.streaks.streaks.length}</p>
          </div>
          <div className="stat-card text-center">
            <p className="mb-1 text-xs text-slate-400">Moonshot Clusters</p>
            <p className="text-2xl font-bold text-purple-400">{validation.moon.clusters.length}</p>
          </div>
        </div>

        <div className="mb-8 flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
          <div className="text-sm">
            <p className="font-medium text-emerald-400">Validation status (§7 protocol)</p>
            <p className="text-slate-400">
              Dry-zone confidence: <span className="text-white">{validation.dry.confidence}</span> · ETA
              confidence: <span className="text-white">{validation.eta.confidence}</span> · Moonshot
              clusters: <span className="text-white">{validation.moon.clusters.length}</span> · dry-zone
              probability: <span className="text-white">{validation.dry.probability}%</span>.
              All statistics are pure functions over <code className="font-mono text-xs text-sky-300">src/lib/analysis.ts</code>{" "}
              and ship inside the source bundle for offline recomputation.
            </p>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto pr-2">{renderDoc(RESEARCH_DOC)}</div>
      </div>
    </div>
  );
}
