import type { CrawlResult } from "@/lib/scraper/crawler";
import { authEnabled } from "@/lib/auth/config";
import { getPool } from "./pool";

/**
 * The crawl-attempt log — `scrape_jobs`, the one table that is not a projection
 * of a knowledge base.
 *
 * It is separate from the adapter on purpose: a job exists before a version
 * does, and often *instead* of one. A scrape that got blocked, timed out or
 * found nothing produces no knowledge base at all, and that row is the one you
 * most want to keep — it is the evidence for "this site blocks us" and what a
 * retry should consult before hammering the site again.
 *
 * Every function here is a no-op when Supabase is not configured, because the
 * scrape route has to keep working on a fresh clone with no credentials. A
 * failure to record a job never fails the scrape: telemetry that can take down
 * the thing it observes is worse than no telemetry.
 *
 * `scrape_jobs.knowledge_base_id` and `version_id` are left null. Filling them
 * would mean threading a job id from the scrape stream, through the draft the
 * user then edits, into the save request — a change to the API contract and to
 * the editing flow, for a link that answers a question nothing asks yet. The
 * columns are nullable precisely because a job frequently has no version, and
 * the operational value here ("which sites block us, and what did we tell the
 * user") is complete without them.
 */

export type ScrapeJobHandle = { id: string } | null;

/**
 * The tenant to file this crawl under, or null if there is nowhere to file it.
 *
 * The session when there is one, since a job belongs to whoever ran the scrape.
 * `SUPABASE_ORG_ID` remains as a fallback for a single-tenant deployment with
 * the database configured but no login — the state the app was in before auth
 * existed, and still a valid way to run it.
 */
async function jobTenant(): Promise<string | null> {
  if (!process.env.SUPABASE_DB_URL) return null;

  if (authEnabled()) {
    try {
      // Required lazily: this module is imported by the scrape route, which
      // must keep working with no Supabase configured at all.
      const { sessionTenant } = await import("@/lib/auth/tenant");
      return (await sessionTenant()).organizationId;
    } catch {
      // No session, or an account with no organization. Either way there is no
      // tenant to attribute the crawl to, and a scrape must not fail over it.
      return null;
    }
  }

  return process.env.SUPABASE_ORG_ID ?? null;
}

/** Records a crawl starting. Returns null when there is nothing to record to. */
export async function startScrapeJob(
  sourceUrl: string,
  scraperVersion: string,
): Promise<ScrapeJobHandle> {
  const organizationId = await jobTenant();
  if (!organizationId) return null;
  try {
    const { rows } = await getPool().query<{ id: string }>(
      `insert into scrape_jobs (organization_id, source_url, status, scraper_version)
       values ($1, $2, 'crawling', $3)
       returning id`,
      [organizationId, sourceUrl, scraperVersion],
    );
    return { id: rows[0].id };
  } catch (error) {
    console.warn("[scrape-jobs] could not record job start:", messageOf(error));
    return null;
  }
}

export async function advanceScrapeJob(
  handle: ScrapeJobHandle,
  status: "extracting" | "enriching",
): Promise<void> {
  if (!handle) return;
  await run(
    "update scrape_jobs set status = $2 where id = $1",
    [handle.id, status],
    "could not advance job",
  );
}

/** A crawl that produced a knowledge base. */
export async function finishScrapeJob(
  handle: ScrapeJobHandle,
  crawl: Pick<CrawlResult, "pages" | "warnings" | "pagesDiscovered">,
): Promise<void> {
  if (!handle) return;
  await run(
    `update scrape_jobs
        set status = 'done',
            pages_discovered = $2,
            pages_fetched = $3,
            warnings = $4::jsonb,
            finished_at = now(),
            duration_ms = (extract(epoch from (now() - started_at)) * 1000)::integer
      where id = $1`,
    [handle.id, crawl.pagesDiscovered, crawl.pages.length, JSON.stringify(crawl.warnings)],
    "could not record job completion",
  );
}

/**
 * A crawl that produced nothing.
 *
 * `error` is the user-facing reason, which is deliberately the same string the
 * user saw: when someone asks why a site never imported, the answer they were
 * given is the useful thing to have kept.
 */
export async function failScrapeJob(
  handle: ScrapeJobHandle,
  error: string,
  warnings: unknown[] = [],
): Promise<void> {
  if (!handle) return;
  await run(
    `update scrape_jobs
        set status = 'failed',
            error = $2,
            warnings = $3::jsonb,
            finished_at = now(),
            duration_ms = (extract(epoch from (now() - started_at)) * 1000)::integer
      where id = $1`,
    [handle.id, error.slice(0, 500), JSON.stringify(warnings)],
    "could not record job failure",
  );
}

async function run(sql: string, values: unknown[], context: string): Promise<void> {
  try {
    await getPool().query(sql, values);
  } catch (error) {
    console.warn(`[scrape-jobs] ${context}:`, messageOf(error));
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
