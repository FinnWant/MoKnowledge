/**
 * Captures HTML fixtures for the golden sites.
 *
 *   npm run snapshot -- bee-cave-drilling
 *   npm run snapshot -- all
 *   npm run snapshot -- all --force      # re-capture sites already on disk
 *
 * This is the only code in the project that touches a live website outside a
 * user-initiated scrape. It is a **manual, one-time** step: tests and CI read the
 * committed fixtures and never hit the network (docs/VALIDATION.md §5). Re-running
 * it against a site that already has fixtures is refused unless `--force` is
 * passed, so an accidental `npm run snapshot -- all` costs nobody any bandwidth.
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { crawlSite, type CrawlProgressEvent } from "../lib/scraper/crawler";
import { pageSlug } from "../lib/utils/url";
import { GOLDEN_SITES, goldenSite, type GoldenSite } from "../tests/golden/sites";

const FIXTURE_ROOT = path.join(process.cwd(), "tests", "fixtures", "sites");
/** Gap between sites, on top of the per-request rate limit. Be a good guest. */
const BETWEEN_SITES_MS = 3000;

type Manifest = {
  slug: string;
  name: string;
  url: string;
  capturedAt: string;
  durationMs: number;
  pagesDiscovered: number;
  pages: Array<{
    file: string;
    url: string;
    role: string;
    status: number;
    bytes: number;
    fetchedAt: string;
  }>;
  warnings: Array<{ code: string; message: string; url: string | null }>;
};

async function snapshotSite(site: GoldenSite, force: boolean): Promise<void> {
  const dir = path.join(FIXTURE_ROOT, site.slug);

  if (existsSync(dir) && !force) {
    const files = await readdir(dir);
    console.log(
      `  ${site.slug}: already captured (${files.length} files). Pass --force to re-crawl.`,
    );
    return;
  }

  console.log(`\n▸ ${site.name} — ${site.url}`);
  console.log(`  ${site.testsFor}`);

  const result = await crawlSite(site.url, {
    onProgress: logProgress,
  });

  if (result.pages.length === 0) {
    console.error(`  ✗ no pages captured`);
    for (const warning of result.warnings) {
      console.error(`    ${warning.code}: ${warning.message}`);
    }
    return;
  }

  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const manifest: Manifest = {
    slug: site.slug,
    name: site.name,
    url: site.url,
    capturedAt: result.finishedAt,
    durationMs: result.durationMs,
    pagesDiscovered: result.pagesDiscovered,
    pages: [],
    warnings: result.warnings,
  };

  const usedNames = new Set<string>();
  for (const page of result.pages) {
    // Gzipped: the raw HTML for all eight sites is ~36 MB and compresses to
    // ~5 MB. These are committed so tests never touch the network, and a
    // 36 MB checkout to run a test suite is not a reasonable thing to ask.
    let file = `${pageSlug(page.url)}.html.gz`;
    let suffix = 2;
    while (usedNames.has(file)) file = `${pageSlug(page.url)}-${suffix++}.html.gz`;
    usedNames.add(file);

    await writeFile(path.join(dir, file), gzipSync(page.html, { level: 9 }));
    manifest.pages.push({
      file,
      url: page.url,
      role: page.role,
      status: page.status,
      bytes: page.bytes,
      fetchedAt: page.fetchedAt,
    });
  }

  await writeFile(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const roles = manifest.pages.reduce<Record<string, number>>((acc, page) => {
    acc[page.role] = (acc[page.role] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    `  ✓ ${manifest.pages.length} pages in ${(result.durationMs / 1000).toFixed(1)}s — ` +
      Object.entries(roles)
        .sort((a, b) => b[1] - a[1])
        .map(([role, count]) => `${role}:${count}`)
        .join(" "),
  );
  for (const warning of result.warnings) {
    console.log(`    ! ${warning.code}: ${warning.message}`);
  }
}

function logProgress(event: CrawlProgressEvent): void {
  if (event.type === "robots") {
    console.log(
      `  robots.txt ${event.found ? "found" : "absent"}, ` +
        `${event.crawlDelayMs}ms between requests, ${event.sitemapCount} sitemap(s) declared`,
    );
  }
  if (event.type === "discovered" && event.source === "sitemap") {
    console.log(`  sitemap: ${event.count} URLs`);
  }
  if (event.type === "page") {
    const path = new URL(event.url).pathname;
    console.log(
      `  [${String(event.fetched).padStart(2)}/${event.budget}] ${event.role.padEnd(12)} ${path}`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const target = args.find((arg) => !arg.startsWith("--"));

  if (!target) {
    console.error("Usage: npm run snapshot -- <slug|all> [--force]\n");
    console.error("Sites:");
    for (const site of GOLDEN_SITES) console.error(`  ${site.slug}`);
    process.exitCode = 1;
    return;
  }

  const sites =
    target === "all"
      ? GOLDEN_SITES
      : [goldenSite(target)].filter((site): site is GoldenSite => Boolean(site));

  if (sites.length === 0) {
    console.error(`Unknown site "${target}".`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Capturing ${sites.length} site(s). These are real small businesses — ` +
      `one crawl each, rate limited, robots respected.`,
  );

  for (const [index, site] of sites.entries()) {
    await snapshotSite(site, force);
    if (index < sites.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, BETWEEN_SITES_MS));
    }
  }

  console.log(`\nFixtures in tests/fixtures/sites/. Commit them; tests read only these.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
