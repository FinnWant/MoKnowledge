import { knowledgeBaseSchema } from "@/lib/schema";
import type { ClientBase } from "pg";
import { projectKnowledgeBase } from "./project";

/**
 * Rebuilds the normalized tables for one version from its stored `document`.
 *
 * docs/DATABASE.md §3 argues that the projections are safe to duplicate because
 * the dependency is one-directional — the document is the source of truth, and
 * every projection row can be reproduced from it. This is the function that
 * makes that an operation rather than a claim, and it is what a projection
 * schema change actually costs: `alter table`, then replay.
 *
 * Deletes before it writes, so it is idempotent and so a column that no longer
 * exists in the document does not survive as a stale row.
 *
 * `knowledge_base_versions` is deliberately NOT touched: it is append-only, the
 * document is what we are rebuilding *from*, and a rebuild that could rewrite
 * its own source would not be a rebuild.
 */

/**
 * Every table written by `projectKnowledgeBase`, in an order that respects the
 * one foreign key between projections (candidates reference conflicts).
 *
 * Derived from the catalog at runtime rather than listed here, so a table added
 * to the projection cannot be forgotten — the same reasoning as the policy and
 * trigger loops in the schema.
 */
async function projectionTables(client: ClientBase): Promise<string[]> {
  const { rows } = await client.query<{ tablename: string }>(
    `select c.relname as tablename
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'version_id'
     where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and a.attnotnull
     order by c.relname`,
  );
  return rows.map((row) => row.tablename);
}

export type RebuildResult = {
  versionId: string;
  tables: number;
  /** Rows deleted before the replay, and rows written by it. Equal on a clean
   *  rebuild; a difference means the projection and the document had drifted,
   *  which is the thing worth noticing. */
  removed: number;
  rows: number;
};

export async function rebuildProjections(
  client: ClientBase,
  versionId: string,
): Promise<RebuildResult> {
  const { rows } = await client.query<{ document: unknown; organization_id: string }>(
    "select document, organization_id from knowledge_base_versions where id = $1",
    [versionId],
  );
  if (rows.length === 0) throw new Error(`No such version: ${versionId}`);

  // Validated on the way out of the database for the same reason `get()`
  // validates: a rebuild that faithfully reprojects a corrupt document has
  // spread the corruption across forty tables.
  const document = knowledgeBaseSchema.parse(rows[0].document);
  const org = rows[0].organization_id;

  const tables = await projectionTables(client);
  let removed = 0;
  for (const table of tables) {
    const result = await client.query(`delete from ${table} where version_id = $1`, [versionId]);
    removed += result.rowCount ?? 0;
  }

  await projectKnowledgeBase({ client, org, versionId }, document);

  let written = 0;
  for (const table of tables) {
    const { rows: counted } = await client.query<{ n: string }>(
      `select count(*) as n from ${table} where version_id = $1`,
      [versionId],
    );
    written += Number(counted[0].n);
  }

  return { versionId, tables: tables.length, removed, rows: written };
}

/** Every version of one knowledge base, oldest first. */
export async function rebuildKnowledgeBase(
  client: ClientBase,
  knowledgeBaseId: string,
): Promise<RebuildResult[]> {
  const { rows } = await client.query<{ id: string }>(
    `select id from knowledge_base_versions
     where knowledge_base_id = $1 order by version_no asc`,
    [knowledgeBaseId],
  );
  const results: RebuildResult[] = [];
  for (const row of rows) results.push(await rebuildProjections(client, row.id));
  return results;
}

/** Every version in one tenant. */
export async function rebuildOrganization(
  client: ClientBase,
  organizationId: string,
): Promise<RebuildResult[]> {
  const { rows } = await client.query<{ id: string }>(
    `select id from knowledge_base_versions
     where organization_id = $1 order by knowledge_base_id, version_no asc`,
    [organizationId],
  );
  const results: RebuildResult[] = [];
  for (const row of rows) results.push(await rebuildProjections(client, row.id));
  return results;
}
