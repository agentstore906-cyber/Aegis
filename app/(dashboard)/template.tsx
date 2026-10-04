/** Re-mounts on navigation so each page eases in (a short fade/rise; disabled under prefers-reduced-motion in globals.css). */
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="aegis-enter">{children}</div>;
}
