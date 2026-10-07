import { cn } from "@/lib/utils";

/**
 * The scanning engine mark: concentric rings around a core. Still by default; the sweep and pulse run only while
 * `active` is true, which the wizard sets for exactly as long as a scan request is in flight. CSS-only.
 */
export function ScannerOrb({ active = false, className }: { active?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={cn("size-24 sm:size-28", className)}>
      <defs>
        <radialGradient id="scanner-orb-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="scanner-orb-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill="url(#scanner-orb-glow)" />
      <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="1 5" strokeLinecap="round" />
      <circle cx="60" cy="60" r="34" fill="none" stroke="var(--border-strong)" strokeWidth="1" />
      {active && <circle cx="60" cy="60" r="20" fill="none" stroke="var(--accent)" strokeWidth="1" className="aegis-ring" />}
      <path d="M60 10 A50 50 0 0 1 110 60" fill="none" stroke="url(#scanner-orb-sweep)" strokeWidth="2" strokeLinecap="round" className={active ? "aegis-sweep" : undefined} style={{ transformBox: "view-box", transformOrigin: "60px 60px" }} />
      <circle cx="60" cy="60" r="12" fill="var(--surface)" stroke="var(--accent)" strokeOpacity="0.7" strokeWidth="1.25" />
      <circle cx="60" cy="60" r="5" fill="var(--accent)" className={active ? "aegis-pulse" : undefined} />
    </svg>
  );
}
