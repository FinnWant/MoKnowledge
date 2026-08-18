import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/scrape/route";
import { knowledgeBaseSchema } from "@/lib/schema";
import type { ScrapeEvent } from "@/lib/scraper/events";
import { readNdjson } from "@/lib/utils/ndjson";

/**
 * The scrape route end to end, over a three-page site served from memory.
 *
 * This is the P4 acceptance criterion as a test: a URL goes in, progress events
 * come out while the crawl runs, and the last line is a schema-valid knowledge
 * base. It runs against a stubbed `fetch` rather than a real site, so it is
 * deterministic and never touches somebody's web server.
 */

const ORIGIN = "https://example-co.test";

const PAGES: Record<string, string> = {
  "/": `<!doctype html><html><head>
      <title>Example Co — Well drilling in Austin</title>
      <meta name="description" content="Example Co drills and services water wells across Central Texas.">
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"LocalBusiness","name":"Example Co",
         "telephone":"512-555-0100","foundingDate":"1994",
         "address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Austin","addressRegion":"TX"}}
      </script>
    </head><body>
      <nav><a href="/about">About us</a><a href="/services">Our services</a></nav>
      <h1>Water wells, done properly</h1>
      <p>We have drilled wells across Central Texas since 1994.</p>
    </body></html>`,

  "/about": `<!doctype html><html><head><title>About Example Co</title></head><body>
      <h1>About us</h1>
      <p>Example Co is a family business serving the Texas Hill Country since 1994.</p>
      <a href="mailto:hello@example-co.test">hello@example-co.test</a>
    </body></html>`,

  "/services": `<!doctype html><html><head><title>Services</title></head><body>
      <h1>Well drilling</h1>
      <p>Residential and commercial well drilling, starting at $12,000.</p>
    </body></html>`,
};

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

beforeEach(() => {
  // Enrichment must take the mock path even on a machine with a real key, or
  // this test would make a paid API call.
  vi.stubEnv("ANTHROPIC_API_KEY", "");

  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.origin !== ORIGIN) return new Response("", { status: 404 });

    const page = PAGES[url.pathname];
    // robots.txt and sitemap.xml included: a 404 for both is the common case,
    // and the crawler has to survive it.
    return page ? html(page) : new Response("Not found", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function request(body: unknown): Request {
  return new Request("http://localhost/api/scrape", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function collect(response: Response): Promise<ScrapeEvent[]> {
  const events: ScrapeEvent[] = [];
  if (!response.body) return events;
  for await (const event of readNdjson<ScrapeEvent>(response.body)) {
    events.push(event);
  }
  return events;
}

describe("POST /api/scrape", () => {
  it("rejects a URL that isn't one, with the wording the form uses", async () => {
    const response = await POST(request({ url: "not a website" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "That doesn't look like a website address (try example.com)",
    });
  });

  it("refuses an internal address before it opens a stream", async () => {
    // The adversarial case (P8): a well-formed URL, dots and all, pointing at
    // the cloud metadata endpoint. It has to be a 400 with an explanation, not
    // a stream that reports a crawl starting and then fails.
    const response = await POST(request({ url: "http://169.254.169.254/latest/meta-data/" }));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/link-local/);
    expect(body.error).toMatch(/public internet/);
  });

  it("refuses loopback and private addresses the same way", async () => {
    for (const url of ["http://127.0.0.1:3000/", "http://10.0.0.5/", "http://[::1]/"]) {
      const response = await POST(request({ url }));
      expect(response.status, url).toBe(400);
    }
  });

  it("rejects a body with no url at all", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(400);
  });

  it("streams progress and ends with a schema-valid knowledge base", async () => {
    const response = await POST(request({ url: "example-co.test" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");

    const events = await collect(response);

    // Progress arrives before the result, which is the entire point of the
    // streamed response.
    const stages = events.filter((event) => event.kind === "stage");
    expect(stages.map((event) => `${event.stage}:${event.status}`)).toEqual([
      "crawl:start",
      "crawl:done",
      "extract:start",
      "extract:done",
      "enrich:start",
      "enrich:done",
    ]);

    const pages = events.filter(
      (event) => event.kind === "crawl" && event.event.type === "page",
    );
    expect(pages.length).toBeGreaterThanOrEqual(3);

    const result = events.at(-1);
    expect(result?.kind).toBe("result");
    if (result?.kind !== "result") throw new Error("no result event");

    const parsed = knowledgeBaseSchema.safeParse(result.knowledgeBase);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();

    const kb = result.knowledgeBase;
    expect(kb.companyName.value).toContain("Example Co");
    expect(kb.foundation.phone.value).toBe("512-555-0100");
    expect(kb.foundation.yearFounded.value).toBe(1994);
    expect(kb.scrape.pages).toHaveLength(3);
    // No key was set, so every generated field must be labelled as a sample.
    expect(result.enrichment?.apiKeyPresent).toBe(false);
  }, 30_000);

  it("fails with an explanation when there is nothing to read", async () => {
    vi.stubGlobal("fetch", async () => new Response("gone", { status: 404 }));

    const events = await collect(await POST(request({ url: "dead-site.test" })));
    const failure = events.at(-1);

    expect(failure?.kind).toBe("failed");
    if (failure?.kind !== "failed") throw new Error("expected a failure event");
    expect(failure.message.length).toBeGreaterThan(0);
    expect(events.some((event) => event.kind === "result")).toBe(false);
  }, 30_000);
});
