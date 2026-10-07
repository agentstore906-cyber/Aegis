import { cn } from "@/lib/utils";

export type CoreNodeTone = "safe" | "warning" | "blocked" | "neutral";
export type CoreNode = {
  id: string;
  name: string;
  tone: CoreNodeTone;
  /** The backend says this agent's authenticated connection exists. Draws a solid line. */
  connected: boolean;
  /** The backend says reported events are arriving for this agent. The ONLY thing that animates its line. */
  receiving: boolean;
};

const W = 640;
const H = 300;
const CX = W / 2;
const CY = H / 2;
const RX = 238;
const RY = 100;
const MAX_NODES = 8;

const STROKE: Record<CoreNodeTone, string> = {
  safe: "var(--success)",
  warning: "var(--warning)",
  blocked: "var(--danger)",
  neutral: "var(--muted-foreground)",
};

const r1 = (n: number) => Math.round(n * 10) / 10;

function angles(n: number): number[] {
  if (n === 1) return [180];
  if (n === 2) return [180, 0];
  return Array.from({ length: n }, (_, i) => 180 + (i * 360) / n);
}

const clip = (s: string, max = 18) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * The Aegis security layer: a core with the connected agents around it. Agent → Aegis → policy and risk.
 *
 * Honest by construction — every visual property comes from a flag the backend produced:
 *   • a node exists only for a real agent; its color is its real connection state
 *   • a line is SOLID only when a credentialed connection really exists, DASHED when it does not
 *   • a line FLOWS only while reported events are really arriving; the core pulses only if any line flows
 * With no live activity the core is still, and the caption says so ("Waiting for activity"). Nothing is simulated.
 * Pure SVG + CSS animation: no canvas, no WebGL, no JS. At most 8 agents are drawn; the rest are counted in text.
 */
export function AegisCore({ nodes, total, summary, className }: { nodes: CoreNode[]; total: number; /** Organization-wide counts when `nodes` is only a page of the agents. Defaults to counting `nodes`. */ summary?: { connected: number; receiving: number } | null; className?: string }) {
  const shown = nodes.slice(0, MAX_NODES);
  const receiving = summary ? summary.receiving : nodes.filter((n) => n.receiving).length;
  const connected = summary ? summary.connected : nodes.filter((n) => n.connected).length;
  const pts = angles(shown.length).map((deg) => {
    const a = (deg * Math.PI) / 180;
    return { x: r1(CX + RX * Math.cos(a)), y: r1(CY + RY * Math.sin(a)) };
  });

  const caption =
    total === 0
      ? "No agents connected yet"
      : receiving > 0
        ? `Receiving activity from ${receiving} of ${total} ${total === 1 ? "agent" : "agents"}`
        : connected > 0
          ? "Connected · no activity reported yet"
          : "No agent is connected right now";

  return (
    <figure className={cn("relative mx-auto w-full max-w-3xl", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Aegis core with ${total} ${total === 1 ? "agent" : "agents"}. ${caption}.`}
        className="h-auto w-full overflow-visible"
      >
        <defs>
          <radialGradient id="aegis-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Connections first, so nodes and the core sit on top. */}
        {shown.map((n, i) => {
          const p = pts[i]!;
          return (
            <line
              key={n.id}
              x1={CX}
              y1={CY}
              x2={p.x}
              y2={p.y}
              stroke={n.connected ? STROKE[n.tone] : "var(--border-strong)"}
              strokeWidth={n.connected ? 1.25 : 1}
              strokeOpacity={n.receiving ? 0.85 : n.connected ? 0.4 : 0.7}
              strokeDasharray={n.connected ? undefined : "2 6"}
              strokeLinecap="round"
              className={n.receiving ? "aegis-flow" : undefined}
            />
          );
        })}

        {/* Core */}
        <circle cx={CX} cy={CY} r="86" fill="url(#aegis-core-glow)" />
        <circle cx={CX} cy={CY} r="58" fill="none" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="1 5" strokeLinecap="round" />
        {receiving > 0 && <circle cx={CX} cy={CY} r="34" fill="none" stroke="var(--accent)" strokeWidth="1" className="aegis-ring" />}
        <circle cx={CX} cy={CY} r="40" fill="var(--surface)" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="1.25" />
        <path d={`M ${CX} ${CY - 40} A 40 40 0 0 1 ${CX + 40} ${CY}`} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" className={receiving > 0 ? "aegis-sweep" : undefined} style={{ transformBox: "view-box", transformOrigin: `${CX}px ${CY}px` }} />
        <circle cx={CX} cy={CY} r="9" fill="var(--accent)" className={receiving > 0 ? "aegis-pulse" : undefined} fillOpacity={receiving > 0 ? 1 : 0.7} />
        <circle cx={CX} cy={CY} r="3.5" fill="var(--background)" />
        <text x={CX} y={CY + 70} textAnchor="middle" fill="var(--muted-foreground)" fontSize="10" letterSpacing="3" fontWeight="600">
          AEGIS CORE
        </text>

        {/* Agents */}
        {shown.map((n, i) => {
          const p = pts[i]!;
          const onLeft = p.x < CX - 4;
          const onRight = p.x > CX + 4;
          const anchor = onLeft ? "end" : onRight ? "start" : "middle";
          const dx = onLeft ? -16 : onRight ? 16 : 0;
          const dy = onLeft || onRight ? 4 : p.y < CY ? -16 : 24;
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r="11" fill="var(--surface)" stroke={STROKE[n.tone]} strokeWidth="1.5" />
              <circle cx={p.x} cy={p.y} r="4" fill={STROKE[n.tone]} className={n.receiving ? "aegis-pulse" : undefined} />
              <text x={p.x + dx} y={p.y + dy} textAnchor={anchor} fill="var(--foreground)" fontSize="12" fontWeight="500" className="max-sm:hidden">
                {clip(n.name)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 text-center">
        <p className="aegis-eyebrow">Agents · Aegis · Policy &amp; risk</p>
        <p className="mt-1.5 text-sm text-muted-foreground" role="status">
          {caption}
          {total > shown.length && ` · showing ${shown.length} of ${total}`}
        </p>
      </figcaption>
    </figure>
  );
}
