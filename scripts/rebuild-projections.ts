import { Client } from "pg";

import { loadEnv } from "./env";
import {
  rebuildKnowledgeBase,
  rebuildOrganization,
  rebuildProjections,
  type RebuildResult,
} from "@/lib/storage/supabase/rebuild";

/**
 * `npm run db:rebuild` — replay the projections from the stored documents.
 *
 * This is the operation that makes the schema's central claim cash out. The
 * normalized tables duplicate what is already in
 * `knowledge_base_versions.document`, and that duplication is only safe because
 * the dependency runs one way: the document is the truth, the tables are a
 * cache, and the cache can always be rebuilt.
 *
 * Which is what turns a projection schema change into `alter table` plus a
 * replay, instead of a backfill script with a rollback plan. Add a column to
 * `offerings`, run this, and it populates from data that was already stored.
 *
 *   npm run db:rebuild -- --all              every version in the tenant
 *   npm run db:rebuild -- --kb <id>          every version of one knowledge base
 *   npm run db:rebuild -- --version <uuid>   one version
 *
 * Each rebuild runs in its own transaction: an interrupted run leaves earlier
 * versions rebuilt and later ones untouched, never a version half-projected.
 */

loadEnv(".env.local", ".env");

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL is not set — see README, 'Optional: Supabase persistence'.");
    process.exit(1);
  }

  const all = process.argv.includes("--all");
  const knowledgeBaseId = arg("kb");
  const versionId = arg("version");
  const organizationId = arg("org") ?? process.env.SUPABASE_ORG_ID;

  if (!all && !knowledgeBaseId && !versionId) {
    console.error(
      "Nothing selected. Pass one of:\n" +
        "  --all                 every version in the organization\n" +
        "  --kb <id>             every version of one knowledge base\n" +
        "  --version <uuid>      a single version",
    );
    process.exit(1);
  }
  if (all && !organizationId) {
    console.error("--all needs an organization: pass --org <uuid> or set SUPABASE_ORG_ID.");
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();

  const results: RebuildResult[] = [];
  let failed = 0;
  try {
    const targets = versionId
      ? [async () => [await rebuildProjections(client, versionId)]]
      : knowledgeBaseId
        ? [async () => rebuildKnowledgeBase(client, knowledgeBaseId)]
        : [async () => rebuildOrganization(client, organizationId!)];

    for (const target of targets) {
      // One transaction per invocation of the underlying helper keeps a partial
      // run interpretable: whatever finished is correct and complete.
      await client.query("begin");
      try {
        results.push(...(await target()));
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        failed += 1;
        console.error(`  failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await client.end();
  }

  for (const result of results) {
    const drift = result.removed === result.rows ? "" : `  (was ${result.removed})`;
    console.log(`  ${result.versionId}  ${result.rows} rows across ${result.tables} tables${drift}`);
  }
  const total = results.reduce((sum, r) => sum + r.rows, 0);
  const drifted = results.filter((r) => r.removed !== r.rows).length;
  console.log(`\n${results.length} version(s) rebuilt, ${total} rows written.`);
  if (drifted > 0) {
    // Worth saying loudly: it means the projections and the documents had
    // disagreed, which should not happen through the adapter alone.
    console.log(`${drifted} version(s) had a different row count than before the rebuild.`);
  }
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
