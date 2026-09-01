"use client";

import { useEffect } from "react";

/**
 * Catches errors thrown in the root layout itself — the one boundary
 * Next.js renders outside every other layout, so it must ship its own
 * <html>/<body>. Kept dependency-free (no shared UI, no fonts) because the
 * app shell it would import may be exactly what failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({ msg: "global_error", digest: error.digest, error: String(error) })
    );
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          padding: "48px 24px",
          textAlign: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#fafafa",
          color: "#0a0a0a",
        }}
      >
        <h1 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: "14px", color: "#525252", maxWidth: "24rem", margin: 0 }}>
          Aegis hit an unexpected error. Try again — if it keeps happening, contact
          support.
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: "8px",
            height: "36px",
            padding: "0 16px",
            fontSize: "14px",
            fontWeight: 500,
            borderRadius: "6px",
            border: "none",
            background: "#0a0a0a",
            color: "#fafafa",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
