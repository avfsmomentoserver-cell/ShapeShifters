import { useState } from "react";
import { Download, CheckCircle2, Loader2, FileArchive } from "lucide-react";
import { downloadSourceBundle, formatBytes, type BundleReport } from "@/lib/sourceBundle";

/**
 * The non-negotiable from the source README: a full source-bundle download
 * button, present on the dashboard at every step, with a live validation
 * readout of exactly what the bundle contains.
 */
export function DownloadSourceButton({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [report, setReport] = useState<BundleReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setStatus("working");
    setError(null);
    try {
      const r = await downloadSourceBundle();
      setReport(r);
      setStatus("done");
      setTimeout(() => setStatus("idle"), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bundle failed");
      setStatus("error");
    }
  };

  const sizeLabel = report ? formatBytes(report.totalBytes) : null;

  return (
    <div className={compact ? "" : "flex flex-col items-end gap-2"}>
      <button
        onClick={handleDownload}
        disabled={status === "working"}
        className="btn-primary relative flex items-center gap-2 overflow-hidden shadow-lg shadow-sky-950/50 bundle-sheen"
      >
        {status === "working" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : status === "done" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : (
          <FileArchive className="h-4 w-4" />
        )}
        <span>
          {status === "working"
            ? "Bundling…"
            : status === "done"
              ? "Downloaded"
              : status === "error"
                ? "Retry bundle"
                : "Download Source"}
        </span>
        <Download className="h-3.5 w-3.5 opacity-70" />
      </button>

      {!compact && report && (
        <div className="flex items-center gap-2 text-xs text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>
            Validated bundle: {report.totalFiles} files · {sizeLabel} · research doc + validation report included
          </span>
        </div>
      )}
      {!compact && error && (
        <div className="text-xs text-red-400">{error}</div>
      )}
      {!compact && !report && status !== "error" && (
        <div className="text-xs text-slate-500">
          Full source + RESEARCH.md + VALIDATION.md, zipped client-side at every step
        </div>
      )}
    </div>
  );
}

export default DownloadSourceButton;
