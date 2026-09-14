import { useRef } from "react";
import { CheckCircle2, FolderOpen, Loader2, RefreshCw, Upload, XCircle } from "lucide-react";
import { useLiveRounds } from "@/hooks/useLiveRounds";

type LiveFeed = ReturnType<typeof useLiveRounds>;

export function LiveFeedReceiver({ feed }: { feed: LiveFeed }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const statusLabel = feed.status === "watching" ? "Watching folder" : feed.status === "imported" ? "Receiving rounds" : "Waiting for collector files";
  const supportsFolderWatch = "showDirectoryPicker" in window;

  return (
    <div className="card flex flex-wrap items-center justify-between gap-4 border-sky-500/30 bg-slate-800/80 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {feed.status === "error" ? (
          <XCircle className="h-5 w-5 shrink-0 text-red-400" />
        ) : feed.status === "watching" || feed.status === "imported" ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
        ) : (
          <Loader2 className="h-5 w-5 shrink-0 text-amber-400" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Live round receiver</p>
          <p className="truncate text-xs text-slate-400">
            {statusLabel} · {feed.rounds.length} rounds{feed.lastFile ? ` · ${feed.lastFile}` : ""}
          </p>
          {feed.error && <p className="mt-1 text-xs text-red-300">{feed.error}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            if (supportsFolderWatch) void feed.chooseFolder();
            else inputRef.current?.click();
          }}
          className="btn-primary flex items-center gap-2"
        >
          <FolderOpen className="h-4 w-4" />
          {supportsFolderWatch ? "Watch Downloads" : "Choose Downloads JSON"}
        </button>
        <button onClick={() => inputRef.current?.click()} className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-600">
          <Upload className="mr-2 inline h-4 w-4" />
          Import JSON
        </button>
        <button onClick={feed.clearRounds} className="rounded-lg bg-slate-700 p-2 text-slate-300 hover:bg-slate-600" title="Clear live rounds">
          <RefreshCw className="h-4 w-4" />
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          multiple
          onChange={(event) => {
            if (event.target.files) void feed.importFiles(event.target.files);
            event.currentTarget.value = "";
          }}
          className="hidden"
          {...({ webkitdirectory: "" } as Record<string, string>)}
        />
      </div>
    </div>
  );
}

export default LiveFeedReceiver;