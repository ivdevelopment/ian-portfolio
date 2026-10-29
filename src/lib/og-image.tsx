import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** Same navy/violet language as the site; no effects beyond one soft glow. */
const palette = {
  bg: "#0a0e1b",
  ink: "#f4f1ec",
  muted: "#a6abbf",
  subtle: "#737991",
  accent: "#8f80f8",
  line: "rgba(255,255,255,0.12)",
};

async function loadFonts() {
  const [medium, semibold] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Geist-Medium.ttf")),
    readFile(join(process.cwd(), "assets/fonts/Geist-SemiBold.ttf")),
  ]);
  return [
    { name: "Geist", data: medium, weight: 500 as const, style: "normal" as const },
    { name: "Geist", data: semibold, weight: 600 as const, style: "normal" as const },
  ];
}

/** Initials for the monogram, from the CMS display name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

export type OgCard = {
  /** Small line above the title, e.g. the discipline or project category. */
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Brand/display name from the site settings. */
  brand: string;
  /** Shown bottom-right. */
  footer?: string;
};

export async function renderOgCard(card: OgCard): Promise<ImageResponse> {
  const fonts = await loadFonts();
  const titleSize = card.title.length > 44 ? 64 : card.title.length > 28 ? 76 : 88;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: palette.bg,
          backgroundImage:
            "radial-gradient(circle at 88% 8%, rgba(111,95,240,0.34) 0%, rgba(111,95,240,0) 52%)",
          fontFamily: "Geist",
          color: palette.ink,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 18,
              border: `1.5px solid ${palette.line}`,
              background: "rgba(255,255,255,0.05)",
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {initialsOf(card.brand)}
          </div>
          <div style={{ fontSize: 28, fontWeight: 500, color: palette.muted }}>{card.brand}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 26,
              fontWeight: 500,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: palette.accent,
            }}
          >
            {card.eyebrow}
          </div>
          <div
            style={{
              marginTop: 22,
              fontSize: titleSize,
              fontWeight: 600,
              lineHeight: 1.04,
              letterSpacing: "-0.035em",
              maxWidth: 980,
            }}
          >
            {card.title}
          </div>
          {card.subtitle && (
            <div style={{ marginTop: 26, fontSize: 32, fontWeight: 500, color: palette.muted, maxWidth: 900 }}>
              {card.subtitle}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: `1.5px solid ${palette.line}`,
            paddingTop: 28,
            fontSize: 26,
            fontWeight: 500,
            color: palette.subtle,
          }}
        >
          <div>Web Design &amp; Development</div>
          <div>{card.footer ?? ""}</div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
