import { ImageResponse } from "next/og";

import { getPublicScorecardBySlug } from "@/lib/arena/queries";
import { topCategories } from "@/lib/arena/share";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Aegis Agent Arena scorecard";

export default async function ScorecardOgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const card = await getPublicScorecardBySlug(slug);

  const score = card?.overallScore ?? 0;
  const name = card?.displayName ?? "Anonymous Agent";
  const tops = card ? topCategories(card.categoryScores, 3) : [];
  const accent = score >= 800 ? "#22c55e" : score >= 520 ? "#eab308" : "#ef4444";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0c",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", color: "#a1a1aa", fontSize: 26, letterSpacing: 6, fontWeight: 600 }}>
          AEGIS AGENT ARENA
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
            <span style={{ color: accent, fontSize: 140, fontWeight: 700 }}>{score}</span>
            <span style={{ color: "#71717a", fontSize: 52 }}>/ 1000</span>
          </div>
          <div style={{ display: "flex", color: "#ffffff", fontSize: 44, fontWeight: 600, marginTop: 8 }}>
            {name}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", gap: 16 }}>
            {tops.map((t) => (
              <div
                key={t.category}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  padding: "12px 20px",
                  background: "#18181b",
                  borderRadius: 12,
                }}
              >
                <span style={{ color: "#a1a1aa", fontSize: 20 }}>{t.label}</span>
                <span style={{ color: "#ffffff", fontSize: 32, fontWeight: 700 }}>{t.score}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", color: "#ffffff", fontSize: 30, fontWeight: 600 }}>
            Can your Agent beat {score}?
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
