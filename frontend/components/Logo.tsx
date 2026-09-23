/**
 * Momento mark — a rising curve cut short by a vertical bust line, enclosed in a
 * bracket. One shape, geometric, legible at 20px and 200px, monochrome via
 * currentColor with a single amber accent for the crash point.
 */
export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Momento"
      className={className}
    >
      <path d="M3 3v26" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <path d="M3 29h26" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <path
        d="M5 26C11 25 16.5 20 20 12.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M20 4.5v9" stroke="#ffb020" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="20" cy="12.5" r="2.6" fill="#ffb020" />
    </svg>
  );
}

export function LogoLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={compact ? 24 : 30} className="text-accent glow-green" />
      {!compact && (
        <div className="leading-none">
          <p className="text-[15px] font-bold tracking-[0.22em] text-foreground">MOMENTO</p>
          <p className="mt-1 text-[9px] uppercase tracking-[0.2em] text-muted-foreground">crash analytics terminal</p>
        </div>
      )}
    </div>
  );
}
