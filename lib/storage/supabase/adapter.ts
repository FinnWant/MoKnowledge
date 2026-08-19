import {
  knowledgeBaseSchema,
  knowledgeBaseSummarySchema,
  type KnowledgeBase,
  type KnowledgeBaseSummary,
} from "@/lib/schema";
import { registrableDomain } from "@/lib/utils/url";
import { toSummary, type SavedVersion, type StorageAdapter } from "../types";
import type { PoolClient } from "./pool";
import { projectKnowledgeBase } from "./project";
import { envTenant, withTenant, type TenantContext, type TenantResolver } from "./tenant";

/**
 * Knowledge bases in PostgreSQL, behind the same five methods as
 * `LocalJsonAdapter` (lib/storage/types.ts).
 *
 * The design it implements is docs/DATABASE.md. Two properties of that design
 * do most of the work here:
 *
 * - **`document` is the source of truth.** `get()` therefore returns the stored
 *   jsonb as-is. There is no reverse mapping from forty tables back into a
 *   KnowledgeBase, which is why this file is the size it is.
 * - **Versions are immutable.** `save()` never updates a row; it allocates the
 *   next version number under a lock, writes a new one, and moves a pointer.
 *
 * Every method goes through `withTenant`, so every statement runs inside a
 * transaction scoped to one organization. Reads included: that is what lets the
 * role be dropped to `authenticated` for the duration and unwound afterwards.
 */
export class SupabaseAdapter implements StorageAdapter {
  private readonly tenant: TenantResolver;

  constructor(tenant: TenantResolver = envTenant) {
    this.tenant = tenant;
  }

  async list(): Promise<KnowledgeBaseSummary[]> {
    return this.inTenant(async (client, tenant) => {
      const { rows } = await client.query<SummaryRow>(
        `select id, version_no, company_name, source_url, industry, logo_url, location,
                completeness, people_count, offerings_count, testimonials_count,
                attention_count, conflict_count, keywords, created_at, updated_at
         from knowledge_base_summaries
         where organization_id = $1 and version_no is not null
         order by updated_at desc`,
        [tenant.organizationId],
      );

      // Parsed rather than cast. The view is the one place where a schema change
      // could silently start returning a shape the app does not expect, and the
      // library grid would render "undefined" rather than fail.
      return rows.map((row) => knowledgeBaseSummarySchema.parse(toSummaryShape(row)));
    });
  }

  async get(id: string, version?: number): Promise<KnowledgeBase | null> {
    return this.inTenant(async (client, tenant) => {
      const { rows } = await client.query<{ document: unknown }>(
        version === undefined
          ? `select v.document
             from knowledge_bases kb
             join knowledge_base_versions v on v.id = kb.current_version_id
             where kb.id = $1 and kb.organization_id = $2`
          : `select v.document
             from knowledge_base_versions v
             join knowledge_bases kb on kb.id = v.knowledge_base_id
             where kb.id = $1 and kb.organization_id = $2 and v.version_no = $3`,
        version === undefined ? [id, tenant.organizationId] : [id, tenant.organizationId, version],
      );
      if (rows.length === 0) return null;

      // The same rule LocalJsonAdapter applies to a file on disk: whatever came
      // back is validated before the app sees it.
      const parsed = knowledgeBaseSchema.safeParse(rows[0].document);
      return parsed.success ? parsed.data : null;
    });
  }

  /**
   * Writes a new version and returns the knowledge base as stored.
   *
   * One transaction, in an order chosen so a crash is never worse than a
   * no-op: the version row and its projections all land before
   * `current_version_id` moves, so an interrupted save leaves an unreferenced
   * version rather than a pointer to something half-written.
   */
  async save(knowledgeBase: KnowledgeBase): Promise<KnowledgeBase> {
    return this.inTenant(async (client, tenant) => {
      const org = tenant.organizationId;
      const company = await this.resolveCompany(client, org, knowledgeBase);

      const existing = await client.query<{ created_at: string | null }>(
        `select document_created_at as created_at
         from knowledge_base_versions
         where knowledge_base_id = $1 and organization_id = $2
         order by version_no asc limit 1`,
        [knowledgeBase.id, org],
      );

      await client.query(
        `insert into knowledge_bases (id, organization_id, company_id, source_url)
         values ($1, $2, $3, $4)
         on conflict (id) do update
           set source_url = excluded.source_url, updated_at = now()`,
        [knowledgeBase.id, org, company, knowledgeBase.sourceUrl],
      );

      // Takes a row lock on the knowledge base before reading max(version_no),
      // so two saves in flight get consecutive numbers instead of colliding.
      const { rows: allocated } = await client.query<{ next_version_no: number }>(
        "select next_version_no($1)",
        [knowledgeBase.id],
      );
      const version = allocated[0].next_version_no;

      const now = new Date().toISOString();
      const stored: KnowledgeBase = {
        ...knowledgeBase,
        version,
        // Created once, by the first version; every later save preserves it.
        createdAt: existing.rows[0]?.created_at
          ? new Date(existing.rows[0].created_at).toISOString()
          : knowledgeBase.createdAt,
        updatedAt: now,
      };

      const rescraped = await this.isRescrape(client, stored, org);
      const summary = toSummary(stored);
      const versionId = await this.insertVersion(client, stored, {
        org,
        rescraped,
        summary,
      });

      await projectKnowledgeBase({ client, org, versionId }, stored);

      await client.query(
        `update knowledge_bases set current_version_id = $1, updated_at = $2
         where id = $3 and organization_id = $4`,
        [versionId, stored.updatedAt, stored.id, org],
      );

      return stored;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.inTenant(async (client, tenant) => {
      // Cascades take the versions and every projection with it. The
      // append-only trigger permits that because the parent is going too.
      const result = await client.query(
        "delete from knowledge_bases where id = $1 and organization_id = $2",
        [id, tenant.organizationId],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }

  async versions(id: string): Promise<SavedVersion[]> {
    return this.inTenant(async (client, tenant) => {
      const { rows } = await client.query<{
        version_no: number;
        saved_at: string | null;
        rescraped: boolean;
      }>(
        `select v.version_no, v.document_updated_at as saved_at, v.rescraped
         from knowledge_base_versions v
         join knowledge_bases kb on kb.id = v.knowledge_base_id
         where kb.id = $1 and kb.organization_id = $2
         order by v.version_no desc`,
        [id, tenant.organizationId],
      );

      return rows.map((row) => ({
        version: row.version_no,
        savedAt: row.saved_at ? new Date(row.saved_at).toISOString() : new Date(0).toISOString(),
        ...(row.rescraped ? { rescraped: true } : {}),
      }));
    });
  }

  /* --------------------------------------------------------------- private */

  private async inTenant<T>(
    work: (client: PoolClient, tenant: TenantContext) => Promise<T>,
  ): Promise<T> {
    return withTenant(await this.tenant(), work);
  }

  /**
   * Find-or-create the company this knowledge base belongs to.
   *
   * Keyed on the registrable domain, by the same function the crawler uses, so
   * `https://example.com/` and `https://www.example.com/about` are one client
   * rather than two rows in a library that is supposed to be per-company.
   */
  private async resolveCompany(
    client: PoolClient,
    org: string,
    knowledgeBase: KnowledgeBase,
  ): Promise<string> {
    let domain: string;
    try {
      domain = registrableDomain(new URL(knowledgeBase.sourceUrl).hostname);
    } catch {
      // A knowledge base whose source URL will not parse is still worth
      // storing; it just cannot be deduplicated by domain.
      domain = knowledgeBase.id;
    }

    const name = knowledgeBase.companyName.value?.trim() || domain;
    const { rows } = await client.query<{ resolve_company: string }>(
      "select resolve_company($1, $2, $3)",
      [org, domain, name],
    );
    return rows[0].resolve_company;
  }

  /**
   * Did this version come from a re-scrape rather than an edit?
   *
   * Derived, not declared, and derived the same way `LocalJsonAdapter.versions`
   * derives it: editing keeps the crawl the knowledge base was built from, so a
   * version whose crawl differs from its predecessor's is exactly a re-scraped
   * one. Computing it here rather than at read time means the flag is a stored
   * column the library can filter on without reading documents.
   */
  private async isRescrape(
    client: PoolClient,
    knowledgeBase: KnowledgeBase,
    org: string,
  ): Promise<boolean> {
    const { rows } = await client.query<{ started_at: string | null }>(
      `select document -> 'scrape' ->> 'startedAt' as started_at
       from knowledge_base_versions
       where knowledge_base_id = $1 and organization_id = $2
       order by version_no desc limit 1`,
      [knowledgeBase.id, org],
    );
    const previous = rows[0]?.started_at ?? null;
    return previous !== null && knowledgeBase.scrape.startedAt !== previous;
  }

  private async insertVersion(
    client: PoolClient,
    stored: KnowledgeBase,
    context: { org: string; rescraped: boolean; summary: KnowledgeBaseSummary },
  ): Promise<string> {
    const { org, rescraped, summary } = context;
    const { rows } = await client.query<{ id: string }>(
      `insert into knowledge_base_versions
         (organization_id, knowledge_base_id, version_no, document, company_name, source_url,
          document_created_at, document_updated_at, completeness, missing_fields,
          attention_count, conflict_count, keywords, rescraped, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       returning id`,
      [
        org,
        stored.id,
        stored.version,
        JSON.stringify(stored),
        summary.companyName,
        stored.sourceUrl,
        stored.createdAt,
        stored.updatedAt,
        summary.completeness,
        stored.quality.missingFields,
        summary.attentionCount,
        summary.conflictCount,
        summary.keywords,
        rescraped,
        // The version's author, when there is a session to attribute it to.
        (await this.tenant()).userId,
      ],
    );
    return rows[0].id;
  }
}

/* ----------------------------------------------------------- view mapping */

type SummaryRow = {
  id: string;
  version_no: number;
  company_name: string | null;
  source_url: string;
  industry: string | null;
  logo_url: string | null;
  location: string | null;
  /** `numeric` arrives as a string; `count(*)` as a bigint string. */
  completeness: string | null;
  people_count: string;
  offerings_count: string;
  testimonials_count: string;
  attention_count: number;
  conflict_count: number;
  keywords: string[];
  created_at: Date | string;
  updated_at: Date | string;
};

function toSummaryShape(row: SummaryRow): unknown {
  return {
    id: row.id,
    version: row.version_no,
    companyName: row.company_name,
    sourceUrl: row.source_url,
    industry: row.industry,
    logoUrl: row.logo_url,
    location: row.location,
    completeness: Number(row.completeness ?? 0),
    peopleCount: Number(row.people_count),
    offeringsCount: Number(row.offerings_count),
    testimonialsCount: Number(row.testimonials_count),
    attentionCount: row.attention_count,
    conflictCount: row.conflict_count,
    keywords: row.keywords,
    createdAt: isoOf(row.created_at),
    updatedAt: isoOf(row.updated_at),
  };
}

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
