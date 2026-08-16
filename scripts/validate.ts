/**
 * Scores the scraper against the reference profiles.
 *
 *   npm run validate                    # every captured golden site
 *   npm run validate -- bee-cave-drilling
 *   npm run validate -- --json          # machine-readable, for diffing runs
 *
 * Runs entirely off the committed HTML fixtures: no network, no model, no API
 * key. That is what makes the number reproducible and what makes a regression
 * visible as a number rather than as a vibe (docs/VALIDATION.md).
 *
 * Enrichment is deliberately excluded. The reference's generated fields
 * (overview, pitch, ideal persona) are prose, and scoring prose against prose
 * would measure paraphrase distance rather than extraction quality.
 */

import { knowledgeBaseSchema } from "../lib/schema";
import { buildKnowledgeBase } from "../lib/scraper/pipeline";
import { capturedSlugs, loadCrawlResult } from "../tests/fixtures/load";
import { GOLDEN_SITES } from "../tests/golden/sites";
import { loadGolden } from "../tests/golden/schema";
import {
  aggregate,
  ENRICHMENT_FILLED_FIELDS,
  recall,
  scoreSite,
  type SiteScore,
} from "../tests/golden/score";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const requested = args.filter((arg) => !arg.startsWith("--"));

/** Fixed clock: cadence staleness must not change the score by the day. */
const CLOCK = new Date("2026-02-13T00:00:00.000Z");

function main(): void {
  const captured = capturedSlugs();
  const slugs = requested.length > 0 ? requested : captured;

  const scores: SiteScore[] = [];
  const invalid: string[] = [];

  for (const slug of slugs) {
    if (!captured.includes(slug)) {
      console.error(`× ${slug}: no fixtures on disk — run "npm run snapshot -- ${slug}" first`);
      continue;
    }

    const crawl = loadCrawlResult(slug);
    const { knowledgeBase } = buildKnowledgeBase(crawl, { now: CLOCK, enrich: false });

    // Schema validity is part of the P3 acceptance criteria, so it is checked
    // here rather than assumed: a knowledge base that scores well but does not
    // parse is not a result.
    const parsed = knowledgeBaseSchema.safeParse(knowledgeBase);
    if (!parsed.success) {
      invalid.push(`${slug}: ${parsed.error.issues[0]?.path.join(".")} — ${parsed.error.issues[0]?.message}`);
    }

    scores.push(scoreSite(knowledgeBase, loadGolden(slug)));
  }

  if (asJson) {
    console.log(JSON.stringify({ sites: scores, fields: aggregate(scores), invalid }, null, 2));
    return;
  }

  printReport(scores, invalid, captured);
}

function printReport(scores: SiteScore[], invalid: string[], captured: string[]): void {
  console.log("\nMoKnowledge — extraction vs. reference profiles\n");

  /* ------------------------------------------------------- per field */

  console.log("Per-field recall (matched / reference)\n");
  console.log(
    pad("field", 20) + pad("recall", 10) + pad("matched", 10) + pad("reference", 12) + pad("ours", 8) + "filled by",
  );
  console.log("-".repeat(76));

  for (const field of aggregate(scores).sort((a, b) => recall(b) - recall(a))) {
    const rate = field.expected === 0 ? "—" : `${Math.round(recall(field) * 100)}%`;
    console.log(
      pad(field.field, 20) +
        pad(rate, 10) +
        pad(String(field.matched), 10) +
        pad(String(field.expected), 12) +
        pad(String(field.produced), 8) +
        (ENRICHMENT_FILLED_FIELDS.has(field.field) ? "enrichment (not run here)" : "extraction"),
    );
  }

  /* -------------------------------------------------------- per site */

  console.log("\nPer-site totals\n");
  console.log(pad("site", 26) + pad("recall", 10) + pad("matched", 10) + pad("reference", 12) + "ours");
  console.log("-".repeat(70));

  for (const site of scores) {
    console.log(
      pad(site.slug, 26) +
        pad(`${Math.round(recall(site) * 100)}%`, 10) +
        pad(String(site.matched), 10) +
        pad(String(site.expected), 12) +
        String(site.produced),
    );
  }

  const totals = scores.reduce(
    (sum, site) => ({ matched: sum.matched + site.matched, expected: sum.expected + site.expected }),
    { matched: 0, expected: 0 },
  );
  console.log("-".repeat(70));
  console.log(
    pad("overall", 26) +
      pad(`${Math.round(recall(totals) * 100)}%`, 10) +
      pad(String(totals.matched), 10) +
      String(totals.expected),
  );

  /* -------------------------------------------------------- caveats */

  const missing = GOLDEN_SITES.filter((site) => !captured.includes(site.slug));
  if (missing.length > 0) {
    console.log(
      `\nNot scored (no fixtures): ${missing.map((site) => site.slug).join(", ")}. ` +
        "See docs/VALIDATION.md §1 — a golden profile is kept even when the site has since gone down.",
    );
  }

  if (invalid.length > 0) {
    console.log("\nSchema-invalid knowledge bases:");
    for (const line of invalid) console.log(`  × ${line}`);
    process.exitCode = 1;
  } else {
    console.log("\nAll scored knowledge bases are schema-valid.");
  }

  console.log(
    "\nRecall is measured against a peer system's output, not ground truth: a field we\n" +
      "produce and the reference lacks lowers nothing, and several reference values are\n" +
      "known defects we deliberately disagree with (see knownReferenceDefects).\n",
  );
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value.slice(0, width - 1)} ` : value.padEnd(width);
}

main();
