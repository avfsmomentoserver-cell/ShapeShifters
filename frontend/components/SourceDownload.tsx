/**
 * Source download — serves the packaged repository that ships inside the bundle.
 *
 * scripts/package-source.sh writes the archive into public/ (so Vite copies it
 * into dist/ next to index.html) and, in the same run, writes the manifest below.
 * The size is therefore a build-time fact rather than a runtime measurement:
 * the hosted preview blocks XHR against its own static files, so a HEAD request
 * here fails even though the plain anchor download works fine. The URL is
 * derived from the Vite base rather than hardcoded so the link stays correct
 * when the bundle is served from a sub-path.
 */
import manifest from "@/lib/source-archive.json";

import { Btn, Panel } from "@/components/kit";

const SOURCE_URL = `${import.meta.env.BASE_URL}momento-source.zip`;

function human(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SIZE = human(manifest.bytes);

const CONTENTS: [string, string][] = [
  ["backend/momento/", "api, db, fairness, randomness, survival, ev, strategies, engines, pipeline"],
  ["backend/tests/", "pytest suite — closed-form checks of every crash identity"],
  ["frontend/", "21 pages, AppShell menu, kit primitives, typed api client, store"],
  ["README.md", "how to run both processes, the crash math, and its sources"],
  ["scripts/package-source.sh", "rebuilds this archive"],
];

/** Compact button, for page headers and the dashboard. */
export function SourceDownloadButton({ tone = "default" }: { tone?: "default" | "accent" }) {
  return (
    <a href={SOURCE_URL} download="momento-source.zip" className="inline-flex">
      <Btn tone={tone}>download source · {SIZE}</Btn>
    </a>
  );
}

/** Full panel with a contents manifest, for the Data and Docs pages. */
export function SourceDownloadPanel() {
  return (
    <Panel
      title="source code"
      note="The whole repository: FastAPI backend, React frontend, tests and the packaging script. No node_modules, no database file."
      right={
        <span className="font-mono-num text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {manifest.files} files · {SIZE}
        </span>
      }
    >
      <div className="space-y-3">
        <dl className="space-y-1.5 text-xs">
          {CONTENTS.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <dt className="font-mono-num shrink-0 text-accent sm:w-52">{k}</dt>
              <dd className="min-w-0 text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-3">
          <a href={SOURCE_URL} download="momento-source.zip" className="inline-flex">
            <Btn tone="accent">download momento-source.zip</Btn>
          </a>
          <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            unzip, then read README.md
          </span>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Two processes to run it:{" "}
          <span className="font-mono-num text-accent">uvicorn momento.api:app --port 8000</span> for the backend and{" "}
          <span className="font-mono-num text-accent">npm run dev</span> for the frontend. The frontend falls back to{" "}
          <span className="font-mono-num">http://localhost:8000</span> automatically when no build placeholder is
          substituted, so it works with no configuration. Backend tests:{" "}
          <span className="font-mono-num text-accent">cd backend &amp;&amp; python -m pytest tests -q</span>.
        </p>
      </div>
    </Panel>
  );
}
