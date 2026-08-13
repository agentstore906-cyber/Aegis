import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0c",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#ffffff",
              color: "#0a0a0c",
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            A
          </div>
          <div style={{ display: "flex", color: "#ffffff", fontSize: 48, fontWeight: 600 }}>
            Aegis
          </div>
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 32,
            color: "#a1a1aa",
            fontSize: 30,
            textAlign: "center",
            maxWidth: 900,
          }}
        >
          The Control Plane for AI Agents
        </div>
      </div>
    ),
    { ...size }
  );
}
