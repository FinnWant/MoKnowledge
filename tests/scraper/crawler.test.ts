import { afterEach, describe, expect, it, vi } from "vitest";
import { crawlSite } from "@/lib/scraper/crawler";

/**
 * Crawl orchestration against a fake site served from memory.
 *
 * Deliberately not a network test: docs/VALIDATION.md §5 commits us to
 * snapshotting real sites once and never re-crawling them from a test suite.
 */

const ORIGIN = "https://example.com";

function page(title: string, links: string[] = []): string {
  return `<!doctype html><html><body>
    <nav>${links.map((href) => `<a href="${href}">${href}</a>`).join("")}</nav>
    <h1>${title}</h1>
    <p>${"Real readable content about the business. ".repeat(20)}</p>
  </body></html>`;
}

type Site = Record<string, string>;

/** Installs a fetch that serves `site` and counts requests per path. */
function serve(site: Site, robotsTxt = "") {
  const requests: string[] = [];

  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    requests.push(url);

    if (url.endsWith("/robots.txt")) {
      return new Response(robotsTxt, {
        status: robotsTxt ? 200 : 404,
        headers: { "content-type": "text/plain" },
      });
    }
    if (url.includes("sitemap")) {
      const xml = site["sitemap"];
      return new Response(xml ?? "", { status: xml ? 200 : 404 });
    }

    const path = new URL(url).pathname;
    const body = site[path];
    if (body === undefined) return new Response("Not found", { status: 404 });

    // `Response.url` is read-only and stays empty on a synthetic response; the
    // fetcher falls back to the requested URL, which is what we want here.
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });

  return requests;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const FAST = { politenessFloorMs: 0 } as const;

describe("crawlSite", () => {
  it("crawls a small site and classifies what it found", async () => {
    serve({
      "/": page("Home", ["/about", "/services", "/contact"]),
      "/about": page("About"),
      "/services": page("Services"),
      "/contact": page("Contact"),
    });

    const result = await crawlSite(ORIGIN, FAST);

    expect(result.pages).toHaveLength(4);
    expect(result.pages.map((p) => p.role).sort()).toEqual([
      "about",
      "contact",
      "home",
      "services",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("fetches the homepage exactly once", async () => {
    // It is crawled explicitly before the workers start, so it must not also sit
    // in the frontier waiting to be picked up again — and the sitemap almost
    // always lists it, which is how it got fetched twice against a real site.
    const requests = serve({
      sitemap: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/about</loc></url></urlset>`,
      "/": page("Home", ["/", "/about", "/index"]),
      "/about": page("About"),
    });

    await crawlSite(ORIGIN, FAST);

    const homepageFetches = requests.filter(
      (url) => new URL(url).pathname === "/",
    );
    expect(homepageFetches).toHaveLength(1);
  });

  it("never exceeds the page budget, even with workers racing", async () => {
    const many = Array.from({ length: 30 }, (_, i) => `/page-${i}`);
    const site: Site = { "/": page("Home", many) };
    for (const path of many) site[path] = page(path);
    serve(site);

    const result = await crawlSite(ORIGIN, {
      ...FAST,
      maxPages: 8,
      concurrency: 4,
    });

    expect(result.pages).toHaveLength(8);
    expect(result.warnings.map((w) => w.code)).toContain("budget-exceeded");
  });

  it("crawls high-value pages before low-value ones when the budget is tight", async () => {
    serve({
      "/": page("Home", [
        "/blog/post-1",
        "/privacy-policy",
        "/about",
        "/blog/post-2",
        "/services",
      ]),
      "/about": page("About"),
      "/services": page("Services"),
      "/privacy-policy": page("Privacy"),
      "/blog/post-1": page("Post 1"),
      "/blog/post-2": page("Post 2"),
    });

    const result = await crawlSite(ORIGIN, { ...FAST, maxPages: 3, concurrency: 1 });
    const roles = result.pages.map((p) => p.role);

    expect(roles).toEqual(["home", "about", "services"]);
  });

  it("keeps going when a page 404s and reports it", async () => {
    serve({
      "/": page("Home", ["/about", "/gone"]),
      "/about": page("About"),
    });

    const result = await crawlSite(ORIGIN, FAST);

    expect(result.pages.map((p) => p.role)).toContain("about");
    const failure = result.warnings.find((w) => w.code === "fetch-failed");
    expect(failure?.message).toContain("404");
  });

  it("does not spend page budget on failures", async () => {
    const site: Site = { "/": page("Home", ["/a", "/b", "/dead-1", "/dead-2"]) };
    site["/a"] = page("A");
    site["/b"] = page("B");
    serve(site);

    const result = await crawlSite(ORIGIN, { ...FAST, maxPages: 3 });

    // Three live pages exist and three should be returned, despite two 404s.
    expect(result.pages).toHaveLength(3);
  });

  it("does not store the same page twice when several URLs redirect to it", async () => {
    // Observed on a real golden site: 9 of 20 budget slots went to copies of the
    // homepage because half the nav 301s to `/`.
    const requests: string[] = [];
    // `fetch` follows redirects internally, so a redirected request arrives as a
    // 200 whose `response.url` is the destination. That is what we mimic.
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      requests.push(url);
      if (url.endsWith("/robots.txt") || url.includes("sitemap")) {
        return new Response("", { status: 404 });
      }
      const path = new URL(url).pathname;
      const isHomeAlias = ["/", "/listings", "/old-home"].includes(path);
      const body = isHomeAlias
        ? page("Home", ["/listings", "/old-home", "/about"])
        : path === "/about"
          ? page("About")
          : null;
      if (body === null) return new Response("Not found", { status: 404 });

      const response = new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
      // Every alias reports the homepage as the URL it landed on.
      Object.defineProperty(response, "url", {
        value: isHomeAlias ? `${ORIGIN}/` : url,
      });
      return response;
    });

    const result = await crawlSite(ORIGIN, FAST);

    expect(result.pages.map((p) => p.url)).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/about`,
    ]);
  });

  it("obeys robots.txt", async () => {
    const requests = serve(
      {
        "/": page("Home", ["/about", "/private/secret"]),
        "/about": page("About"),
        "/private/secret": page("Secret"),
      },
      ["User-agent: *", "Disallow: /private"].join("\n"),
    );

    const result = await crawlSite(ORIGIN, FAST);

    expect(requests.some((url) => url.includes("/private"))).toBe(false);
    expect(result.warnings.map((w) => w.code)).toContain("robots-disallow");
  });

  it("stops without reading anything when robots.txt disallows the whole site", async () => {
    serve({ "/": page("Home") }, ["User-agent: *", "Disallow: /"].join("\n"));

    const result = await crawlSite(ORIGIN, FAST);

    expect(result.pages).toHaveLength(0);
    expect(result.warnings[0].code).toBe("robots-disallow");
  });

  it("reports a JavaScript-rendered site instead of returning a silently empty result", async () => {
    serve({ "/": `<html><body><div id="root"></div></body></html>` });

    const result = await crawlSite(ORIGIN, FAST);

    const warning = result.warnings.find((w) => w.code === "js-rendered");
    expect(warning?.message).toContain("JavaScript");
    expect(warning?.message).toContain("React");
    // Still a page, not a dead end — metadata extraction can work on it.
    expect(result.pages).toHaveLength(1);
  });

  it("returns a warning rather than throwing on an unusable URL", async () => {
    const result = await crawlSite("not a url", FAST);
    expect(result.pages).toEqual([]);
    expect(result.warnings[0].code).toBe("fetch-failed");
  });

  it("emits progress events in a usable order for the scrape UI", async () => {
    serve({ "/": page("Home", ["/about"]), "/about": page("About") });

    const events: string[] = [];
    await crawlSite(ORIGIN, {
      ...FAST,
      onProgress: (event) => events.push(event.type),
    });

    expect(events[0]).toBe("start");
    expect(events[1]).toBe("robots");
    expect(events).toContain("page");
    expect(events.at(-1)).toBe("done");
  });
});
