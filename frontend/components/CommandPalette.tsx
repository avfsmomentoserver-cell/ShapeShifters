/**
 * Command palette — ⌘K / ctrl-K jumps to any page or runs a terminal action.
 *
 * Merged from the Momento Platform 6.2.0 bundle. Built on a plain dialog rather
 * than cmdk so it keeps the phosphor type and adds nothing to the bundle: the
 * list is the same NAV_SECTIONS the sidebar renders, plus live actions from the
 * round store, so a new page appears here automatically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { NAV_SECTIONS } from "@/components/AppShell";
import { useRounds } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Item {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const { isLive, setIsLive, refresh, resetToSeed, total } = useRounds();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo<Item[]>(() => {
    const pages: Item[] = NAV_SECTIONS.flatMap((s) =>
      s.items.map((i) => ({
        id: `page:${i.to}`,
        label: i.label,
        group: s.title,
        hint: i.to,
        run: () => navigate(i.to),
      })),
    );
    const actions: Item[] = [
      {
        id: "action:feed",
        label: isLive ? "Stop the live feed" : "Start the live feed",
        group: "Actions",
        hint: isLive ? "simulator running" : `${total.toLocaleString()} rounds on the tape`,
        run: () => void setIsLive(!isLive),
      },
      { id: "action:refresh", label: "Refresh the tape", group: "Actions", run: () => void refresh() },
      {
        id: "action:reseed",
        label: "Reseed the workspace with a fresh provably-fair tape",
        group: "Actions",
        hint: "replaces every round",
        run: () => void resetToSeed(),
      },
    ];
    return [...pages, ...actions];
  }, [isLive, navigate, refresh, resetToSeed, setIsLive, total]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    const words = needle.split(/\s+/);
    return items.filter((i) => {
      const hay = `${i.label} ${i.group} ${i.hint ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [items, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      // focus after paint, otherwise the dialog is not yet in the document
      const t = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const choose = useCallback(
    (item: Item | undefined) => {
      if (!item) return;
      setOpen(false);
      item.run();
    },
    [],
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded border border-border px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:border-accent/60 hover:text-accent sm:flex"
        aria-label="Open command palette"
      >
        <span>search</span>
        <kbd className="rounded border border-border/70 px-1 font-mono text-[9px]">⌘K</kbd>
      </button>
    );
  }

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-background/80 px-4 pt-[10vh] backdrop-blur-sm">
      <button className="absolute inset-0 -z-10 cursor-default" onClick={() => setOpen(false)} aria-label="Close command palette" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded border border-accent/40 bg-card shadow-[0_0_40px_rgba(43,217,124,0.08)]"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="text-accent" aria-hidden>
            ›
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => (filtered.length ? (c + 1) % filtered.length : 0));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => (filtered.length ? (c - 1 + filtered.length) % filtered.length : 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(filtered[cursor]);
              }
            }}
            placeholder="jump to a page or run an action…"
            className="w-full bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/70"
            spellCheck={false}
          />
          <kbd className="rounded border border-border/70 px-1 font-mono text-[9px] text-muted-foreground">esc</kbd>
        </div>

        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">nothing matches “{q}”</p>
        ) : (
          <ul ref={listRef} className="max-h-[52vh] overflow-y-auto py-1" role="listbox">
            {filtered.map((item, i) => {
              const header = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <li key={item.id}>
                  {header ? (
                    <p className="px-3 pb-1 pt-2 text-[9px] uppercase tracking-[0.24em] text-muted-foreground/70">{header}</p>
                  ) : null}
                  <button
                    data-active={i === cursor}
                    role="option"
                    aria-selected={i === cursor}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(item)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12px] transition-colors",
                      i === cursor ? "bg-accent/12 text-accent" : "text-foreground hover:bg-foreground/5",
                    )}
                  >
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.hint ? (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.hint}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
          ↑↓ to move · enter to run · ⌘K to close
        </p>
      </div>
    </div>
  );
}
