import { cn } from "@/lib/utils";

export function LogoMark({
  className,
  inverted,
}: {
  className?: string;
  inverted?: boolean;
}) {
  const badge = inverted ? "var(--background)" : "var(--foreground)";
  const glyph = inverted ? "var(--foreground)" : "var(--background)";

  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <rect x="1" y="1" width="26" height="26" rx="7" fill={badge} />
      <path
        d="M9 20V13.5C9 10.46 11.24 8 14 8C16.76 8 19 10.46 19 13.5V20"
        stroke={glyph}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 8V20" stroke={glyph} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={cn("size-6", markClassName)} />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">Aegis</span>
    </span>
  );
}
