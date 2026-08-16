import type { BrandColor } from "@/lib/schema";
import { toRgb } from "../extractors/assets";

/**
 * Assigns each brand colour the role it plays.
 *
 * ROADMAP §2.3: the reference output returns three flat hex values. A content
 * generator can't use that — it needs to know which colour is the page
 * background and which is the accent it should put a button in. Frequency plus
 * lightness and saturation is enough to work that out without rendering the page.
 */

type Analyzed = BrandColor & { lightness: number; saturation: number; chroma: number };

export function assignColorRoles(colors: BrandColor[]): BrandColor[] {
  if (colors.length === 0) return [];

  const analyzed: Analyzed[] = colors.map((color) => {
    const { lightness, saturation, chroma } = hsl(color.hex);
    return { ...color, lightness, saturation, chroma };
  });

  const byFrequency = [...analyzed].sort((a, b) => b.frequency - a.frequency);
  const assigned = new Map<string, BrandColor["role"]>();

  // Background: the most-used near-white or near-black. Sites are overwhelmingly
  // one or the other, and whichever it is dominates the declaration count.
  // Chroma, not HSL saturation: `#111827` — the near-black every Tailwind site
  // uses for body text — has a saturation of 0.39 because the denominator
  // collapses at the ends of the lightness range, and would fail a saturation
  // test while being visibly grey.
  const background = byFrequency.find(
    (color) => color.chroma < 0.12 && (color.lightness > 0.9 || color.lightness < 0.12),
  );
  if (background) assigned.set(background.hex, "background");

  // Text: the opposite extreme, unsaturated.
  const text = byFrequency.find(
    (color) =>
      !assigned.has(color.hex) &&
      color.chroma < 0.15 &&
      (background
        ? background.lightness > 0.5
          ? color.lightness < 0.35
          : color.lightness > 0.7
        : color.lightness < 0.35),
  );
  if (text) assigned.set(text.hex, "text");

  // Primary: the most-used colour that is actually a colour.
  const chromatic = byFrequency.filter(
    (color) => !assigned.has(color.hex) && color.saturation >= 0.25 && color.lightness > 0.12 && color.lightness < 0.9,
  );
  if (chromatic[0]) assigned.set(chromatic[0].hex, "primary");
  if (chromatic[1]) assigned.set(chromatic[1].hex, "secondary");
  // Accent is the most saturated remaining colour, not the next most frequent —
  // an accent is by definition used sparingly, so frequency would never find it.
  const accent = [...chromatic.slice(2)].sort((a, b) => b.saturation - a.saturation)[0];
  if (accent) assigned.set(accent.hex, "accent");

  // Remaining greys are borders and surfaces.
  for (const color of byFrequency) {
    if (assigned.has(color.hex)) continue;
    assigned.set(
      color.hex,
      color.chroma < 0.15 && color.lightness > 0.5 ? "border" : "unknown",
    );
  }

  // Lightness, saturation, and chroma are working values; `BrandColor` is what
  // the schema stores, so they are rebuilt out rather than spread through.
  return byFrequency.map((analyzed) => ({
    id: analyzed.id,
    method: analyzed.method,
    confidence: analyzed.confidence,
    sourceUrls: analyzed.sourceUrls,
    hex: analyzed.hex,
    frequency: analyzed.frequency,
    role: assigned.get(analyzed.hex) ?? "unknown",
    ...(analyzed.note !== undefined ? { note: analyzed.note } : {}),
  }));
}

/** Lightness and saturation in HSL terms, 0–1. */
export function hsl(hex: string): {
  lightness: number;
  saturation: number;
  /** max−min channel distance, 0–1: how far the colour is from grey. */
  chroma: number;
} {
  const { r, g, b } = toRgb(hex);
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  const saturation =
    delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1) || 1);

  return { lightness, saturation: Math.min(1, saturation), chroma: delta };
}

/** WCAG relative luminance, used for the contrast check below. */
function luminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}
