/**
 * Generates the committed example knowledge bases (R19).
 *
 *   npm run examples            # rebuild every example in examples/
 *   npm run examples -- --check # verify the committed files are current
 *
 * The examples are build output, not hand-written documents. They come from the
 * same pipeline the app runs, over the committed HTML fixtures, so an example
 * that drifts from the shipped schema is a failing `--check` rather than a
 * document nobody re-read. Each file is validated against `knowledgeBaseSchema`
 * before it is written — a reviewer opening one is looking at something the
 * running app would accept.
 *
 * Two things are pinned so the output is byte-stable across runs:
 *
 * - **The clock.** `createdAt`, `updatedAt`, and every `fetchedAt` would
 *   otherwise change on each run and make the diff unreadable.
 * - **Record ids.** Every extracted record gets a `crypto.randomUUID()` at
 *   extraction time, so two runs over identical HTML differ in a few hundred
 *   places. They are opaque — nothing in the schema references a record by id —
 *   so the committed artifact renumbers them in traversal order. Only these
 *   files are renumbered; the running app still mints real UUIDs.
 * - **The AI path.** Enrichment is forced down the mock branch even when a key
 *   is present, because a live model does not return the same prose twice. The
 *   generated fields therefore carry `method: "ai-mock"` and the `AI sample`
 *   badge, which is what the assignment asks placeholder output to look like.
 *   `npm run ai:check` is where live generation is demonstrated instead.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { knowledgeBaseSchema, type KnowledgeBase } from "../lib/schema";
import { buildKnowledgeBase, enrichKnowledgeBase } from "../lib/scraper/pipeline";
import { loadCrawlResult } from "../tests/fixtures/load";

// Must happen before `lib/ai/client` reads it. See the header note on pinning.
delete process.env.ANTHROPIC_API_KEY;

const EXAMPLES_ROOT = fileURLToPath(new URL("../examples", import.meta.url));

/** A fixed instant, so re-running produces no diff. */
const CLOCK = new Date("2026-08-18T12:00:00.000Z");

/**
 * The sites we commit, and why each one earns its place. Three, not eight:
 * every extra file is another 90KB a reviewer scrolls past, and these three
 * already cover the shapes the schema has to survive.
 */
const EXAMPLES: Array<{ slug: string; id: string; why: string }> = [
  {
    slug: "bee-cave-drilling",
    id: "example-bee-cave-drilling",
    why: "Widest entity extraction — a 30-person crew page and 18 offerings, from a site with no blog and no testimonials.",
  },
  {
    slug: "elevation-group-az",
    id: "example-elevation-group-az",
    why: "The proof and content case — 10 testimonials and 39 posts, and the most conflicts (4) for the reconciler to flag.",
  },
  {
    slug: "account-it",
    id: "example-account-it",
    why: "Twenty pages of content and no proof whatsoever — brand scores 0.81 against proof's 0.25.",
  },
];

async function build(slug: string, id: string): Promise<KnowledgeBase> {
  const crawl = loadCrawlResult(slug);
  const extraction = buildKnowledgeBase(crawl, { id, now: CLOCK });
  const { knowledgeBase } = await enrichKnowledgeBase(extraction);
  const stable = withStableRecordIds(knowledgeBase, slug);

  // The pipeline stamps `updatedAt` from the same clock; saving through the
  // storage adapter would bump it, and these files never go through one.
  const parsed = knowledgeBaseSchema.safeParse(stable);
  if (!parsed.success) {
    throw new Error(
      `${slug} does not satisfy knowledgeBaseSchema: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renumbers generated record ids so the committed file is byte-stable.
 *
 * Two passes, because ids are not all self-contained: `testimonial.relatedOffering`
 * holds the id of an offering elsewhere in the document. Renaming declarations
 * without rewriting references would leave the artifact internally inconsistent —
 * a dangling pointer in the one file a reviewer is most likely to read closely.
 * So pass one maps every `id` it meets, and pass two rewrites any string that is
 * a UUID in that map, wherever it appears.
 *
 * A UUID with no mapping is left alone rather than renumbered: it did not come
 * from a declaration we saw, so we do not know what it names.
 */
function withStableRecordIds<T>(node: T, slug: string): T {
  const mapping = new Map<string, string>();

  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "id" && typeof child === "string" && UUID.test(child)) {
        if (!mapping.has(child)) {
          mapping.set(child, `${slug}-${String(mapping.size + 1).padStart(4, "0")}`);
        }
        continue;
      }
      collect(child);
    }
  };

  const rewrite = <V,>(value: V): V => {
    if (typeof value === "string") return (mapping.get(value) ?? value) as V;
    if (Array.isArray(value)) return value.map(rewrite) as V;
    if (value === null || typeof value !== "object") return value;

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = rewrite(child);
    }
    return out as V;
  };

  collect(node);
  return rewrite(node);
}

function fileFor(slug: string): string {
  return path.join(EXAMPLES_ROOT, `knowledge-base-${slug}.json`);
}

function serialize(knowledgeBase: KnowledgeBase): string {
  return `${JSON.stringify(knowledgeBase, null, 2)}\n`;
}

async function main(): Promise<void> {
  const check = process.argv.slice(2).includes("--check");
  mkdirSync(EXAMPLES_ROOT, { recursive: true });

  let stale = 0;

  for (const example of EXAMPLES) {
    const knowledgeBase = await build(example.slug, example.id);
    const contents = serialize(knowledgeBase);
    const file = fileFor(example.slug);

    if (check) {
      let existing: string | null = null;
      try {
        existing = readFileSync(file, "utf8");
      } catch {
        existing = null;
      }
      const current = existing === contents;
      if (!current) stale += 1;
      console.log(`${current ? "✓" : "✗"} ${path.basename(file)}`);
      continue;
    }

    writeFileSync(file, contents);
    const quality = knowledgeBase.quality;
    console.log(
      `✓ ${path.basename(file)}  ${(contents.length / 1024).toFixed(0)}KB  ` +
        `completeness ${(quality.overallScore * 100).toFixed(0)}%  ` +
        `${quality.missingFields.length} missing  ` +
        `${quality.conflicts.length} conflict(s)`,
    );
  }

  if (check && stale > 0) {
    console.log(`\n${stale} example(s) out of date. Run \`npm run examples\`.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
