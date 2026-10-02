"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary. Replaces the entire document, so it must render its
 * own `<html>`/`<body>` and cannot rely on the root layout, fonts, or Tailwind
 * classes injected by the layout pipeline — styles are inlined deliberately.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          color: "#e4e4e7",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            maxWidth: "34rem",
            width: "100%",
            border: "1px solid rgba(239,68,68,0.4)",
            borderRadius: "0.5rem",
            padding: "2.5rem",
            textAlign: "center",
            boxShadow: "0 0 70px -18px rgba(239,68,68,0.5)",
            background:
              "linear-gradient(145deg, rgba(24,24,27,0.9), rgba(9,9,11,0.95))",
          }}
        >
          <p
            style={{
              fontSize: "0.625rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#ef4444",
              margin: 0,
            }}
          >
            Critical failure
          </p>

          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 800,
              margin: "1rem 0 0",
              color: "#ffffff",
            }}
          >
            The application could not start
          </h1>

          <p
            style={{
              marginTop: "1rem",
              fontSize: "0.875rem",
              lineHeight: 1.65,
              color: "#a1a1aa",
            }}
          >
            The root layout failed to render. This normally means the database
            is unreachable or required environment variables are missing.
          </p>

          <pre
            style={{
              marginTop: "1.5rem",
              padding: "1rem",
              textAlign: "left",
              fontSize: "0.6875rem",
              lineHeight: 1.6,
              color: "#fca5a5",
              background: "rgba(0,0,0,0.6)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: "0.375rem",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {error.message || "Unknown error"}
            {error.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.75rem",
              padding: "0.75rem 1.75rem",
              fontSize: "0.6875rem",
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#ffffff",
              backgroundColor: "#dc2626",
              border: "1px solid rgba(248,113,113,0.5)",
              borderRadius: "0.25rem",
              cursor: "pointer",
              boxShadow: "0 0 20px rgba(239,68,68,0.5)",
            }}
          >
            Retry boot
          </button>
        </div>
      </body>
    </html>
  );
}
