/**
 * Application shell — persistent left menu, live status header, responsible-play
 * banner. Every page renders into the outlet.
 */
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { CommandPalette } from "@/components/CommandPalette";
import { LogoLockup } from "@/components/Logo";
import { colorFor } from "@/components/charts";
import { useRounds } from "@/lib/store";
import { cn } from "@/lib/utils";

export interface NavItem {
  to: string;
  label: string;
  badge?: string;
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Live",
    items: [
      { to: "/", label: "Dashboard" },
      { to: "/feed", label: "Live Feed" },
      { to: "/charts", label: "Chart Lab" },
      { to: "/windows", label: "Window Odds", badge: "new" },
      { to: "/predictor", label: "Predictor" },
      { to: "/studio", label: "Forecast Studio" },
    ],
  },
  {
    title: "Pattern engines",
    items: [
      { to: "/radar", label: "Moon Radar" },
      { to: "/pressure", label: "Mega Pressure" },
      { to: "/autopilot", label: "Autopilot" },
      { to: "/dna", label: "DNA Hunter" },
      { to: "/ladders", label: "Ladders" },
      { to: "/analytics", label: "Analytics" },
    ],
  },
  {
    title: "Reality check",
    items: [
      { to: "/accuracy", label: "Accuracy & Calibration" },
      { to: "/exceedance", label: "Exceedance Grid", badge: "new" },
      { to: "/skill", label: "Skill Ledger", badge: "new" },
      { to: "/phases", label: "Time of Day", badge: "new" },
      { to: "/randomness", label: "Randomness Lab" },
      { to: "/fairness", label: "Fairness Verifier" },
      { to: "/ev", label: "EV Reality Check" },
    ],
  },
  {
    title: "Money",
    items: [
      { to: "/strategy", label: "Strategy Lab" },
      { to: "/bankroll", label: "Bankroll & Sessions" },
      { to: "/alerts", label: "Alerts" },
    ],
  },
  {
    title: "System",
    items: [
      { to: "/ingest", label: "Database Ingest", badge: "new" },
      { to: "/data", label: "Data & Export" },
      { to: "/settings", label: "Settings" },
      { to: "/docs", label: "Engine Reference" },
      { to: "/responsible", label: "Responsible Play" },
    ],
  },
];

function Ticker() {
  const { rounds } = useRounds();
  const tail = rounds.slice(-8).reverse();
  if (tail.length < 2) return null;
  return (
    <div className="relative hidden w-full max-w-xs overflow-x-auto border-x border-border/60 md:block" aria-hidden>
      <div className="flex gap-3 py-0.5">
        {tail.map((r) => (
          <span key={r.id} className="font-mono-num text-xs whitespace-nowrap" style={{ color: colorFor(r.m) }}>
            {r.m.toFixed(2)}×
          </span>
        ))}
      </div>
    </div>
  );
}

function ConnBadge() {
  const { conn, total, liveFeedActive, simulatorRunning } = useRounds();
  const label = conn === "open"
    ? (simulatorRunning ? "live feed · generator" : liveFeedActive ? "live feed · files" : "connected")
    : conn === "connecting" ? "connecting" : "offline";
  const tone =
    conn === "open"
      ? (liveFeedActive || simulatorRunning)
        ? "border-accent/60 text-accent"
        : "border-border text-muted-foreground"
      : conn === "connecting"
        ? "border-[#ffb020]/50 text-[#ffb020]"
        : "border-destructive/50 text-destructive";
  return (
    <div className={cn("flex items-center gap-2 rounded border px-2 py-1 text-[10px] uppercase tracking-[0.16em]", tone)}>
      {conn === "open" && (liveFeedActive || simulatorRunning) ? <span className="live-dot" /> : null}
      <span>{label}</span>
      <span className="font-mono-num text-muted-foreground">{total.toLocaleString()} rds</span>
    </div>
  );
}

function Menu({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-5 pb-10" aria-label="Main">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-1.5 text-[9px] uppercase tracking-[0.24em] text-muted-foreground/70">{section.title}</p>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center justify-between gap-2 rounded px-3 py-1.5 text-[12px] transition-colors",
                      isActive
                        ? "border-l-2 border-accent bg-accent/10 pl-[10px] text-accent"
                        : "border-l-2 border-transparent pl-[10px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                    )
                  }
                >
                  <span>{item.label}</span>
                  {item.badge ? (
                    <span className="rounded-sm border border-accent/40 px-1 text-[8px] uppercase tracking-[0.1em] text-accent">
                      {item.badge}
                    </span>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function ResponsibleBanner() {
  const { settings } = useRounds();
  const [closed, setClosed] = useState(false);
  if (closed || settings?.showResponsibleBanner === false) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#ffb020]/30 bg-[#ffb020]/[0.07] px-4 py-2 text-[11px] leading-relaxed text-[#ffb020]">
      <strong className="font-semibold uppercase tracking-[0.14em]">Analytics only.</strong>
      <span className="text-[#ffb020]/85">
        A correctly implemented crash game is unpredictable, and every stake carries a negative expected value. Nothing
        here is a betting signal.
      </span>
      <NavLink to="/responsible" className="underline underline-offset-2">
        read why
      </NavLink>
      <button onClick={() => setClosed(true)} className="ml-auto text-[#ffb020]/70 hover:text-[#ffb020]" aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { simulatorRunning, setIsLive, settings, error } = useRounds();
  const generatorAllowed = !settings || settings.simulatorEnabled;

  useEffect(() => {
    setMobileOpen(false);
    window.scrollTo({ top: 0 });
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background">
      <ResponsibleBanner />

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur">
        <button
          className="rounded border border-border p-1.5 text-muted-foreground transition-colors hover:text-accent lg:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <div className="lg:hidden">
          <LogoLockup compact />
        </div>
        <Ticker />
        <div className="ml-auto flex items-center gap-2">
          <CommandPalette />
          <ConnBadge />
          <button
            onClick={() => void setIsLive(!simulatorRunning)}
            disabled={!generatorAllowed && !simulatorRunning}
            title={generatorAllowed ? "toggle the provably-fair round generator" : "disabled — enable the generator in Settings; the tape is fed by the file watcher"}
            className={cn(
              "rounded border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] transition-colors",
              !generatorAllowed && !simulatorRunning
                ? "cursor-not-allowed border-border text-muted-foreground/50"
                : simulatorRunning
                  ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                  : "border-accent/60 text-accent hover:bg-accent/10",
            )}
          >
            {simulatorRunning ? "stop generator" : "generator"}
          </button>
        </div>
      </header>

      <div className="flex">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 w-64 shrink-0 overflow-y-auto border-r border-border bg-card px-2 pt-4 transition-transform lg:sticky lg:top-0 lg:z-0 lg:h-screen lg:translate-x-0 lg:bg-card/40",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="mb-5 px-3">
            <LogoLockup />
          </div>
          <Menu onNavigate={() => setMobileOpen(false)} />
          <p className="px-3 pb-6 text-[9px] leading-relaxed text-muted-foreground/60">
            v6 · FastAPI + SQLite · provably-fair verification built in
          </p>
        </aside>

        {mobileOpen ? (
          <button
            className="fixed inset-0 z-30 bg-background/70 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          />
        ) : null}

        <main className="min-w-0 flex-1 px-4 pb-20 pt-6 sm:px-6">
          {error ? (
            <div className="mb-4 rounded border border-destructive/50 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
              Analytics service unreachable: {error}. Start the backend on port 8000 and the terminal will reconnect.
            </div>
          ) : null}
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
