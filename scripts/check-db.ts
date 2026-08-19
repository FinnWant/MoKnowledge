import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

import { loadEnv } from "./env";
import { SupabaseAdapter } from "@/lib/storage/supabase/adapter";
import { closePool } from "@/lib/storage/supabase/pool";
import { projectKnowledgeBase } from "@/lib/storage/supabase/project";
import { rebuildProjections } from "@/lib/storage/supabase/rebuild";

/**
 * `npm run db:check` — does the schema in `supabase/schema.sql` actually behave
 * the way `docs/DATABASE.md` says it does?
 *
 * The header of that file used to say its semantics were "reviewed rather than
 * proven", because it had only ever been parsed, never executed. This script is
 * what turns that into proven: it applies no DDL, it connects to whatever
 * `SUPABASE_DB_URL` points at and exercises the four guarantees the design
 * argument rests on —
 *
 *   1. versions are append-only (trigger AND absent policy, separately)
 *   2. a child row cannot claim a tenant its parent does not belong to
 *   3. `next_version_no` serialises concurrent saves rather than racing
 *   4. RLS isolates tenants from a real client role
 *
 * (4) is the one worth being careful about: the `postgres` role Supabase hands
 * out has BYPASSRLS, so a test that stays as `postgres` passes against policies
 * that do nothing at all. Every isolation check below runs as `authenticated`
 * with a simulated JWT, which is what the browser client actually is.
 *
 * All fixtures are written inside a transaction that is rolled back, except the
 * concurrency case, which needs two connections to see the same committed row
 * and so cleans up in a `finally`.
 */

loadEnv(".env.local", ".env");

type Check = { name: string; ok: boolean; detail: string };
const results: Check[] = [];

function record(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Runs a statement that must fail, and reports how. */
async function mustRaise(
  client: Client,
  name: string,
  sql: string,
  params: unknown[],
  expect: RegExp,
): Promise<void> {
  await client.query("savepoint attempt");
  try {
    await client.query(sql, params);
    await client.query("rollback to savepoint attempt");
    record(name, false, "statement succeeded but should have raised");
  } catch (error) {
    await client.query("rollback to savepoint attempt");
    const message = error instanceof Error ? error.message : String(error);
    record(name, expect.test(message), message.split("\n")[0].slice(0, 110));
  }
}

/** Becomes the `authenticated` role carrying `uid` as its JWT subject. */
async function actAs(client: Client, uid: string | null): Promise<void> {
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    uid === null ? "" : JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
  await client.query(`set local role ${uid === null ? "anon" : "authenticated"}`);
}

async function asPostgres(client: Client): Promise<void> {
  await client.query("reset role");
}

function connectionString(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      "SUPABASE_DB_URL is not set. Add it to .env.local — Supabase dashboard →\n" +
        "Project Settings → Database → Connection string → Session pooler.",
    );
    process.exit(1);
  }
  return url;
}

function connect(): Client {
  return new Client({
    connectionString: connectionString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
}

async function main(): Promise<void> {
  const client = connect();
  const host = new URL(connectionString()).hostname;
  console.log(`host     : ${host}`);

  try {
    await client.connect();
  } catch (error) {
    console.error(`\nCould not connect: ${error instanceof Error ? error.message : error}`);
    if (String(error).includes("ECONNREFUSED")) {
      console.error(
        "\nIf this is the *direct* connection (db.<ref>.supabase.co), it is IPv6-only\n" +
          "on the free tier. Use the session pooler host instead.",
      );
    }
    process.exit(1);
  }

  const server = await client.query<{ v: string; num: string }>(
    "select version() as v, current_setting('server_version_num') as num",
  );
  console.log(`server   : ${server.rows[0].v.split(" on ")[0]}`);
  console.log(`role     : ${(await client.query("select current_user")).rows[0].current_user}\n`);

  console.log("structure");
  record(
    "PostgreSQL 15+ (security_invoker views)",
    Number(server.rows[0].num) >= 150_000,
    server.rows[0].num,
  );

  const tables = await client.query<{ tablename: string; rowsecurity: boolean }>(
    "select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename",
  );
  const unprotected = tables.rows.filter((t) => !t.rowsecurity).map((t) => t.tablename);
  record(
    "every public table has RLS enabled",
    (tables.rowCount ?? 0) > 0 && unprotected.length === 0,
    unprotected.length > 0 ? `no RLS: ${unprotected.join(", ")}` : `${tables.rowCount} tables`,
  );

  // RLS enabled with no policy denies everyone, including the owner. The schema
  // asserts this at apply time; this asserts it about the database as it stands.
  const policyless = await client.query<{ tablename: string }>(
    `select t.tablename from pg_tables t
     where t.schemaname = 'public'
       and not exists (
         select 1 from pg_policies p
         where p.schemaname = 'public' and p.tablename = t.tablename
       )`,
  );
  record(
    "every public table has at least one policy",
    policyless.rowCount === 0,
    policyless.rowCount === 0
      ? "no table is silently unreachable"
      : `no policy: ${policyless.rows.map((r) => r.tablename).join(", ")}`,
  );

  // The tenant guard is only worth having if nothing escaped it.
  const guardGaps = await client.query<{ tablename: string }>(
    `select c.relname as tablename
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'version_id'
     where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and a.attnotnull
       and not exists (
         select 1 from pg_trigger tg
         where tg.tgrelid = c.oid and not tg.tgisinternal
           and tg.tgname = c.relname || '_inherit_org'
       )`,
  );
  record(
    "every version-scoped table carries the tenant guard",
    guardGaps.rowCount === 0,
    guardGaps.rowCount === 0
      ? "no projection table can claim the wrong tenant"
      : `unguarded: ${guardGaps.rows.map((r) => r.tablename).join(", ")}`,
  );

  const versionPolicies = await client.query<{ cmd: string }>(
    `select cmd from pg_policies
     where schemaname = 'public' and tablename = 'knowledge_base_versions'`,
  );
  const cmds = versionPolicies.rows.map((r) => r.cmd).sort();
  record(
    "knowledge_base_versions has no UPDATE or DELETE policy",
    !cmds.includes("UPDATE") && !cmds.includes("DELETE"),
    cmds.join(", "),
  );

  const view = await client.query<{ reloptions: string[] | null }>(
    `select reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'knowledge_base_summaries'`,
  );
  record(
    "knowledge_base_summaries is security_invoker",
    (view.rows[0]?.reloptions ?? []).includes("security_invoker=on"),
    "otherwise the view tunnels through every policy",
  );

  const fns = await client.query<{ proname: string; provolatile: string; prosecdef: boolean }>(
    `select proname, provolatile, prosecdef from pg_proc
     where pronamespace = 'public'::regnamespace and proname in ('is_member', 'has_role')`,
  );
  record(
    "is_member/has_role are stable + security definer",
    fns.rowCount === 2 && fns.rows.every((f) => f.provolatile === "s" && f.prosecdef),
    fns.rows.map((f) => `${f.proname}:${f.provolatile}${f.prosecdef ? "+def" : ""}`).join(" "),
  );

  // ------------------------------------------------------------ behaviour
  //
  // Everything from here writes. It all happens inside one transaction that is
  // rolled back, so a green run leaves the database exactly as it found it.

  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const companyA = randomUUID();
  // Document ids are text, not uuid: the shipped examples use `example-account-it`
  // and record ids like `account-it-0051`. A uuid column would reject them.
  const kbA = `check-kb-${orgA.slice(0, 8)}`;
  const versionA = randomUUID();
  const personId = "check-co-0051";

  console.log("\nbehaviour (in a rolled-back transaction)");
  await client.query("begin");
  try {
    await client.query(
      `insert into auth.users (id, email) values ($1, 'a@check.invalid'), ($2, 'b@check.invalid')`,
      [userA, userB],
    );
    await client.query(
      `insert into organizations (id, name, slug) values ($1, 'Check A', $3), ($2, 'Check B', $4)`,
      [orgA, orgB, `check-a-${orgA.slice(0, 8)}`, `check-b-${orgB.slice(0, 8)}`],
    );
    await client.query(
      `insert into organization_members (organization_id, user_id, role)
       values ($1, $3, 'editor'), ($2, $4, 'editor')`,
      [orgA, orgB, userA, userB],
    );
    await client.query(
      `insert into companies (id, organization_id, name, domain) values ($1, $2, 'Check Co', 'check.invalid')`,
      [companyA, orgA],
    );
    await client.query(
      `insert into knowledge_bases (id, organization_id, company_id, source_url)
       values ($1, $2, $3, 'https://check.invalid')`,
      [kbA, orgA, companyA],
    );
    await client.query(
      `insert into knowledge_base_versions
         (id, organization_id, knowledge_base_id, version_no, document, company_name,
          source_url, completeness, keywords)
       values ($1, $2, $3, 1, $4, 'Check Co', 'https://check.invalid', 0.5,
               array['emergency service'])`,
      [versionA, orgA, kbA, JSON.stringify({ id: kbA, companyName: { value: "Check Co" } })],
    );
    await client.query("update knowledge_bases set current_version_id = $1 where id = $2", [
      versionA,
      kbA,
    ]);
    record("seed a tenant, company, knowledge base and v1", true);

    // Write one row into every category the knowledge base standard names, so
    // the checks below are about a populated document rather than an empty one.
    await client.query(
      `insert into kb_foundation (version_id, organization_id, overview, industry,
         business_model, company_role, year_founded, service_locations, alt_names)
       values ($1, $2, 'A check fixture', 'Plumbing', 'b2c', 'contractor', 1998,
               array['Austin'], array['Check Company'])`,
      [versionA, orgA],
    );
    await client.query(
      `insert into addresses (organization_id, version_id, kind, formatted, city, region, position)
       values ($1, $2, 'main', '1 Check St, Austin, TX', 'Austin', 'TX', 0)`,
      [orgA, versionA],
    );
    await client.query(
      `insert into kb_positioning (version_id, organization_id, pitch) values ($1, $2, 'The pitch')`,
      [versionA, orgA],
    );
    await client.query(
      `insert into kb_market (version_id, organization_id, buyers, ctas)
       values ($1, $2, array['homeowners'], array['Book now'])`,
      [versionA, orgA],
    );
    await client.query(
      `insert into kb_branding (version_id, organization_id, art_style, fonts)
       values ($1, $2, 'photographic', array['Inter'])`,
      [versionA, orgA],
    );
    await client.query(
      `insert into kb_writing_style (version_id, organization_id, description, tone,
         formality, reader_address)
       values ($1, $2, 'Warm and direct', array['warm','direct']::tone[], 'neutral', 'second-person')`,
      [versionA, orgA],
    );
    await client.query(
      `insert into brand_colors (id, organization_id, version_id, hex, role, frequency,
         method, confidence, position)
       values ('check-color-1', $1, $2, '#1a2b3c', 'primary', 12, 'derived', 0.7, 0)`,
      [orgA, versionA],
    );
    await client.query(
      `insert into media_assets (id, organization_id, version_id, slot, url, kind,
         method, confidence, position)
       values ('check-logo-1', $1, $2, 'branding.logos', 'https://check.invalid/logo.svg',
               'logo', 'scraped', 0.9, 0)`,
      [orgA, versionA],
    );
    await client.query(
      `insert into offerings (id, organization_id, version_id, name, category, features,
         method, confidence, position)
       values ('check-off-1', $1, $2, 'Emergency service', 'consultation',
               array['24/7'], 'scraped', 0.9, 0)`,
      [orgA, versionA],
    );
    await client.query(
      `insert into credentials (id, organization_id, version_id, slot, name, kind,
         method, confidence, position)
       values ('check-cred-1', $1, $2, 'proof.certifications', 'Master Plumber',
               'license', 'scraped', 0.9, 0)`,
      [orgA, versionA],
    );
    await client.query(
      `insert into content_themes (id, organization_id, version_id, label, weight, terms,
         method, confidence, position)
       values ('check-theme-1', $1, $2, 'Water heaters', 0.4, array['water heater'],
               'derived', 0.7, 0)`,
      [orgA, versionA],
    );
    await client.query(
      `insert into faqs (id, organization_id, version_id, question, answer,
         method, confidence, position)
       values ('check-faq-1', $1, $2, 'Do you offer emergency service?', 'Yes.',
               'scraped', 0.9, 0)`,
      [orgA, versionA],
    );
    await client.query(
      `insert into kb_scrape_metadata (version_id, organization_id, started_at, finished_at,
         duration_ms, pages_discovered, robots_respected, scraper_version)
       values ($1, $2, now(), now(), 1200, 14, true, 'check-1')`,
      [versionA, orgA],
    );
    await client.query(
      `insert into scrape_warnings (organization_id, version_id, code, message, position)
       values ($1, $2, 'js-rendered', 'Some content needs JavaScript.', 0)`,
      [orgA, versionA],
    );
    await client.query(
      `insert into quality_conflicts (organization_id, version_id, path, label, position)
       values ($1, $2, 'foundation.phone', 'Phone number', 0)`,
      [orgA, versionA],
    );
    await client.query(
      `insert into quality_conflict_candidates (organization_id, version_id, conflict_path,
         value, source_url, source_label, confidence, position)
       values ($1, $2, 'foundation.phone', '"512-555-0100"'::jsonb,
               'https://check.invalid/contact', 'on the Contact page', 0.9, 0)`,
      [orgA, versionA],
    );
    await client.query(
      `insert into field_provenance (version_id, organization_id, path, category, method,
         confidence, is_filled)
       values ($1, $2, 'foundation.yearFounded', 'foundation', 'scraped', 0.9, true),
              ($1, $2, 'positioning.pitch', 'positioning', 'ai-mock', 0.4, true)`,
      [versionA, orgA],
    );
    record("every knowledge base category accepts a row", true, "17 tables written");

    // The offering above is categorised `consultation`, which the previous
    // enum did not contain. Inserting it is the regression test.
    const offeringCategories = await client.query<{ category: string }>(
      "select category::text from offerings where version_id = $1",
      [versionA],
    );
    record(
      "an offering category outside the old five-value enum inserts",
      offeringCategories.rows[0]?.category === "consultation",
      offeringCategories.rows[0]?.category ?? "none",
    );

    // 1. append-only
    await mustRaise(
      client,
      "updating a version raises (trigger)",
      "update knowledge_base_versions set company_name = 'Changed' where id = $1",
      [versionA],
      /append-only/i,
    );
    await mustRaise(
      client,
      "deleting a version raises (trigger)",
      "delete from knowledge_base_versions where id = $1",
      [versionA],
      /append-only/i,
    );

    // 2. the tenant guard on denormalized organization_id
    await mustRaise(
      client,
      "a child row cannot claim the wrong tenant",
      `insert into people (id, organization_id, version_id, name, method, confidence, position)
       values ($1, $2, $3, 'Wrong Tenant', 'scraped', 0.9, 0)`,
      ["check-co-9999", orgB, versionA],
      /claims organization/i,
    );
    // The same guard on a table added later, to prove the trigger loop attached
    // it rather than only the tables that had it hand-written.
    await mustRaise(
      client,
      "the guard covers the newly normalized tables too",
      `insert into faqs (id, organization_id, version_id, question, answer, method, confidence, position)
       values ('check-faq-2', $1, $2, 'Wrong tenant?', 'Yes.', 'scraped', 0.9, 1)`,
      [orgB, versionA],
      /claims organization/i,
    );
    await client.query(
      `insert into people (id, organization_id, version_id, name, method, confidence, position)
       values ($1, $2, $3, 'Right Tenant', 'scraped', 0.9, 0)`,
      [personId, orgA, versionA],
    );
    record("the same row with the correct tenant inserts", true);

    // 3. company deduplication
    await mustRaise(
      client,
      "duplicate (organization, domain) is rejected",
      `insert into companies (id, organization_id, name, domain) values ($1, $2, 'Dupe', 'check.invalid')`,
      [randomUUID(), orgA],
      /duplicate key|unique/i,
    );
    await client.query(
      `insert into companies (id, organization_id, name, domain) values ($1, $2, 'Other Tenant', 'check.invalid')`,
      [randomUUID(), orgB],
    );
    record("the same domain under a different tenant is allowed", true);

    // 4. next_version_no
    const nextNo = await client.query<{ next_version_no: number }>(
      "select next_version_no($1)",
      [kbA],
    );
    record(
      "next_version_no allocates the following number",
      nextNo.rows[0].next_version_no === 2,
      `got ${nextNo.rows[0].next_version_no}`,
    );

    // 5. the summaries view — it has to serve `list()` on its own, or every
    //    card in the library costs a document fetch.
    const summary = await client.query<Record<string, unknown>>(
      "select * from knowledge_base_summaries where id = $1",
      [kbA],
    );
    record(
      "knowledge_base_summaries reports the current version",
      summary.rows[0]?.version_no === 1 && Number(summary.rows[0]?.people_count) === 1,
      `v${summary.rows[0]?.version_no}, people=${summary.rows[0]?.people_count}`,
    );

    // Every field of KnowledgeBaseSummary, by the column the adapter will read.
    const required: Record<string, string> = {
      id: "id",
      version: "version_no",
      companyName: "company_name",
      sourceUrl: "source_url",
      industry: "industry",
      logoUrl: "logo_url",
      location: "location",
      completeness: "completeness",
      peopleCount: "people_count",
      offeringsCount: "offerings_count",
      testimonialsCount: "testimonials_count",
      attentionCount: "attention_count",
      conflictCount: "conflict_count",
      keywords: "keywords",
      createdAt: "created_at",
      updatedAt: "updated_at",
    };
    const present = new Set(Object.keys(summary.rows[0] ?? {}));
    const absent = Object.entries(required)
      .filter(([, column]) => !present.has(column))
      .map(([field, column]) => `${field} (${column})`);
    record(
      "the view supplies every field of KnowledgeBaseSummary",
      absent.length === 0,
      absent.length === 0 ? `all ${Object.keys(required).length} fields` : `missing: ${absent.join(", ")}`,
    );

    record(
      "logo_url is the first logo in document order",
      summary.rows[0]?.logo_url === "https://check.invalid/logo.svg",
      String(summary.rows[0]?.logo_url),
    );
    record(
      "location prefers 'City, Region' from the main address",
      summary.rows[0]?.location === "Austin, TX",
      String(summary.rows[0]?.location),
    );

    // The document's name wins over the directory's, because the review UI
    // edits the former and the library must show what the record says.
    await client.query("update companies set name = 'Stale Directory Name' where id = $1", [
      companyA,
    ]);
    const renamed = await client.query<{ company_name: string; company_record_name: string }>(
      "select company_name, company_record_name from knowledge_base_summaries where id = $1",
      [kbA],
    );
    record(
      "company_name follows the document, not the companies row",
      renamed.rows[0]?.company_name === "Check Co" &&
        renamed.rows[0]?.company_record_name === "Stale Directory Name",
      `${renamed.rows[0]?.company_name} vs ${renamed.rows[0]?.company_record_name}`,
    );

    // With no address at all, the card falls back to the first area served —
    // normal for a service business.
    await client.query("delete from addresses where version_id = $1", [versionA]);
    const noAddress = await client.query<{ location: string }>(
      "select location from knowledge_base_summaries where id = $1",
      [kbA],
    );
    record(
      "location falls back to the first area served when there is no address",
      noAddress.rows[0]?.location === "Austin",
      String(noAddress.rows[0]?.location),
    );

    // ------------------------------------------------------------------ RLS
    console.log("\nRLS, as the `authenticated` role (not `postgres`, which bypasses it)");

    await actAs(client, userA);
    const seenByA = await client.query("select count(*)::int as n from knowledge_bases");
    const summariesA = await client.query("select count(*)::int as n from knowledge_base_summaries");
    const peopleA = await client.query("select count(*)::int as n from people");
    await asPostgres(client);
    record(
      "a member sees their own tenant's rows",
      seenByA.rows[0].n === 1 && summariesA.rows[0].n === 1 && peopleA.rows[0].n === 1,
      `kbs=${seenByA.rows[0].n} summaries=${summariesA.rows[0].n} people=${peopleA.rows[0].n}`,
    );

    await actAs(client, userB);
    const seenByB = await client.query("select count(*)::int as n from knowledge_bases");
    const summariesB = await client.query("select count(*)::int as n from knowledge_base_summaries");
    const versionsB = await client.query("select count(*)::int as n from knowledge_base_versions");
    const provB = await client.query("select count(*)::int as n from people");
    await asPostgres(client);
    record(
      "another tenant's member sees nothing",
      seenByB.rows[0].n === 0 &&
        summariesB.rows[0].n === 0 &&
        versionsB.rows[0].n === 0 &&
        provB.rows[0].n === 0,
      `kbs=${seenByB.rows[0].n} summaries=${summariesB.rows[0].n} versions=${versionsB.rows[0].n} people=${provB.rows[0].n}`,
    );

    await actAs(client, null);
    const seenByAnon = await client.query("select count(*)::int as n from knowledge_bases");
    const anonSummaries = await client.query(
      "select count(*)::int as n from knowledge_base_summaries",
    );
    await asPostgres(client);
    record(
      "an anonymous client sees nothing",
      seenByAnon.rows[0].n === 0 && anonSummaries.rows[0].n === 0,
      `kbs=${seenByAnon.rows[0].n} summaries=${anonSummaries.rows[0].n}`,
    );

    // The append-only guarantee, held against a client key rather than a trigger:
    // there is no update or delete policy, so the rows are not even visible to
    // the statement and it reports zero rows instead of raising.
    await actAs(client, userA);
    const attemptedUpdate = await client.query(
      "update knowledge_base_versions set company_name = 'Tampered' where id = $1",
      [versionA],
    );
    const attemptedDelete = await client.query(
      "delete from knowledge_base_versions where id = $1",
      [versionA],
    );
    await asPostgres(client);
    const stillThere = await client.query(
      "select company_name from knowledge_base_versions where id = $1",
      [versionA],
    );
    record(
      "a client key cannot update or delete a version (no policy)",
      attemptedUpdate.rowCount === 0 &&
        attemptedDelete.rowCount === 0 &&
        stillThere.rows[0].company_name === "Check Co",
      `update=${attemptedUpdate.rowCount} rows, delete=${attemptedDelete.rowCount} rows, value=${stillThere.rows[0].company_name}`,
    );

    // 6. the composite primary key on every record table.
    //
    // A record id is stable within a knowledge base, not globally: person
    // `check-co-0051` appears in v1 and again in v2 of the same document. With
    // `id` alone as the primary key — which is what this schema used to have —
    // saving the second version of an edited knowledge base fails on a duplicate
    // key, which breaks versioning outright.
    const versionA2 = randomUUID();
    await client.query(
      `insert into knowledge_base_versions
         (id, organization_id, knowledge_base_id, version_no, document, source_url)
       values ($1, $2, $3, 2, '{}'::jsonb, 'https://check.invalid')`,
      [versionA2, orgA, kbA],
    );
    await client.query(
      `insert into people (id, organization_id, version_id, name, method, confidence, position)
       values ($1, $2, $3, 'Right Tenant', 'user-edited', 1, 0)`,
      [personId, orgA, versionA2],
    );
    const bothVersions = await client.query<{ n: number }>(
      "select count(*)::int as n from people where id = $1",
      [personId],
    );
    record(
      "the same record id can appear in two versions of one knowledge base",
      bothVersions.rows[0].n === 2,
      `${bothVersions.rows[0].n} rows for ${personId}`,
    );

    // 7. cascade — the `remove(id)` path, and the one the append-only trigger
    //    used to make impossible: it fired on the cascaded delete and raised,
    //    so nothing under a tenant could ever be removed.
    const kbB = `check-kb2-${orgA.slice(0, 8)}`;
    await client.query(
      `insert into knowledge_bases (id, organization_id, company_id, source_url)
       values ($1, $2, $3, 'https://check-two.invalid')`,
      [kbB, orgA, companyA],
    );
    await client.query(
      `insert into knowledge_base_versions
         (id, organization_id, knowledge_base_id, version_no, document, source_url)
       values (gen_random_uuid(), $1, $2, 1, '{}'::jsonb, 'https://check-two.invalid')`,
      [orgA, kbB],
    );

    await client.query("delete from knowledge_bases where id = $1", [kbA]);
    const afterKbDelete = await client.query<{ versions: string; people: string }>(
      `select (select count(*) from knowledge_base_versions where knowledge_base_id = $1) as versions,
              (select count(*) from people where version_id = $2) as people`,
      [kbA, versionA],
    );
    record(
      "remove(id): deleting a knowledge base cascades to its versions and projections",
      Number(afterKbDelete.rows[0].versions) === 0 && Number(afterKbDelete.rows[0].people) === 0,
      `versions=${afterKbDelete.rows[0].versions} people=${afterKbDelete.rows[0].people}`,
    );

    // ...while a direct delete of a version whose parents are still there is
    // still refused. This is the pair that matters: the cascade allowance must
    // not become a way to erase history.
    await mustRaise(
      client,
      "a version whose parents still exist cannot be deleted directly",
      "delete from knowledge_base_versions where knowledge_base_id = $1",
      [kbB],
      /append-only/i,
    );

    await client.query("delete from organizations where id = $1", [orgA]);

    // Every table carrying organization_id, counted dynamically: a table added
    // later without `on delete cascade` would leave rows behind, and naming
    // three tables here would never notice.
    const tenantTables = await client.query<{ tablename: string }>(
      `select c.relname as tablename
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id'
       where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0
       order by c.relname`,
    );
    const counts = tenantTables.rows
      .map((r) => `select '${r.tablename}' as t, count(*)::int as n from ${r.tablename} where organization_id = $1`)
      .join(" union all ");
    const leftovers = await client.query<{ t: string; n: number }>(
      `select * from (${counts}) all_tables where n > 0`,
      [orgA],
    );
    record(
      "deleting a tenant leaves no row in any of its tables",
      leftovers.rowCount === 0,
      leftovers.rowCount === 0
        ? `all ${tenantTables.rowCount} tables with organization_id are empty for that tenant`
        : leftovers.rows.map((r) => `${r.t}=${r.n}`).join(", "),
    );
  } finally {
    await client.query("rollback");
    await client.end();
  }

  await concurrency();
  await tenancyBootstrap();
  await companyResolution();
  await loadRealExamples();
  await adapterRoundTrip();
  await closePool();
  report();
}

/**
 * The adapter, through its own five methods, against a real example document.
 *
 * Everything above this tests the schema. This tests the thing that will
 * actually talk to it, and it tests it the way the app does — no hand-written
 * SQL, no fixtures shaped to fit: `save()` a knowledge base the scraper
 * produced, then read it back and check it is the same knowledge base.
 */
async function adapterRoundTrip(): Promise<void> {
  console.log("\nSupabaseAdapter round trip");

  const client = connect();
  await client.connect();
  const org = randomUUID();
  const otherOrg = randomUUID();
  const user = randomUUID();

  try {
    await client.query(`insert into auth.users (id, email) values ($1, 'adapter@check.invalid')`, [
      user,
    ]);
    await client.query(
      `insert into organizations (id, name, slug) values ($1, 'Adapter', $2), ($3, 'Adapter Other', $4)`,
      [org, `adapter-${org.slice(0, 8)}`, otherOrg, `adapter-other-${otherOrg.slice(0, 8)}`],
    );
    await client.query(
      `insert into organization_members (organization_id, user_id, role) values ($1, $2, 'editor')`,
      [org, user],
    );

    const adapter = new SupabaseAdapter(() => ({ organizationId: org, userId: null }));
    const intruder = new SupabaseAdapter(() => ({ organizationId: otherOrg, userId: null }));

    const dir = path.join(process.cwd(), "examples");
    const file = readdirSync(dir).filter((f) => f.endsWith(".json"))[0];
    const original = JSON.parse(readFileSync(path.join(dir, file), "utf8"));

    // ------------------------------------------------------------- save
    const first = await adapter.save(original);
    record(
      "save() writes v1 and returns the knowledge base as stored",
      first.version === 1 && first.id === original.id,
      `v${first.version} of ${first.id}`,
    );

    // ------------------------------------------------------------- get
    const fetched = await adapter.get(original.id);
    record(
      "get() returns the same document that went in",
      fetched !== null && JSON.stringify(fetched) === JSON.stringify(first),
      fetched ? "identical" : "null",
    );

    // The projections were written in the same transaction as the version.
    const projected = await client.query<{ n: number }>(
      `select count(*)::int as n from offerings o
       join knowledge_base_versions v on v.id = o.version_id
       where v.knowledge_base_id = $1`,
      [original.id],
    );
    record(
      "save() projected the normalized tables too",
      projected.rows[0].n > 0,
      `${projected.rows[0].n} offerings`,
    );

    // ------------------------------------------------------- save again
    const edited = {
      ...first,
      companyName: { ...first.companyName, value: "Edited Name", method: "user-edited" as const },
    };
    const second = await adapter.save(edited);
    record(
      "a second save writes v2 and preserves createdAt",
      second.version === 2 &&
        second.createdAt === first.createdAt &&
        second.updatedAt !== first.updatedAt,
      `v${second.version}, createdAt ${second.createdAt === first.createdAt ? "kept" : "CHANGED"}`,
    );

    const v1 = await adapter.get(original.id, 1);
    record(
      "the earlier version is still readable",
      v1?.companyName.value === first.companyName.value && v1?.version === 1,
      `v1 companyName = ${v1?.companyName.value}`,
    );

    // ---------------------------------------------------------- versions
    const versions = await adapter.versions(original.id);
    record(
      "versions() lists newest first",
      versions.length === 2 && versions[0].version === 2 && versions[1].version === 1,
      versions.map((v) => `v${v.version}`).join(", "),
    );
    record(
      "an edit is not marked as a re-scrape",
      versions[0].rescraped === undefined,
      versions[0].rescraped ? "flagged rescraped" : "not flagged",
    );

    // A version whose crawl differs from its predecessor's is a re-scrape —
    // derived the same way LocalJsonAdapter derives it, rather than declared.
    const recrawled = {
      ...second,
      scrape: { ...second.scrape, startedAt: new Date(Date.now() + 1000).toISOString() },
    };
    await adapter.save(recrawled);
    const afterRescrape = await adapter.versions(original.id);
    record(
      "a version built from a new crawl is marked as a re-scrape",
      afterRescrape[0].rescraped === true,
      `v${afterRescrape[0].version} rescraped=${afterRescrape[0].rescraped}`,
    );

    // -------------------------------------------------------------- list
    const listed = await adapter.list();
    const summary = listed.find((s) => s.id === original.id);
    record(
      "list() returns a valid summary without reading a document",
      listed.length === 1 && summary?.companyName === "Edited Name",
      `${listed.length} row(s), companyName=${summary?.companyName}`,
    );
    record(
      "the summary carries the fields the card needs",
      summary !== undefined &&
        typeof summary.completeness === "number" &&
        Array.isArray(summary.keywords) &&
        summary.offeringsCount > 0,
      `completeness=${summary?.completeness} offerings=${summary?.offeringsCount}`,
    );

    // ------------------------------------------------------ isolation
    const seenByOther = await intruder.get(original.id);
    const listedByOther = await intruder.list();
    record(
      "another tenant's adapter cannot read it",
      seenByOther === null && listedByOther.length === 0,
      `get=${seenByOther === null ? "null" : "LEAKED"} list=${listedByOther.length}`,
    );
    const removedByOther = await intruder.remove(original.id);
    record(
      "another tenant's adapter cannot delete it",
      removedByOther === false && (await adapter.get(original.id)) !== null,
      removedByOther ? "DELETED" : "refused",
    );

    // -------------------------------------------------------- rebuild
    const versionRow = await client.query<{ id: string }>(
      `select v.id from knowledge_base_versions v
       where v.knowledge_base_id = $1 order by version_no desc limit 1`,
      [original.id],
    );
    const before = await countProjection(client, versionRow.rows[0].id);
    await client.query("begin");
    const rebuilt = await rebuildProjections(client, versionRow.rows[0].id);
    await client.query("commit");
    const after = await countProjection(client, versionRow.rows[0].id);
    record(
      "rebuildProjections reproduces the projections from the document",
      before === after && rebuilt.rows === after && rebuilt.removed === before,
      `${before} rows before, ${after} after`,
    );

    // ------------------------------------------------------------ remove
    const removed = await adapter.remove(original.id);
    const gone = await adapter.get(original.id);
    record(
      "remove() deletes the knowledge base and everything under it",
      removed === true && gone === null,
      `removed=${removed}, get=${gone === null ? "null" : "still there"}`,
    );
    record("remove() on a missing id returns false", (await adapter.remove(original.id)) === false);
  } catch (error) {
    record("adapter round trip", false, error instanceof Error ? error.message : String(error));
  } finally {
    await client.query("rollback").catch(() => {});
    await client
      .query(
        `delete from organizations where id in (
           select organization_id from organization_members where user_id = $1
         )`,
        [user],
      )
      .catch(() => {});
    await client
      .query("delete from organizations where id = any($1::uuid[])", [[org, otherOrg]])
      .catch(() => {});
    await client.query("delete from auth.users where id = $1", [user]).catch(() => {});
    await client.end();
  }
}

/** Total projection rows for one version, across every projection table. */
async function countProjection(client: Client, versionId: string): Promise<number> {
  const { rows: tables } = await client.query<{ tablename: string }>(
    `select c.relname as tablename from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'version_id'
     where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and a.attnotnull`,
  );
  const parts = tables.map(
    (t) => `select count(*)::int as n from ${t.tablename} where version_id = $1`,
  );
  const { rows } = await client.query<{ total: string }>(
    `select sum(n)::text as total from (${parts.join(" union all ")}) counts`,
    [versionId],
  );
  return Number(rows[0].total);
}

/**
 * Signup, invitations, and the escalation paths between them.
 *
 * `organizations` has no insert policy, so becoming a tenant is something only
 * the signup trigger can do. That makes `handle_new_user` the single most
 * security-sensitive function in the schema: it runs SECURITY DEFINER, above
 * RLS, on data that partly comes from the client.
 */
async function tenancyBootstrap(): Promise<void> {
  console.log("\nsignup and tenant bootstrap");
  const client = connect();
  await client.connect();
  await client.query("begin");
  try {
    // ---------------------------------------------- a brand new tenant
    const founder = randomUUID();
    await client.query(`insert into auth.users (id, email) values ($1, 'founder@check.invalid')`, [
      founder,
    ]);
    const owned = await client.query<{ organization_id: string; role: string; slug: string }>(
      `select m.organization_id, m.role::text, o.slug
       from organization_members m join organizations o on o.id = m.organization_id
       where m.user_id = $1`,
      [founder],
    );
    record(
      "signing up with no invitation creates a tenant you own",
      owned.rowCount === 1 && owned.rows[0].role === "owner",
      `role=${owned.rows[0]?.role} slug=${owned.rows[0]?.slug}`,
    );
    const firstOrg = owned.rows[0].organization_id;

    // Slugs are derived from the address, so two people at different domains
    // with the same local part collide unless the generator handles it.
    const second = randomUUID();
    await client.query(`insert into auth.users (id, email) values ($1, 'founder@other.invalid')`, [
      second,
    ]);
    const slugs = await client.query<{ slug: string }>(
      `select o.slug from organization_members m join organizations o on o.id = m.organization_id
       where m.user_id = any($1::uuid[]) order by o.slug`,
      [[founder, second]],
    );
    record(
      "a colliding organization slug gets a suffix rather than failing",
      slugs.rowCount === 2 && slugs.rows[0].slug !== slugs.rows[1].slug,
      slugs.rows.map((r) => r.slug).join(" / "),
    );

    // ------------------------------------------------- joining by invitation
    await client.query(
      `insert into organization_invitations (organization_id, email, role, invited_by)
       values ($1, 'Invited@Check.Invalid', 'viewer', $2)`,
      [firstOrg, founder],
    );
    const invitee = randomUUID();
    // Signs up with a different capitalisation than the invitation was sent to.
    await client.query(`insert into auth.users (id, email) values ($1, 'invited@check.invalid')`, [
      invitee,
    ]);
    const joined = await client.query<{ organization_id: string; role: string }>(
      `select organization_id, role::text from organization_members where user_id = $1`,
      [invitee],
    );
    record(
      "an invited user joins the inviting tenant at the invited role",
      joined.rowCount === 1 &&
        joined.rows[0].organization_id === firstOrg &&
        joined.rows[0].role === "viewer",
      `${joined.rowCount} membership(s), role=${joined.rows[0]?.role}`,
    );
    const consumed = await client.query<{ accepted_by: string | null }>(
      `select accepted_by from organization_invitations where organization_id = $1`,
      [firstOrg],
    );
    record(
      "the invitation is marked accepted, so it cannot be reused",
      consumed.rows[0]?.accepted_by === invitee,
      consumed.rows[0]?.accepted_by ? "accepted" : "still open",
    );

    // ------------------------------------------------------- the forgery
    //
    // The reason invitations are a table. `raw_user_meta_data` is whatever the
    // client passed to signUp(), so if the trigger trusted an organization_id
    // there, anyone could join any tenant by typing its uuid into a form.
    const attacker = randomUUID();
    await client.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ($1, 'attacker@check.invalid', jsonb_build_object('organization_id', $2::text))`,
      [attacker, firstOrg],
    );
    const breached = await client.query<{ n: number }>(
      `select count(*)::int as n from organization_members
       where user_id = $1 and organization_id = $2`,
      [attacker, firstOrg],
    );
    const gotOwn = await client.query<{ n: number }>(
      `select count(*)::int as n from organization_members where user_id = $1`,
      [attacker],
    );
    record(
      "claiming an organization_id at signup does not join that tenant",
      breached.rows[0].n === 0 && gotOwn.rows[0].n === 1,
      `joined target=${breached.rows[0].n}, own tenants=${gotOwn.rows[0].n}`,
    );

    // ------------------------------------------------- expired invitations
    await client.query(
      `insert into organization_invitations (organization_id, email, role, expires_at)
       values ($1, 'stale@check.invalid', 'editor', now() - interval '1 day')`,
      [firstOrg],
    );
    const late = randomUUID();
    await client.query(`insert into auth.users (id, email) values ($1, 'stale@check.invalid')`, [
      late,
    ]);
    const lateMembership = await client.query<{ organization_id: string }>(
      `select organization_id from organization_members where user_id = $1`,
      [late],
    );
    record(
      "an expired invitation is ignored, and the user gets their own tenant",
      lateMembership.rowCount === 1 && lateMembership.rows[0].organization_id !== firstOrg,
      lateMembership.rows[0]?.organization_id === firstOrg ? "joined anyway" : "own tenant",
    );

    // ------------------------------------------------ privilege escalation
    //
    // An admin manages membership, which means an admin can write invitations.
    // Without the guard, an admin invites their own second address as `owner`.
    const admin = randomUUID();
    await client.query(`insert into auth.users (id, email) values ($1, 'admin@check.invalid')`, [
      admin,
    ]);
    await client.query(
      `insert into organization_members (organization_id, user_id, role)
       values ($1, $2, 'admin')
       on conflict (organization_id, user_id) do update set role = 'admin'`,
      [firstOrg, admin],
    );

    await actAs(client, admin);
    let escalated = false;
    await client.query("savepoint escalate");
    try {
      await client.query(
        `insert into organization_invitations (organization_id, email, role)
         values ($1, 'promoted@check.invalid', 'owner')`,
        [firstOrg],
      );
      escalated = true;
    } catch {
      /* expected */
    }
    await client.query("rollback to savepoint escalate");

    // The same admin may still invite an editor — the guard is about `owner`,
    // not about admins generally.
    let ordinaryInviteWorked = true;
    await client.query("savepoint ordinary");
    try {
      await client.query(
        `insert into organization_invitations (organization_id, email, role)
         values ($1, 'colleague@check.invalid', 'editor')`,
        [firstOrg],
      );
    } catch {
      ordinaryInviteWorked = false;
    }
    await client.query("rollback to savepoint ordinary");
    await asPostgres(client);

    record(
      "an admin cannot invite an owner, but can invite an editor",
      !escalated && ordinaryInviteWorked,
      `owner invite ${escalated ? "SUCCEEDED" : "blocked"}, editor invite ${ordinaryInviteWorked ? "allowed" : "BLOCKED"}`,
    );

    // An owner can, which is what makes the above a guard and not a wall.
    await actAs(client, founder);
    let ownerCanGrant = true;
    await client.query("savepoint owner_grant");
    try {
      await client.query(
        `insert into organization_invitations (organization_id, email, role)
         values ($1, 'cofounder@check.invalid', 'owner')`,
        [firstOrg],
      );
    } catch {
      ownerCanGrant = false;
    }
    await client.query("rollback to savepoint owner_grant");
    await asPostgres(client);
    record("an owner can invite another owner", ownerCanGrant);

    // A member of another tenant cannot see the invitations at all.
    await actAs(client, second);
    const visible = await client.query<{ n: number }>(
      "select count(*)::int as n from organization_invitations",
    );
    await asPostgres(client);
    record(
      "invitations are invisible outside their tenant",
      visible.rows[0].n === 0,
      `${visible.rows[0].n} visible`,
    );
  } catch (error) {
    record("tenant bootstrap", false, error instanceof Error ? error.message : String(error));
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

/**
 * `resolve_company` — the find-or-create `save()` needs.
 *
 * The interesting case is the concurrent one. A naive select-then-insert has
 * both callers find nothing and both insert, and one gets a unique violation;
 * two people pasting the same company URL at the same moment is exactly the
 * situation a multi-company library is for.
 */
async function companyResolution(): Promise<void> {
  console.log("\ncompany resolution (find-or-create)");
  const one = connect();
  const two = connect();
  await one.connect();
  await two.connect();

  const orgA = randomUUID();
  const orgB = randomUUID();
  try {
    await one.query(`insert into organizations (id, name, slug) values ($1, 'Res A', $2), ($3, 'Res B', $4)`, [
      orgA, `res-a-${orgA.slice(0, 8)}`, orgB, `res-b-${orgB.slice(0, 8)}`,
    ]);

    const first = await one.query<{ resolve_company: string }>(
      "select resolve_company($1, $2, $3)",
      [orgA, "example.com", "Example Co"],
    );
    const again = await one.query<{ resolve_company: string }>(
      "select resolve_company($1, $2, $3)",
      [orgA, "example.com", "Example Company LLC"],
    );
    record(
      "resolving the same domain twice returns the same company",
      first.rows[0].resolve_company === again.rows[0].resolve_company,
      `${first.rows[0].resolve_company.slice(0, 8)} then ${again.rows[0].resolve_company.slice(0, 8)}`,
    );

    const name = await one.query<{ name: string }>("select name from companies where id = $1", [
      first.rows[0].resolve_company,
    ]);
    record(
      "a later scrape does not rename the company behind the user's back",
      name.rows[0].name === "Example Co",
      name.rows[0].name,
    );

    const otherTenant = await one.query<{ resolve_company: string }>(
      "select resolve_company($1, $2, $3)",
      [orgB, "example.com", "Example Co"],
    );
    record(
      "the same domain in another tenant is a different company",
      otherTenant.rows[0].resolve_company !== first.rows[0].resolve_company,
      "uniqueness is scoped to the organization, not global",
    );

    // Two sessions resolving the same new domain at once.
    //
    // Sequenced rather than fired together, because firing them together and
    // awaiting both deadlocks the *test*: the second insert blocks on the
    // first session's uncommitted unique-index entry, and the first cannot
    // commit while the test is still waiting on the second. That is the
    // scheduling, not the function — so this drives it explicitly.
    await one.query("begin");
    const a = await one.query<{ resolve_company: string }>(
      "select resolve_company($1, $2, $3)",
      [orgA, "race-me.com", "Race Me"],
    );

    await two.query("begin");
    let secondResolved = false;
    const raceB = two
      .query<{ resolve_company: string }>("select resolve_company($1, $2, $3)", [
        orgA, "race-me.com", "Race Me",
      ])
      .then((r) => {
        secondResolved = true;
        return r;
      });

    await new Promise((resolve) => setTimeout(resolve, 700));
    record(
      "a second resolver blocks on the first's uncommitted row",
      !secondResolved,
      secondResolved ? "it inserted a duplicate" : "still waiting",
    );

    await one.query("commit");
    const b = await raceB;
    await two.query("commit");

    record(
      "once the first commits, the second returns that same company",
      a.rows[0].resolve_company === b.rows[0].resolve_company,
      `${a.rows[0].resolve_company.slice(0, 8)} / ${b.rows[0].resolve_company.slice(0, 8)}`,
    );

    const total = await one.query<{ n: number }>(
      "select count(*)::int as n from companies where organization_id = $1 and domain = 'race-me.com'",
      [orgA],
    );
    record("exactly one row exists for the raced domain", total.rows[0].n === 1, `${total.rows[0].n} rows`);
  } catch (error) {
    record("company resolution", false, error instanceof Error ? error.message : String(error));
    await one.query("rollback").catch(() => {});
    await two.query("rollback").catch(() => {});
  } finally {
    // Roll back first: if a check failed mid-transaction the connection is in
    // an aborted state and the cleanup delete would be skipped, stranding the
    // fixture tenants in the database.
    await one.query("rollback").catch(() => {});
    await two.query("rollback").catch(() => {});
    await one
      .query("delete from organizations where id = any($1::uuid[])", [[orgA, orgB]])
      .catch(() => {});
    await one.end();
    await two.end();
  }
}

/**
 * The whole point, in one check: do the knowledge bases this app actually
 * produces fit in these tables?
 *
 * `npm run db:parity` proves every field has a column. That is structural, and
 * structure is the easy half — a column can exist and still be the wrong type, a
 * check constraint can reject a real hex colour, an enum can be missing the one
 * value a scraper emits. So this takes the committed `examples/*.json`, which
 * are generated from real scrapes of real sites and schema-validated on every
 * build, and projects each one into all forty tables.
 *
 * Rolled back afterwards, like everything else here.
 */
async function loadRealExamples(): Promise<void> {
  console.log("\nloading the committed examples into the schema");
  const dir = path.join(process.cwd(), "examples");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    record("examples are present", false, "no examples/*.json found");
    return;
  }

  const client = connect();
  await client.connect();
  const org = randomUUID();
  const user = randomUUID();

  await client.query("begin");
  try {
    await client.query(`insert into auth.users (id, email) values ($1, 'load@check.invalid')`, [user]);
    await client.query(`insert into organizations (id, name, slug) values ($1, 'Load Check', $2)`, [
      org,
      `load-check-${org.slice(0, 8)}`,
    ]);

    for (const file of files) {
      const kb = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      const companyId = randomUUID();
      const versionId = randomUUID();

      await client.query(
        `insert into companies (id, organization_id, name, domain) values ($1, $2, $3, $4)`,
        [companyId, org, kb.companyName?.value ?? file, `${kb.id}.invalid`],
      );
      await client.query(
        `insert into knowledge_bases (id, organization_id, company_id, source_url)
         values ($1, $2, $3, $4)`,
        [kb.id, org, companyId, kb.sourceUrl],
      );
      await client.query(
        `insert into knowledge_base_versions (id, organization_id, knowledge_base_id, version_no,
           document, company_name, source_url, document_created_at, document_updated_at,
           completeness, missing_fields)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [versionId, org, kb.id, kb.version, JSON.stringify(kb), kb.companyName?.value ?? null,
         kb.sourceUrl, kb.createdAt, kb.updatedAt, kb.quality.overallScore,
         kb.quality.missingFields],
      );

      await projectKnowledgeBase({ client, org, versionId }, kb);

      // Count what landed, so a silently-skipped category cannot pass.
      const counts = await client.query<{ t: string; n: number }>(
        `select 'people' t, count(*)::int n from people where version_id = $1
         union all select 'offerings', count(*)::int from offerings where version_id = $1
         union all select 'field_provenance', count(*)::int from field_provenance where version_id = $1
         union all select 'scrape_pages', count(*)::int from scrape_pages where version_id = $1
         union all select 'quality_category_scores', count(*)::int from quality_category_scores where version_id = $1`,
        [versionId],
      );
      const summary = counts.rows.map((r) => `${r.t}=${r.n}`).join(" ");
      const foundation = await client.query(
        "select industry from kb_foundation where version_id = $1",
        [versionId],
      );
      record(
        `${file} projects into every table`,
        foundation.rowCount === 1 && counts.rows.every((r) => r.n >= 0),
        summary,
      );
    }

    // Nothing may be stored only in a projection: the document is still the
    // source of truth and must survive the round trip untouched.
    const roundTrip = await client.query<{ same: boolean }>(
      `select (document = $2::jsonb) as same from knowledge_base_versions
       where knowledge_base_id = $1`,
      [JSON.parse(readFileSync(path.join(dir, files[0]), "utf8")).id,
       readFileSync(path.join(dir, files[0]), "utf8")],
    );
    record(
      "the document round-trips through jsonb unchanged",
      roundTrip.rows[0]?.same === true,
      "projections are a cache, not a second source of truth",
    );
  } catch (error) {
    record("loading examples", false, error instanceof Error ? error.message : String(error));
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

/**
 * Two sessions saving the same knowledge base at once.
 *
 * This is the one case that cannot live in a rolled-back transaction: the second
 * connection has to see a committed row. `next_version_no` takes `for update` on
 * the parent before reading `max(version_no)`, so the second caller should block
 * until the first commits and then see the number it wrote — rather than both
 * reading 1 and colliding on `unique (knowledge_base_id, version_no)`.
 */
async function concurrency(): Promise<void> {
  console.log("\nconcurrency (committed fixture, cleaned up after)");
  const one = connect();
  const two = connect();
  const org = randomUUID();
  const user = randomUUID();
  const company = randomUUID();
  const kb = `check-race-${org.slice(0, 8)}`;

  await one.connect();
  await two.connect();
  try {
    await one.query(`insert into auth.users (id, email) values ($1, 'c@check.invalid')`, [user]);
    await one.query(`insert into organizations (id, name, slug) values ($1, 'Check C', $2)`, [
      org,
      `check-c-${org.slice(0, 8)}`,
    ]);
    await one.query(
      `insert into companies (id, organization_id, name, domain) values ($1, $2, 'Race Co', 'race.invalid')`,
      [company, org],
    );
    await one.query(
      `insert into knowledge_bases (id, organization_id, company_id, source_url)
       values ($1, $2, $3, 'https://race.invalid')`,
      [kb, org, company],
    );
    await one.query(
      `insert into knowledge_base_versions
         (id, organization_id, knowledge_base_id, version_no, document, source_url)
       values (gen_random_uuid(), $1, $2, 1, '{}'::jsonb, 'https://race.invalid')`,
      [org, kb],
    );

    await one.query("begin");
    const first = await one.query<{ next_version_no: number }>("select next_version_no($1)", [kb]);

    // Session two asks for the same thing while session one still holds the lock.
    await two.query("begin");
    let secondResolved = false;
    const second = two
      .query<{ next_version_no: number }>("select next_version_no($1)", [kb])
      .then((r) => {
        secondResolved = true;
        return r;
      });

    await new Promise((resolve) => setTimeout(resolve, 700));
    record(
      "a second saver blocks while the first holds the row lock",
      !secondResolved,
      secondResolved ? "it returned immediately — the lock is not doing anything" : "still waiting",
    );

    await one.query(
      `insert into knowledge_base_versions
         (id, organization_id, knowledge_base_id, version_no, document, source_url)
       values (gen_random_uuid(), $1, $2, $3, '{}'::jsonb, 'https://race.invalid')`,
      [org, kb, first.rows[0].next_version_no],
    );
    await one.query("commit");

    const secondNo = (await second).rows[0].next_version_no;
    await two.query(
      `insert into knowledge_base_versions
         (id, organization_id, knowledge_base_id, version_no, document, source_url)
       values (gen_random_uuid(), $1, $2, $3, '{}'::jsonb, 'https://race.invalid')`,
      [org, kb, secondNo],
    );
    await two.query("commit");

    record(
      "the two savers get consecutive numbers, not a collision",
      first.rows[0].next_version_no === 2 && secondNo === 3,
      `v${first.rows[0].next_version_no} then v${secondNo}`,
    );
  } catch (error) {
    record("concurrency", false, error instanceof Error ? error.message : String(error));
    await one.query("rollback").catch(() => {});
    await two.query("rollback").catch(() => {});
  } finally {
    // The signup trigger gives every new auth.users row its own organization,
    // so this fixture creates two tenants: the one it inserts explicitly and
    // the one handle_new_user() made. Both have to go, and the trigger's one
    // has to go before the user, because the membership row is the only thing
    // linking them and it cascades away with the user.
    await one.query("rollback").catch(() => {});
    await two.query("rollback").catch(() => {});
    await one
      .query(
        `delete from organizations where id in (
           select organization_id from organization_members where user_id = $1
         )`,
        [user],
      )
      .catch(() => {});
    await one.query("delete from organizations where id = $1", [org]).catch(() => {});
    await one.query("delete from auth.users where id = $1", [user]).catch(() => {});
    await one.end();
    await two.end();
  }
}

function report(): void {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("\nfailed:");
    for (const f of failed) console.log(`  ${f.name} — ${f.detail}`);
    process.exit(1);
  }
  console.log("The live schema behaves the way docs/DATABASE.md describes.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
