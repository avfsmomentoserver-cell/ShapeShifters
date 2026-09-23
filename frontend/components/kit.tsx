/**
 * Terminal UI primitives shared by every page. Keeps the pages declarative and
 * the phosphor design system in one place.
 */
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------

export function useApi<T>(path: string | null, options?: Partial<UseQueryOptions<T>>) {
  return useQuery<T>({
    queryKey: ["api", path],
    queryFn: () => api.get<T>(path as string),
    enabled: path !== null,
    staleTime: 15_000,
    retry: 1,
    ...(options as object),
  });
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export function PageHeader({ title, kicker, children }: { title: string; kicker: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">{kicker}</p>
        <h1 className="mt-1 text-xl font-bold tracking-[0.14em] text-foreground">{title}</h1>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  right,
  children,
  className,
  note,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  note?: string;
}) {
  return (
    <section className={cn("panel", className)}>
      {title ? (
        <div className="panel-header">
          <h2 className="panel-title">{title}</h2>
          {right}
        </div>
      ) : null}
      <div className="min-w-0 p-3.5">{children}</div>
      {note ? (
        <p className="border-t border-border/60 px-3.5 py-2 text-[11px] leading-relaxed text-muted-foreground">{note}</p>
      ) : null}
    </section>
  );
}

export function Grid({ cols = 2, children, className }: { cols?: 1 | 2 | 3 | 4; children: ReactNode; className?: string }) {
  const map = {
    1: "grid-cols-1",
    2: "grid-cols-1 lg:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
  } as const;
  return <div className={cn("grid min-w-0 gap-4", map[cols], className)}>{children}</div>;
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad" | "muted";
}) {
  const tones = {
    default: "text-foreground",
    good: "text-accent",
    warn: "text-[#ffb020]",
    bad: "text-destructive",
    muted: "text-muted-foreground",
  } as const;
  return (
    // overflow-wrap:anywhere rather than break-words: only "anywhere" lowers the
    // element's min-content width, so a long unbroken token (a visitor id, a seed
    // hash) cannot widen the whole grid and push the page into horizontal scroll.
    <div className="min-w-0 rounded border border-border/70 bg-background/40 px-3 py-2.5">
      <p className="stat-label">{label}</p>
      <p
        className={cn(
          "font-mono-num mt-1 text-xl font-semibold leading-tight [overflow-wrap:anywhere]",
          tones[tone],
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function Verdict({ verdict }: { verdict: string }) {
  const v = verdict.toLowerCase();
  const tone =
    v === "consistent" || v === "calibrated"
      ? "border-accent/50 bg-accent/10 text-accent"
      : v === "suspect" || v === "drifting"
        ? "border-[#ffb020]/50 bg-[#ffb020]/10 text-[#ffb020]"
        : v === "reject" || v === "miscalibrated"
          ? "border-destructive/50 bg-destructive/10 text-destructive"
          : "border-border bg-background/50 text-muted-foreground";
  return (
    <span className={cn("rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]", tone)}>
      {verdict}
    </span>
  );
}

// ---------------------------------------------------------------------------
// controls
// ---------------------------------------------------------------------------

export function Btn({
  children,
  onClick,
  tone = "default",
  disabled,
  type = "button",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "default" | "accent" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  const tones = {
    default: "border-border text-foreground hover:border-accent hover:text-accent",
    accent: "border-accent/60 bg-accent/10 text-accent hover:bg-accent/20",
    danger: "border-destructive/50 text-destructive hover:bg-destructive/10",
  } as const;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded border px-3 py-1.5 text-xs uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        tones[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="stat-label block">{label}</span>
      <span className="mt-1 block">{children}</span>
      {hint ? <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  "w-full rounded border border-border bg-background/60 px-2.5 py-1.5 font-mono text-xs text-foreground outline-none transition-colors focus:border-accent";

export function NumInput({
  value,
  onChange,
  step = "any",
  min,
  max,
  placeholder,
}: {
  value: number | string;
  onChange: (v: number) => void;
  step?: string | number;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      className={inputCls}
      value={value}
      step={step}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      className={cn(inputCls, !mono && "font-sans")}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-card">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 rounded border border-border px-2.5 py-2 text-left text-xs transition-colors hover:border-accent/60"
      aria-pressed={on}
    >
      <span className="text-foreground">{label}</span>
      <span
        className={cn(
          "relative h-4 w-8 shrink-0 rounded-full border transition-colors",
          on ? "border-accent bg-accent/30" : "border-border bg-background",
        )}
      >
        <span
          className={cn(
            "absolute top-[1px] h-3 w-3 rounded-full transition-all",
            on ? "left-[17px] bg-accent" : "left-[1px] bg-muted-foreground",
          )}
        />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// states
// ---------------------------------------------------------------------------

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sweep h-8 rounded border border-border/50 bg-background/40" />
      ))}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg =
    error instanceof ApiError
      ? `${error.message} (HTTP ${error.status})`
      : error instanceof Error
        ? error.message
        : "something went wrong";
  return (
    <div className="rounded border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive">
      <p className="font-semibold uppercase tracking-[0.14em]">request failed</p>
      <p className="mt-1 font-mono text-[11px] leading-relaxed">{msg}</p>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        The analytics service must be running on port 8000 for this page to load.
      </p>
      {onRetry ? (
        <span className="mt-2 inline-block">
          <Btn tone="danger" onClick={onRetry}>
            retry
          </Btn>
        </span>
      ) : null}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded border border-dashed border-border px-4 py-8 text-center">
      <p className="text-sm text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export function Async<T>({
  query,
  children,
  rows = 4,
}: {
  query: { data?: T; isLoading: boolean; error: unknown; refetch: () => void };
  children: (data: T) => ReactNode;
  rows?: number;
}) {
  if (query.isLoading) return <Skeleton rows={rows} />;
  if (query.error) return <ErrorNote error={query.error} onRetry={query.refetch} />;
  if (query.data === undefined) return <Empty title="no data" body="The service returned nothing for this view." />;
  return <>{children(query.data)}</>;
}

// ---------------------------------------------------------------------------
// tables
// ---------------------------------------------------------------------------

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="w-full min-w-0 max-w-full overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-border">
            {head.map((h) => (
              <th key={h} className="stat-label px-2 py-1.5 text-left font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono-num">{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children, highlight }: { children: ReactNode; highlight?: boolean }) {
  return (
    <tr
      className={cn(
        "border-b border-border/40 last:border-0 hover:bg-accent/5",
        highlight && "bg-accent/[0.07]",
      )}
    >
      {children}
    </tr>
  );
}

export function Cell({ children, tone, className }: { children: ReactNode; tone?: "good" | "bad" | "muted"; className?: string }) {
  const tones = { good: "text-accent", bad: "text-destructive", muted: "text-muted-foreground" } as const;
  return <td className={cn("px-2 py-1.5", tone && tones[tone], className)}>{children}</td>;
}

/**
 * A probability drawn as a bar with its 95% interval as a lighter band, so the
 * width of the uncertainty is as visible as the point estimate. `reference`
 * draws a tick at the fair-model value for comparison.
 */
export function IntervalBar({
  value,
  low,
  high,
  reference,
  tone = "green",
  label,
}: {
  value: number;
  low?: number;
  high?: number;
  reference?: number | null;
  tone?: "green" | "amber" | "red" | "cyan";
  label?: ReactNode;
}) {
  const tones = {
    green: "var(--phosphor, #2bd97c)",
    amber: "#ffb020",
    red: "#ff4d5e",
    cyan: "#38c7e8",
  } as const;
  const colour = tones[tone];
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const lo = clamp(low ?? value);
  const hi = clamp(high ?? value);
  return (
    <div className="min-w-[120px]">
      {label ? <div className="mb-0.5 text-[10px] text-muted-foreground">{label}</div> : null}
      <div className="relative h-2.5 w-full overflow-hidden rounded-sm border border-border/60 bg-background/60">
        <div
          className="absolute inset-y-0"
          style={{ left: `${lo * 100}%`, width: `${Math.max(hi - lo, 0) * 100}%`, background: colour, opacity: 0.22 }}
          aria-hidden
        />
        <div className="absolute inset-y-0 left-0" style={{ width: `${clamp(value) * 100}%`, background: colour, opacity: 0.55 }} aria-hidden />
        {reference !== undefined && reference !== null ? (
          <div
            className="absolute inset-y-0 w-[2px] bg-foreground/70"
            style={{ left: `calc(${clamp(reference) * 100}% - 1px)` }}
            aria-hidden
          />
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(digits)}%`;
export const num = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits);
export const mult = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toFixed(2)}×`);
export const money = (v: number | null | undefined, currency = "BWP") =>
  v === null || v === undefined ? "—" : `${currency} ${v.toFixed(2)}`;
export const signed = (v: number, digits = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
export const ago = (iso: string | null) => {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

/** Long-form reference with a real, clickable URL — used in page footnotes. */
export function Source({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:decoration-accent"
    >
      {children}
    </a>
  );
}
