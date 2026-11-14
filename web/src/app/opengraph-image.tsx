import { ImageResponse } from "next/og";

import { site } from "@/config/site";

export const alt = `${site.name} — ${site.description}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share card in the landing palette: near-black field, brand gold accent, no external assets. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background:
            "radial-gradient(ellipse at 30% 20%, #2a241a 0%, #0a0a0a 65%)",
          color: "#ffffff",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 40, letterSpacing: -0.5 }}>
          {site.name}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              fontSize: 96,
              lineHeight: 1,
              fontWeight: 700,
              letterSpacing: -2,
              fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            }}
          >
            Understand deeply.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 36,
              lineHeight: 1.3,
              color: "rgba(255,255,255,0.72)",
              fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
              maxWidth: 980,
            }}
          >
            {site.description}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 28,
            color: "#e9c665",
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#e9c665",
              display: "flex",
            }}
          />
          Ask · Master
        </div>
      </div>
    ),
    size,
  );
}
