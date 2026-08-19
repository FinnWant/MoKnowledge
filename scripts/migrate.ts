import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

import { loadEnv } from "./env";

/**
 * `npm run db:migrate` — apply the schema, then everything since.
 *
 * `supabase/schema.sql` is migration 0001. It is the baseline, it has not
 * shipped anywhere with data in it, and after this point it is frozen: the
 * runner records a checksum, and editing an applied migration is an error
 * rather than a surprise. Changes from here are new files in
 * `supabase/migrations/`.
 *
 * Deliberately small. It does four things a hand-run `psql -f` does not:
 *
 *   1. remembers what has already run, so it is safe to run repeatedly
 *   2. applies each migration in a transaction, so a failure leaves nothing
 *      half-applied
 *   3. refuses to run if an applied migration's contents have changed
 *   4. takes an advisory lock, so two deploys landing together do not both
 *      apply the same migration
 *
 * `--dry-run` lists what would run and touches nothing.
 */

loadEnv(".env.local", ".env");

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
const BASELINE = path.join(process.cwd(), "supabase", "schema.sql");

/** One lock for the whole runner; the number is arbitrary but must be stable. */
const ADVISORY_LOCK = 8_675_309;

type Migration = { name: string; sql: string; checksum: string };

function checksumOf(sql: string): string {
  return createHash("sha256").update(sql).digest("hex").slice(0, 16);
}

function migrations(): Migration[] {
  const baseline = readFileSync(BASELINE, "utf8");
  const all: Migration[] = [
    { name: "0001_baseline", sql: baseline, checksum: checksumOf(baseline) },
  ];

  let files: string[] = [];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    // No migrations directory yet is the normal state at the baseline.
  }

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    all.push({ name: file.replace(/\.sql$/, ""), sql, checksum: checksumOf(sql) });
  }
  return all;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL is not set — see README, 'Optional: Supabase persistence'.");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();

  try {
    // The ledger lives in its own schema, not `public`. Two reasons, and the
    // first was found by the schema asserting on itself: `public` is where the
    // application's RLS loop enables row security on everything it finds, and a
    // ledger table appearing there fails the "every table has a policy" check.
    // The second is that PostgREST exposes `public`; a migration ledger is not
    // something any client key should be able to enumerate.
    await client.query("create schema if not exists migrations");
    await client.query(`
      create table if not exists migrations.applied (
        name        text primary key,
        checksum    text not null,
        applied_at  timestamptz not null default now()
      )`);

    // Two instances deploying at once must not both run 0002.
    await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK]);

    const { rows: applied } = await client.query<{ name: string; checksum: string }>(
      "select name, checksum from migrations.applied",
    );
    const seen = new Map(applied.map((r) => [r.name, r.checksum]));

    let ran = 0;
    for (const migration of migrations()) {
      const previous = seen.get(migration.name);

      if (previous !== undefined) {
        if (previous !== migration.checksum) {
          console.error(
            `\n${migration.name} has already been applied, but its contents have changed.\n` +
              `  recorded ${previous}, now ${migration.checksum}\n\n` +
              "An applied migration is history. Add a new migration that makes the\n" +
              "change instead of editing this one.",
          );
          process.exit(1);
        }
        console.log(`  skip   ${migration.name}`);
        continue;
      }

      if (dryRun) {
        console.log(`  would apply  ${migration.name} (${migration.checksum})`);
        ran += 1;
        continue;
      }

      process.stdout.write(`  apply  ${migration.name} … `);
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          "insert into migrations.applied (name, checksum) values ($1, $2)",
          [migration.name, migration.checksum],
        );
        await client.query("commit");
        console.log("ok");
        ran += 1;
      } catch (error) {
        await client.query("rollback").catch(() => {});
        console.log("failed");
        console.error(`\n${migration.name} failed and was rolled back:\n  ${messageOf(error)}`);
        process.exit(1);
      }
    }

    console.log(
      ran === 0
        ? "\nAlready up to date."
        : dryRun
          ? `\n${ran} migration(s) would be applied.`
          : `\n${ran} migration(s) applied.`,
    );
  } finally {
    await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK]).catch(() => {});
    await client.end();
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
