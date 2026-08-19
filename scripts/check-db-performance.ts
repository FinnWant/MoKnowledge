import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

import { loadEnv } from "./env";
import { projectKnowledgeBase } from "@/lib/storage/supabase/project";

/**
 * `npm run db:perf` — are the 144 indexes doing anything?
 *
 * Every other check in this repo runs against three example documents, where
 * PostgreSQL will sequentially scan everything regardless because the tables fit
 * in a page or two. That proves correctness and says nothing about the shape of
 * the plan, which is the entire reason the projection tables exist: "which of
 * our clients offer emergency service" is supposed to be an index lookup, not a
 * scan of every offering of every version of every company.
 *
 * So this seeds a tenant to a realistic size — the agency case from R27, forty
 * companies with a few versions each — runs the queries the design is built
 * around, and asserts on the plan rather than the wall clock. Timings on a
 * shared pooler tell you about the neighbours; `Seq Scan on offerings` tells you
 * about the schema.
 *
 * Everything is torn down at the end, including on failure.
 */

loadEnv(".env.local", ".env");

const COMPANIES = Number(process.env.PERF_COMPANIES ?? 40);
const VERSIONS_EACH = Number(process.env.PERF_VERSIONS ?? 3);

type Check = { name: string; ok: boolean; detail: string };
const results: Check[] = [];

function record(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** The plan as one string, so it can be searched for the shapes that matter. */
async function plan(client: Client, sql: string, values: unknown[]): Promise<string> {
  const { rows } = await client.query<{ "QUERY PLAN": string }>(
    `explain (analyze, buffers, format text) ${sql}`,
    values,
  );
  return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

/**
 * What this can and cannot assert.
 *
 * A sequential scan is not a bug on a small table — it is the right plan, and
 * at the sizes any test can reasonably seed, most of these tables are small.
 * Asserting "no Seq Scan" here would just be asserting that the seed is big,
 * and the first version of this file did exactly that and failed on a schema
 * that was fine.
 *
 * What is worth asserting is that the index the design depends on is APPLICABLE
 * to the query it was built for: right columns, right order, right operator
 * class, right partial-index predicate. `enable_seqscan = off` makes the planner
 * show which index it would reach for, and naming the expected index catches the
 * failures that matter — an index that cannot serve the predicate at all, or a
 * query that silently drifted away from the index built for it.
 *
 * Whether the planner picks it *today* is reported, not asserted: that is a
 * function of table size, and it will change the day this has real data in it.
 */
async function indexPlan(
  client: Client,
  sql: string,
  values: unknown[],
): Promise<{ forced: string; natural: string }> {
  const natural = await plan(client, sql, values);
  await client.query("set enable_seqscan = off");
  const forced = await plan(client, sql, values);
  await client.query("set enable_seqscan = on");
  return { forced, natural };
}

function scansTable(planText: string, table: string): boolean {
  return new RegExp(`Seq Scan on (public\\.)?${table}\\b`).test(planText);
}

/** Reports whether the planner chose an index unaided, for context only. */
function naturalChoice(planText: string, table: string): string {
  return scansTable(planText, table)
    ? "seq scan at this size, as expected"
    : "index-scanned even at this size";
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("SUPABASE_DB_URL is not set — see README, 'Optional: Supabase persistence'.");
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();

  const org = randomUUID();
  const otherOrg = randomUUID();
  const user = randomUUID();

  try {
    const dir = path.join(process.cwd(), "examples");
    const documents = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
    if (documents.length === 0) throw new Error("no examples/*.json to seed from");

    console.log(`seeding ${COMPANIES} companies × ${VERSIONS_EACH} versions`);
    await client.query(`insert into auth.users (id, email) values ($1, 'perf@check.invalid')`, [
      user,
    ]);
    // The trigger gives that user an organization; these are the ones we drive.
    await client.query(
      `insert into organizations (id, name, slug) values ($1, 'Perf', $2), ($3, 'Perf Other', $4)`,
      [org, `perf-${org.slice(0, 8)}`, otherOrg, `perf-other-${otherOrg.slice(0, 8)}`],
    );
    await client.query(
      `insert into organization_members (organization_id, user_id, role) values ($1, $2, 'editor')`,
      [org, user],
    );

    // Seeding set-based, not row by row.
    //
    // Projecting each document individually is ~250 inserts, and 120 versions of
    // that is 30,000 round trips through the pooler — minutes of waiting, and
    // rude to a shared endpoint. Instead: project ONE document properly, so the
    // rows are real, then fan it out with one `insert … select` per table per
    // batch. Same row shapes, same indexes exercised, ~40 statements instead of
    // 30,000.
    const template = documents[0];
    const templateKb = `perf-template-${org.slice(0, 8)}`;
    const templateCompany = randomUUID();
    await client.query(
      `insert into companies (id, organization_id, name, domain) values ($1, $2, 'Perf Template', $3)`,
      [templateCompany, org, `perf-template.invalid`],
    );
    await client.query(
      `insert into knowledge_bases (id, organization_id, company_id, source_url)
       values ($1, $2, $3, 'https://perf-template.invalid')`,
      [templateKb, org, templateCompany],
    );
    const { rows: templateVersion } = await client.query<{ id: string }>(
      `insert into knowledge_base_versions
         (organization_id, knowledge_base_id, version_no, document, company_name, source_url,
          document_created_at, document_updated_at, completeness, keywords)
       values ($1,$2,1,$3,'Perf Template','https://perf-template.invalid',now(),now(),0.5,
               array['perf'])
       returning id`,
      [org, templateKb, JSON.stringify(template)],
    );
    const templateVersionId = templateVersion[0].id;
    await client.query("update knowledge_bases set current_version_id = $1 where id = $2", [
      templateVersionId,
      templateKb,
    ]);
    await projectKnowledgeBase({ client, org, versionId: templateVersionId }, template);

    // Every table the projection writes, and the columns to copy.
    //
    // Two exclusions matter. `version_id` and `organization_id` are rewritten
    // per target. And any column defaulting to gen_random_uuid() is dropped so
    // the default generates a fresh one — those are the tables whose primary key
    // is a surrogate (addresses, scrape_pages, …), and copying the template's
    // value would collide on the first duplicate. Record tables keyed
    // (version_id, id) keep their id: sharing it across versions is the point.
    //
    // Ordered so a table that references another projection table is inserted
    // after it — quality_conflict_candidates points at quality_conflicts, and
    // sorts before it alphabetically.
    const { rows: projectionTables } = await client.query<{ tablename: string; cols: string[] }>(
      `select c.relname as tablename,
              array_agg(a2.attname::text order by a2.attnum) as cols
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attname = 'version_id'
       join pg_attribute a2 on a2.attrelid = c.oid and a2.attnum > 0 and not a2.attisdropped
                            and a2.attname not in ('version_id', 'organization_id')
                            and not exists (
                              select 1 from pg_attrdef d
                              where d.adrelid = c.oid and d.adnum = a2.attnum
                                and pg_get_expr(d.adbin, d.adrelid) like '%gen_random_uuid%'
                            )
       where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and a.attnotnull
       group by c.relname, c.oid
       order by (
         select count(*) from pg_constraint fk
         where fk.conrelid = c.oid and fk.contype = 'f'
           and fk.confrelid not in (
             'knowledge_base_versions'::regclass, 'organizations'::regclass
           )
       ), c.relname`,
    );

    const targets: string[] = [];
    let versionCount = 1;
    for (let c = 0; c < COMPANIES; c += 1) {
      const owner = c % 8 === 0 ? otherOrg : org;
      const companyId = randomUUID();
      const kbId = `perf-kb-${c}-${org.slice(0, 6)}`;

      await client.query(
        `insert into companies (id, organization_id, name, domain) values ($1, $2, $3, $4)`,
        [companyId, owner, `Perf Company ${c}`, `perf-${c}.invalid`],
      );
      await client.query(
        `insert into knowledge_bases (id, organization_id, company_id, source_url)
         values ($1, $2, $3, $4)`,
        [kbId, owner, companyId, `https://perf-${c}.invalid`],
      );

      let current: string | null = null;
      for (let v = 1; v <= VERSIONS_EACH; v += 1) {
        const { rows } = await client.query<{ id: string }>(
          `insert into knowledge_base_versions
             (organization_id, knowledge_base_id, version_no, document, company_name,
              source_url, document_created_at, document_updated_at, completeness, keywords)
           values ($1,$2,$3,$4,$5,$6,now(),now() - make_interval(hours => $3),$7,$8)
           returning id`,
          [
            owner, kbId, v, JSON.stringify({ ...template, id: kbId, version: v }),
            `Perf Company ${c}`, `https://perf-${c}.invalid`, 0.5,
            ["perf", `company-${c}`],
          ],
        );
        targets.push(rows[0].id);
        current = rows[0].id;
        versionCount += 1;
      }
      await client.query("update knowledge_bases set current_version_id = $1 where id = $2", [
        current,
        kbId,
      ]);
    }

    // The fan-out. `organization_id` is taken from the target version rather
    // than the template, so the tenant guard trigger agrees with the parent —
    // which also means this seeds both tenants correctly.
    for (const table of projectionTables) {
      const cols = table.cols.map((c) => `"${c}"`).join(", ");
      await client.query(
        `insert into ${table.tablename} (${cols}, version_id, organization_id)
         select ${table.cols.map((c) => `src."${c}"`).join(", ")}, v.id, v.organization_id
         from ${table.tablename} src
         cross join (
           select id, organization_id from knowledge_base_versions where id = any($1::uuid[])
         ) v
         where src.version_id = $2`,
        [targets, templateVersionId],
      );
    }

    // The examples all classify their offerings as `service`, so a fanned-out
    // copy gives every row the same category — and a predicate that matches
    // everything makes the composite (organization_id, category) index no better
    // than the organization_id one, which is a fact about the fixture rather
    // than about the schema. Spreading the categories restores the selectivity
    // the index exists for, and incidentally exercises all eight enum values at
    // volume.
    await client.query(
      `update offerings
          set category = (enum_range(null::offering_category))[
            1 + (abs(hashtext(id || version_id::text)) % 8)
          ]`,
    );

    const sizes = await client.query<{ offerings: string; provenance: string; people: string }>(
      `select (select count(*) from offerings) as offerings,
              (select count(*) from field_provenance) as provenance,
              (select count(*) from people) as people`,
    );
    console.log(
      `  seeded ${versionCount} versions — ${sizes.rows[0].offerings} offerings, ` +
        `${sizes.rows[0].people} people, ${sizes.rows[0].provenance} provenance rows`,
    );

    // Planner statistics are what decide index-vs-scan, and they are stale by
    // definition right after a bulk insert. Without this the run measures
    // autovacuum's timing rather than the schema.
    await client.query("analyze");

    console.log("\nevery design-critical query has an applicable index");

    const cases: Array<{
      name: string;
      index: string;
      table: string;
      sql: string;
      values: unknown[];
    }> = [
      {
        name: "'which clients offer X' -> offerings_category_idx",
        index: "offerings_category_idx",
        table: "offerings",
        sql: `select o.name, o.version_id from offerings o
              where o.organization_id = $1 and o.category = 'financing' limit 50`,
        values: [org],
      },
      {
        name: "the review queue -> field_provenance_method_idx",
        index: "field_provenance_method_idx",
        table: "field_provenance",
        sql: `select path, count(*) from field_provenance
              where organization_id = $1 and method in ('ai-live', 'ai-mock')
              group by path order by count(*) desc limit 20`,
        values: [org],
      },
      {
        name: "'which clients have a stale blog' -> the partial index",
        index: "kb_cadence_stale_idx",
        table: "kb_cadence",
        sql: `select version_id from kb_cadence
              where organization_id = $1 and is_stale limit 20`,
        values: [org],
      },
      {
        name: "people search -> the trigram index",
        index: "people_name_trgm_idx",
        table: "people",
        sql: `select name from people
              where organization_id = $1 and name ilike '%ann%' limit 20`,
        values: [org],
      },
      {
        name: "library search over keywords -> the GIN index",
        index: "kb_versions_keywords_idx",
        table: "knowledge_base_versions",
        // A keyword one company has, not the one every row shares: an index is
        // only reachable for a predicate that actually narrows anything.
        sql: `select id from knowledge_base_versions
              where organization_id = $1 and keywords && array['company-7'] limit 20`,
        values: [org],
      },
      {
        name: "a tenant's knowledge bases -> knowledge_bases_org_idx",
        index: "knowledge_bases_org_idx",
        table: "knowledge_bases",
        sql: `select id from knowledge_bases where organization_id = $1 limit 50`,
        values: [org],
      },
    ];

    for (const item of cases) {
      const { forced, natural } = await indexPlan(client, item.sql, item.values);
      record(
        item.name,
        forced.includes(item.index),
        forced.includes(item.index)
          ? naturalChoice(natural, item.table)
          : `expected ${item.index}; planner reached for: ${indexesIn(forced) || "nothing"}`,
      );
    }

    // The library grid is a view over four joins, so the assertion that matters
    // is not which index it picks but that it never touches a `document`.
    const library = await plan(
      client,
      `select * from knowledge_base_summaries where organization_id = $1
       order by updated_at desc limit 24`,
      [org],
    );
    record(
      "the library grid reads no document jsonb",
      !/\bdocument\b/i.test(library),
      "KnowledgeBaseSummary is served entirely from columns",
    );

    console.log("\nRLS overhead");

    // The reason is_member is STABLE: a VOLATILE function would be called once
    // per row, turning every policy into a per-row subquery.
    const volatility = await client.query<{ provolatile: string }>(
      "select provolatile from pg_proc where proname = 'is_member'",
    );
    record(
      "is_member is STABLE, so the planner calls it once per query",
      volatility.rows[0]?.provolatile === "s",
      `provolatile=${volatility.rows[0]?.provolatile}`,
    );

    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: user, role: "authenticated" }),
    ]);
    await client.query("set role authenticated");
    const underRls = await plan(
      client,
      `select id from knowledge_bases where organization_id = $1 limit 50`,
      [org],
    );
    await client.query("reset role");

    // The policy must not turn into a per-row subquery. A correlated
    // `SubPlan`/`InitPlan` over organization_members is what that looks like in
    // a plan, and it is what STABLE + SECURITY DEFINER on is_member prevents.
    record(
      "the policy adds a filter, not a per-row subquery over memberships",
      !/SubPlan/.test(underRls) && !scansTable(underRls, "organization_members"),
      /SubPlan/.test(underRls) ? "SubPlan present" : "one filter, evaluated once",
    );
  } catch (error) {
    record("performance run", false, error instanceof Error ? error.message : String(error));
  } finally {
    await client.query("reset role").catch(() => {});
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

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("\nThese are plan-shape regressions, not slow queries:");
    for (const f of failed) console.log(`  ${f.name} — ${f.detail}`);
    process.exit(1);
  }
}

/** Index names the plan mentions, for a failure message that says something. */
function indexesIn(planText: string): string {
  const names = new Set(
    [...planText.matchAll(/using ([a-z0-9_]+)/g)].map((match) => match[1]),
  );
  return [...names].join(", ");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
