import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PageRole } from "@/lib/schema";

/**
 * Reads the committed HTML snapshots of the golden sites.
 *
 * Every scraper test runs through here rather than over the network. The
 * fixtures are captured once by `npm run snapshot` and never re-fetched — see
 * docs/VALIDATION.md §5 — which keeps the suite deterministic, fast, and off the
 * websites of eight real small businesses.
 */

const SITES_ROOT = fileURLToPath(new URL("./sites", import.meta.url));

export type FixturePage = {
  file: string;
  url: string;
  role: PageRole;
  status: number;
  bytes: number;
  fetchedAt: string;
};

export type FixtureManifest = {
  slug: string;
  name: string;
  url: string;
  capturedAt: string;
  durationMs: number;
  pagesDiscovered: number;
  pages: FixturePage[];
  warnings: Array<{ code: string; message: string; url: string | null }>;
};

export function loadManifest(slug: string): FixtureManifest {
  const file = path.join(SITES_ROOT, slug, "manifest.json");
  return JSON.parse(readFileSync(file, "utf8")) as FixtureManifest;
}

/** The HTML of one snapshotted page, decompressed. */
export function loadPageHtml(slug: string, file: string): string {
  const full = path.join(SITES_ROOT, slug, file);
  return file.endsWith(".gz")
    ? gunzipSync(readFileSync(full)).toString("utf8")
    : readFileSync(full, "utf8");
}

export type LoadedPage = FixturePage & { html: string };

/** Every page of a site, ready to run extractors over. */
export function loadSite(slug: string): {
  manifest: FixtureManifest;
  pages: LoadedPage[];
} {
  const manifest = loadManifest(slug);
  return {
    manifest,
    pages: manifest.pages.map((page) => ({
      ...page,
      html: loadPageHtml(slug, page.file),
    })),
  };
}

/** The first page with the given role, which is usually the one worth testing. */
export function loadPageByRole(slug: string, role: PageRole): LoadedPage | null {
  const manifest = loadManifest(slug);
  const page = manifest.pages.find((candidate) => candidate.role === role);
  return page ? { ...page, html: loadPageHtml(slug, page.file) } : null;
}

/**
 * Slugs that actually have fixtures on disk.
 *
 * Read from the filesystem rather than from `GOLDEN_SITES`, because the two can
 * legitimately differ: a golden site whose domain has gone down since the
 * reference PDF was generated has no fixtures, and tests should skip it rather
 * than fail. See docs/VALIDATION.md §1.
 */
export function capturedSlugs(): string[] {
  return readdirSync(SITES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
