import { ImageResponse } from "next/og";

import { LEVEL_LABEL } from "@/lib/scanner/engine";
import { getPublicReportBySlug } from "@/lib/scanner/service";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Aegis AI agent risk scan";

const ACCENT = { low: "#22c55e", moderate: "#eab308", high: "#f97316", critical: "#ef4444" } as const;

export default async function ReportOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const report = await getPublicReportBySlug(slug);
  const score = report?.score ?? 0;
  const accent = report ? ACCENT[report.level] : "#a1a1aa";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0a0a0c", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", color: "#a1a1aa", fontSize: 26, letterSpacing: 6, fontWeight: 600 }}>AEGIS · AI AGENT RISK SCAN</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
            <span style={{ color: accent, fontSize: 150, fontWeight: 700 }}>{score}</span>
            <span style={{ color: "#71717a", fontSize: 52 }}>/ 100</span>
          </div>
          <div style={{ display: "flex", color: "#ffffff", fontSize: 44, fontWeight: 600, marginTop: 8 }}>
            {report ? `${LEVEL_LABEL[report.level]} risk · ${report.counts.high} high-risk ${report.counts.high === 1 ? "behavior" : "behaviors"}` : "Report unavailable"}
          </div>
        </div>
        <div style={{ display: "flex", color: "#ffffff", fontSize: 30, fontWeight: 600 }}>My AI Agent Security Score — scan yours free</div>
      </div>
    ),
    { ...size }
  );
}
