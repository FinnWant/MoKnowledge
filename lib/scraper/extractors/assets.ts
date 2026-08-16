import * as cheerio from "cheerio";
import { evidence, type Evidence, type PageInput, type SiteContext } from "../evidence";
import { newId } from "@/lib/schema";
import { normalizeUrl } from "@/lib/utils/url";

/**
 * Brand assets: logos, colours, and fonts.
 *
 * ROADMAP §2.3 identified two defects in the reference output that live here —
 * `Fonts: var(--font-family), sans-serif` and
 * `var(--e-global-typography-502e136-font-family)`. Both are unresolved CSS
 * custom properties leaking into the knowledge base. Resolving them is the whole
 * job of `resolveCustomProperties` below, and it is why colours and fonts are
 * extracted from the same pass over the same declarations.
 */

/* ------------------------------------------------------------------ logos */

const LOGO_HINT = /logo|brand|wordmark|site-?(title|icon)/i;

export function extractAssets(page: PageInput, site: SiteContext): Evidence[] {
  const $ = cheerio.load(page.html);
  const out: Evidence[] = [];

  if (page.role === "home") {
    for (const logo of findLogos($, page.url)) {
      out.push(evidence("branding.logos", logo, "dom", page, { confidence: 0.75 }));
    }
  }

  const css = collectCss($);
  const variables = collectCustomProperties(css);

  for (const font of extractFonts(css, variables)) {
    out.push(evidence("branding.fonts", font, "dom", page, { confidence: 0.7 }));
  }

  for (const color of extractColors(css, variables)) {
    out.push(
      evidence(
        "branding.colors",
        {
          id: newId(),
          method: "derived" as const,
          confidence: 0.7,
          sourceUrls: [],
          hex: color.hex,
          role: "unknown" as const,
          frequency: color.frequency,
        },
        "dom",
        page,
        { confidence: 0.7 },
      ),
    );
  }

  void site;
  return out;
}

function findLogos($: cheerio.CheerioAPI, pageUrl: string) {
  const logos: Array<ReturnType<typeof toLogo>> = [];
  const seen = new Set<string>();

  const candidates = $(
    'header img, [class*="logo"] img, img[class*="logo"], img[id*="logo"], a[class*="brand"] img',
  );

  candidates.each((_, element) => {
    const image = $(element);
    const src =
      image.attr("src") ??
      image.attr("data-src") ??
      image.attr("data-lazy-src") ??
      image.attr("srcset")?.split(/\s|,/)[0];
    if (!src) return;

    const url = normalizeUrl(src, pageUrl);
    if (!url || seen.has(url)) return;

    const alt = image.attr("alt")?.trim() ?? null;
    const hinted =
      LOGO_HINT.test(src) ||
      LOGO_HINT.test(alt ?? "") ||
      LOGO_HINT.test(image.attr("class") ?? "");
    if (!hinted) return;

    seen.add(url);
    logos.push(toLogo(url, alt, image.attr("width"), image.attr("height")));
  });

  return logos.slice(0, 3);
}

function toLogo(
  url: string,
  alt: string | null,
  width?: string,
  height?: string,
) {
  const toInt = (value?: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  };
  return {
    id: newId(),
    method: "scraped" as const,
    confidence: 0.75,
    sourceUrls: [],
    url,
    alt,
    kind: "logo" as const,
    width: toInt(width),
    height: toInt(height),
  };
}

/* -------------------------------------------------------------------- css */

/**
 * Inline `<style>` blocks and `style=` attributes only.
 *
 * Linked stylesheets are deliberately not fetched: they would double or triple
 * the request count against sites we have committed to touching lightly, for a
 * signal that inline critical CSS — which every modern theme emits — already
 * carries. This is a stated limitation, not an oversight.
 */
function collectCss($: cheerio.CheerioAPI): string {
  const parts: string[] = [];
  $("style").each((_, element) => {
    parts.push($(element).contents().text());
  });
  $("[style]").each((_, element) => {
    const value = $(element).attr("style");
    if (value) parts.push(`x{${value}}`);
  });
  return parts.join("\n");
}

/** `--brand-blue: #0d4f8b` → `{ "--brand-blue": "#0d4f8b" }`. */
export function collectCustomProperties(css: string): Map<string, string> {
  const variables = new Map<string, string>();
  const pattern = /(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(css)) !== null) {
    const name = match[1];
    const value = match[2].trim();
    if (!variables.has(name) && value) variables.set(name, value);
  }
  return variables;
}

/**
 * Substitutes `var(--x)` references, following chains and falling back to the
 * declared default. Returns `null` when a reference can't be resolved, so the
 * caller drops the value instead of publishing `var(--font-family)` — the exact
 * defect visible in two of the eight reference profiles.
 */
export function resolveCustomProperties(
  value: string,
  variables: Map<string, string>,
  depth = 0,
): string | null {
  if (!value.includes("var(")) return value;
  if (depth > 5) return null;

  let unresolved = false;
  const resolved = value.replace(
    /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
    (_, name: string, fallback: string | undefined) => {
      const declared = variables.get(name);
      if (declared !== undefined) return declared;
      if (fallback !== undefined && fallback.trim()) return fallback.trim();
      unresolved = true;
      return "";
    },
  );

  if (unresolved) return null;
  return resolveCustomProperties(resolved, variables, depth + 1);
}

/* ------------------------------------------------------------------ fonts */

/** Generic families and system stacks are not brand fonts. */
const GENERIC_FONTS = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "helvetica",
  "helvetica neue",
  "arial",
  "roboto",
  "noto sans",
  "liberation sans",
  "apple color emoji",
  "segoe ui emoji",
  "segoe ui symbol",
  "noto color emoji",
  "sans",
  "tahoma",
  "verdana",
  "geneva",
  "times",
  "times new roman",
  "georgia",
  "courier",
  "courier new",
  "monaco",
  "consolas",
  "menlo",
  "emoji",
  "math",
  "fangsong",
]);

export function extractFonts(css: string, variables: Map<string, string>): string[] {
  const counts = new Map<string, number>();

  const record = (raw: string) => {
    const resolved = resolveCustomProperties(raw, variables);
    if (resolved === null) return; // unresolvable var() — dropped, not published

    for (const part of resolved.split(",")) {
      const family = part
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/\s+/g, " ");
      if (!family || family.length > 40) continue;
      if (family.includes("var(") || family.startsWith("--")) continue;
      if (GENERIC_FONTS.has(family.toLowerCase())) continue;
      if (!/[A-Za-z]/.test(family)) continue;
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
  };

  for (const match of css.matchAll(/font-family\s*:\s*([^;{}]+)/gi)) record(match[1]);
  for (const match of css.matchAll(/@font-face[^{]*\{[^}]*font-family\s*:\s*([^;}]+)/gi)) {
    record(match[1]);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([family]) => family);
}

/* ----------------------------------------------------------------- colors */

export type ColorCount = { hex: string; frequency: number };

const HEX = /#([0-9a-f]{3}|[0-9a-f]{6})\b/gi;
const RGB = /rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,/]\s*([\d.]+)\s*)?\)/gi;

export function extractColors(css: string, variables: Map<string, string>): ColorCount[] {
  const resolved = resolveDeclarations(css, variables);
  const counts = new Map<string, number>();

  const bump = (hex: string) => counts.set(hex, (counts.get(hex) ?? 0) + 1);

  for (const match of resolved.matchAll(HEX)) bump(expandHex(match[1]));
  for (const match of resolved.matchAll(RGB)) {
    // Nearly transparent colours are effects, not brand colours.
    if (match[4] !== undefined && Number(match[4]) < 0.25) continue;
    bump(rgbToHex(Number(match[1]), Number(match[2]), Number(match[3])));
  }

  return [...counts.entries()]
    .map(([hex, frequency]) => ({ hex, frequency }))
    .filter((color) => !isNearDuplicateOfWhiteOrBlack(color.hex, counts))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 12);
}

/** Expands `var()` in every declaration so referenced colours are counted. */
function resolveDeclarations(css: string, variables: Map<string, string>): string {
  return css.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, (reference) => {
    return resolveCustomProperties(reference, variables) ?? "";
  });
}

function expandHex(digits: string): string {
  const value = digits.toLowerCase();
  return value.length === 3
    ? `#${value[0]}${value[0]}${value[1]}${value[1]}${value[2]}${value[2]}`
    : `#${value}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

/**
 * Themes emit dozens of near-white and near-black shades for borders and
 * shadows. Keeping the most frequent of each cluster and dropping the rest stops
 * a palette from being twelve greys.
 */
function isNearDuplicateOfWhiteOrBlack(hex: string, counts: Map<string, number>): boolean {
  const anchors = ["#ffffff", "#000000"];
  if (anchors.includes(hex)) return false;

  const { r, g, b } = toRgb(hex);
  const isGrey = Math.max(r, g, b) - Math.min(r, g, b) < 12;
  if (!isGrey) return false;

  const nearWhite = r > 243 && g > 243 && b > 243;
  const nearBlack = r < 12 && g < 12 && b < 12;
  if (!nearWhite && !nearBlack) return false;

  const anchor = nearWhite ? "#ffffff" : "#000000";
  return (counts.get(anchor) ?? 0) >= (counts.get(hex) ?? 0);
}

export function toRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}
