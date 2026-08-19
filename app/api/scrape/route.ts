import { z } from "zod";
import { SCRAPER_VERSION, websiteInputSchema } from "@/lib/schema";
import { crawlSite } from "@/lib/scraper/crawler";
import { encodeEvent, failureFor, type ScrapeEvent } from "@/lib/scraper/events";
import { buildKnowledgeBase, enrichKnowledgeBase } from "@/lib/scraper/pipeline";
import { blockedHost, blockedHostMessage } from "@/lib/scraper/ssrf";
import {
  advanceScrapeJob,
  failScrapeJob,
  finishScrapeJob,
  startScrapeJob,
} from "@/lib/storage/supabase/jobs";

/**
 * `POST /api/scrape` — one request, streamed NDJSON progress, knowledge base last.
 *
 * Node runtime, not edge: the pipeline needs `cheerio`, real sockets, and more
 * wall-clock time than an edge function gets (ROADMAP §3.2).
 */

export const runtime = "nodejs";
/** ~25s of polite crawling plus enrichment; the platform default is far too low. */
export const maxDuration = 300;

const scrapeRequestSchema = z.object({ url: websiteInputSchema });

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Send a JSON body with a `url`.");
  }

  const parsed = scrapeRequestSchema.safeParse(body);
  if (!parsed.success) {
    // The same zod schema validates the form on the client, so this only fires
    // for a direct API call — but it fires with the identical wording.
    return badRequest(parsed.error.issues[0]?.message ?? "That URL isn't usable.");
  }

  const { url } = parsed.data;

  // Refused here rather than mid-stream: a blocked address is a rejected
  // request, not a scrape that failed. The fetcher checks every URL it is
  // given (lib/scraper/ssrf.ts) and would stop this anyway — but that path
  // opens a stream, reports a crawl starting, and then fails it, which reads
  // like our problem instead of a bad address.
  const host = hostnameOf(url);
  const blocked = await blockedHost(host);
  if (blocked) return badRequest(blockedHostMessage(host, blocked));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let open = true;

      const send = (event: ScrapeEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          // The client hung up mid-write. Stop trying to talk to it.
          open = false;
        }
      };

      try {
        await run(url, request.signal, send);
      } catch (error) {
        if (!isAbort(error)) {
          send({
            kind: "failed",
            message: "Something went wrong while reading that site.",
            hint: "Try again in a moment. If it keeps failing, the site may be blocking automated readers.",
          });
        }
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed by an aborted request.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      // Buffering would defeat the entire point of streaming progress.
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

async function run(
  url: string,
  signal: AbortSignal,
  send: (event: ScrapeEvent) => void,
): Promise<void> {
  // One row per crawl attempt, including the ones that end in nothing. A no-op
  // unless Supabase is configured, and it never throws into the scrape: a site
  // that imports fine must not start failing because telemetry could not write.
  const job = await startScrapeJob(url, SCRAPER_VERSION);

  send({ kind: "stage", stage: "crawl", status: "start" });

  const crawl = await crawlSite(url, {
    signal,
    onProgress: (event) => send({ kind: "crawl", event }),
  });

  send({ kind: "stage", stage: "crawl", status: "done" });
  if (signal.aborted) {
    await failScrapeJob(job, "The request was cancelled.", crawl.warnings);
    return;
  }

  if (crawl.pages.length === 0) {
    const failure = failureFor(crawl.warnings);
    // The reason the user was given, kept verbatim — it is the answer to
    // "why did this site never import?" months later.
    await failScrapeJob(job, failure.message, crawl.warnings);
    send({ kind: "failed", ...failure });
    return;
  }

  await advanceScrapeJob(job, "extracting");
  send({ kind: "stage", stage: "extract", status: "start" });
  // Extraction is synchronous and cheerio-heavy; without this the "extracting"
  // event sits in the buffer behind work that blocks the event loop, and the
  // user watches a stalled progress list for the whole of it.
  await flush();

  const extraction = buildKnowledgeBase(crawl);
  send({ kind: "stage", stage: "extract", status: "done" });
  if (signal.aborted) return;

  await advanceScrapeJob(job, "enriching");
  send({ kind: "stage", stage: "enrich", status: "start" });
  try {
    const enriched = await enrichKnowledgeBase(extraction);
    send({ kind: "stage", stage: "enrich", status: "done" });
    await finishScrapeJob(job, crawl);
    send({
      kind: "result",
      knowledgeBase: enriched.knowledgeBase,
      enrichment: enriched.enrichment,
    });
  } catch {
    // Enrichment adds prose to a knowledge base that is already worth having.
    // Losing the whole scrape because a model call misbehaved would be absurd.
    send({ kind: "stage", stage: "enrich", status: "done" });
    // The crawl succeeded; only enrichment fell back. The job is `done`.
    await finishScrapeJob(job, crawl);
    send({
      kind: "result",
      knowledgeBase: extraction.knowledgeBase,
      enrichment: null,
    });
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

function hostnameOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}
