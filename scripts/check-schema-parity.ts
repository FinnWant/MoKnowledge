import { Client } from "pg";
import { z } from "zod";

import { loadEnv } from "./env";
import { PROVENANCE_COLUMNS, SCHEMA_MAP } from "./schema-map";

/**
 * `npm run db:parity` — is every field of the knowledge base actually storable?
 *
 * The bonus challenge asks for a database structure for the knowledge base
 * system. "Structure" is only meaningful if it covers the thing it stores, and
 * a schema that tables four categories and leaves five inside a jsonb blob
 * passes every test you can write about the four.
 *
 * So this walks `knowledgeBaseSchema` in lib/schema/ — the single source of
 * truth every type in the app is inferred from — enumerates every storable path,
 * and checks three things:
 *
 *   1. every path is mapped in scripts/schema-map.ts
 *   2. every mapped column exists in the live database
 *   3. every zod enum's values all exist in its PostgreSQL enum
 *
 * (3) is not paranoia. `offering_category` shipped with five of its eight
 * values, so an offering classified `consultation` would have been rejected at
 * save time, by a schema that had been reviewed and looked right.
 *
 * Read-only: it opens one connection and runs three catalog queries.
 */

loadEnv(".env.local", ".env");

type Failure = { kind: string; detail: string };
const failures: Failure[] = [];
const looseEnums: string[] = [];
let checked = 0;

/* ------------------------------------------------ walking the zod schema */

/**
 * The subset of JSON Schema `z.toJSONSchema` emits for this schema. Narrow on
 * purpose: anything not described here is something the walker should not be
 * silently tolerating.
 */
type Node = {
  type?: string;
  enum?: unknown[];
  anyOf?: Node[];
  items?: Node;
  properties?: Record<string, Node>;
};

function unwrapNullable(node: Node | undefined): Node {
  if (!node) return {};
  if (node.anyOf) {
    const nonNull = node.anyOf.filter((n) => n.type !== "null");
    return nonNull.length === 1 ? nonNull[0] : { anyOf: nonNull };
  }
  return node;
}

/** The `Sourced<T>` envelope, recognised by shape rather than by name. */
function isSourced(node: Node): boolean {
  const p = node.properties;
  return Boolean(p && p.value && p.method && p.confidence && p.sourceUrls);
}

export type Leaf = {
  path: string;
  type: string;
  isCollection: boolean;
  /** Present when the field is an enum, inline or named. */
  enumValues?: string[];
};

/**
 * `record()` items carry RecordProvenance inline; other object arrays do not.
 * `quality.followUpQuestions[].id` and `conflicts[].candidates[].confidence` are
 * real fields that happen to share a name with a provenance column, so the test
 * has to tell the two apart by shape rather than by name.
 */
function isRecordProvenance(item: Node): boolean {
  const p = item.properties;
  return Boolean(p && p.id && p.method && p.confidence && p.sourceUrls);
}

export function enumerateLeaves(): Leaf[] {
  const json = z.toJSONSchema(knowledgeBaseSchemaRef(), {
    io: "output",
    unrepresentable: "any",
  }) as Node;
  const leaves: Leaf[] = [];

  function walk(input: Node | undefined, path: string): void {
    const node = unwrapNullable(input);

    // A Sourced<T> wrapper contributes no path of its own: the value is stored
    // and the envelope goes to field_provenance.
    if (isSourced(node)) {
      walk(node.properties?.value, path);
      return;
    }

    if (node.type === "array") {
      const item = unwrapNullable(node.items);
      if (item.type === "object" && item.properties) {
        leaves.push({ path, type: "collection", isCollection: true });
        const carriesProvenance = isRecordProvenance(item);
        for (const key of Object.keys(item.properties)) {
          if (carriesProvenance && (PROVENANCE_COLUMNS as readonly string[]).includes(key)) {
            continue;
          }
          walk(item.properties[key], `${path}[].${key}`);
        }
        return;
      }
      leaves.push({
        path,
        type: `array<${item.type ?? "unknown"}>`,
        isCollection: false,
        ...(Array.isArray(item.enum) ? { enumValues: item.enum as string[] } : {}),
      });
      return;
    }

    if (node.type === "object" && node.properties) {
      for (const key of Object.keys(node.properties)) {
        walk(node.properties[key], `${path}.${key}`);
      }
      return;
    }

    leaves.push({
      path,
      type: node.type ?? "unknown",
      isCollection: false,
      ...(Array.isArray(node.enum) ? { enumValues: node.enum as string[] } : {}),
    });
  }

  for (const key of Object.keys(json.properties ?? {})) walk(json.properties?.[key], key);
  return leaves;
}

// Imported lazily so this file can be unit-tested without a database.
function knowledgeBaseSchemaRef(): z.ZodType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { knowledgeBaseSchema } = require("@/lib/schema");
  return knowledgeBaseSchema;
}

/* ---------------------------------------------------------------- checks */

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

  const columns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
  }>(
    `select table_name, column_name, data_type, udt_name
     from information_schema.columns where table_schema = 'public'`,
  );
  const columnSet = new Map<string, string>();
  const udtNames = new Map<string, string>();
  for (const row of columns.rows) {
    columnSet.set(`${row.table_name}.${row.column_name}`, row.data_type);
    udtNames.set(`${row.table_name}.${row.column_name}`, row.udt_name);
  }

  const pgEnums = await client.query<{ typname: string; values: string[] }>(
    `select t.typname, array_agg(e.enumlabel::text order by e.enumsortorder) as values
     from pg_type t
     join pg_enum e on e.enumtypid = t.oid
     join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
     group by t.typname`,
  );
  const enumValues = new Map(pgEnums.rows.map((r) => [r.typname, r.values]));
  await client.end();

  // ---------------------------------------------------------- 1 + 2
  console.log("every knowledge base field has somewhere to live");
  const leaves = enumerateLeaves();
  const unmapped: string[] = [];
  const missingColumns: string[] = [];

  for (const leaf of leaves) {
    const placement = SCHEMA_MAP[leaf.path];
    checked += 1;
    if (!placement) {
      unmapped.push(leaf.path);
      continue;
    }
    if (placement.kind === "elsewhere") continue;
    const key = `${placement.table}.${placement.column}`;
    if (!columnSet.has(key)) missingColumns.push(`${leaf.path} -> ${key}`);
  }

  if (unmapped.length > 0) {
    failures.push({
      kind: "unmapped field",
      detail:
        `${unmapped.length} path(s) in lib/schema/ have no entry in scripts/schema-map.ts:\n    ` +
        unmapped.join("\n    "),
    });
  }
  if (missingColumns.length > 0) {
    failures.push({
      kind: "missing column",
      detail:
        `${missingColumns.length} mapped column(s) do not exist in the database:\n    ` +
        missingColumns.join("\n    "),
    });
  }
  console.log(
    `  ${unmapped.length === 0 && missingColumns.length === 0 ? "PASS" : "FAIL"}  ` +
      `${leaves.length} paths, ${leaves.filter((l) => l.isCollection).length} collections`,
  );

  // ------------------------------------------------------- 3. enums
  //
  // Derived from the schema walk rather than from a list of named exports.
  // Several of these enums are declared inline (`kind: z.enum([...])` inside
  // guaranteeSchema, pressMentionSchema, personSchema.gender, writingStyle's
  // formality and readerAddress), so a map of exported enum schemas would check
  // the easy half and quietly skip the rest. Going through the column means an
  // enum cannot escape by not having a name.
  console.log("\nevery enum value the app can produce exists in PostgreSQL");
  let enumsCompared = 0;
  let enumFailures = 0;

  for (const leaf of leaves) {
    if (!leaf.enumValues) continue;
    const placement = SCHEMA_MAP[leaf.path];
    if (!placement || placement.kind === "elsewhere") continue;

    const udt = udtNames.get(`${placement.table}.${placement.column}`);
    if (!udt) continue;
    // `tone tone[]` arrives as udt_name `_tone`.
    const enumName = udt.startsWith("_") ? udt.slice(1) : udt;
    const pgValues = enumValues.get(enumName);
    if (!pgValues) {
      // The column is a plain text/int type. That is a deliberate choice in a
      // few places (testimonials.platform is free text on purpose), so it is
      // reported rather than failed.
      looseEnums.push(`${leaf.path} -> ${placement.table}.${placement.column} (${udt})`);
      continue;
    }

    enumsCompared += 1;
    checked += 1;
    const missing = leaf.enumValues.filter((v) => !pgValues.includes(v));
    const extra = pgValues.filter((v) => !leaf.enumValues!.includes(v));
    if (missing.length > 0 || extra.length > 0) {
      enumFailures += 1;
      failures.push({
        kind: "enum drift",
        detail:
          `${leaf.path} -> ${enumName}:` +
          (missing.length ? ` missing in PostgreSQL [${missing.join(", ")}]` : "") +
          (extra.length ? ` not in zod [${extra.join(", ")}]` : ""),
      });
    }
  }
  console.log(
    `  ${enumFailures === 0 ? "PASS" : "FAIL"}  ${enumsCompared} enum columns compared value by value`,
  );
  if (looseEnums.length > 0) {
    console.log(`  note  ${looseEnums.length} enum field(s) stored as free text by design:`);
    for (const l of looseEnums) console.log(`          ${l}`);
  }

  // ---------------------------------------------- unused map entries
  const leafPaths = new Set(leaves.map((l) => l.path));
  const stale = Object.keys(SCHEMA_MAP).filter((p) => !leafPaths.has(p));
  console.log("\nthe map has no entries for fields that no longer exist");
  if (stale.length > 0) {
    failures.push({
      kind: "stale mapping",
      detail: `${stale.length} entr(ies) map paths not in the schema:\n    ` + stale.join("\n    "),
    });
  }
  console.log(`  ${stale.length === 0 ? "PASS" : "FAIL"}  ${Object.keys(SCHEMA_MAP).length} entries`);

  report();
}

function report(): void {
  if (failures.length === 0) {
    console.log(
      `\n${checked} checks passed. Every field in lib/schema/ has a typed column in supabase/schema.sql.`,
    );
    return;
  }
  console.log(`\n${failures.length} failure(s):\n`);
  for (const f of failures) console.log(`  ${f.kind}: ${f.detail}\n`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
