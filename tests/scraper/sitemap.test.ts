import { describe, expect, it } from "vitest";
import { discoverFromSitemaps, parseSitemapXml } from "@/lib/scraper/sitemap";

const URLSET = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2026-01-04</lastmod></url>
  <url><loc>https://example.com/about/</loc></url>
  <url><loc>https://example.com/logo.png</loc></url>
  <url><loc>https://someoneelse.com/spam</loc></url>
</urlset>`;

const INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-images.xml</loc></sitemap>
</sitemapindex>`;

describe("parseSitemapXml", () => {
  it("reads page URLs and last-modified dates", () => {
    const { index, entries } = parseSitemapXml(URLSET, "https://example.com/sitemap.xml");
    expect(index).toBe(false);
    expect(entries[0]).toEqual({
      url: "https://example.com/",
      lastModified: "2026-01-04",
    });
    expect(entries[1].url).toBe("https://example.com/about");
  });

  it("recognises a sitemap index", () => {
    const { index, entries } = parseSitemapXml(INDEX, "https://example.com/sitemap.xml");
    expect(index).toBe(true);
    expect(entries).toHaveLength(2);
  });
});

describe("discoverFromSitemaps", () => {
  it("follows an index, skips image sitemaps, and filters foreign or non-page URLs", async () => {
    const requested: string[] = [];
    const fakeFetch = async (url: string) => {
      requested.push(url);
      if (url.endsWith("/sitemap.xml")) return INDEX;
      if (url.endsWith("/sitemap-pages.xml")) return URLSET;
      return null;
    };

    const entries = await discoverFromSitemaps("https://example.com/", [], {
      fetchImpl: fakeFetch,
    });

    expect(entries.map((entry) => entry.url)).toEqual([
      "https://example.com/",
      "https://example.com/about",
    ]);
    expect(requested).toContain("https://example.com/sitemap-pages.xml");
    expect(requested).not.toContain("https://example.com/sitemap-images.xml");
  });

  it("tries the sitemap robots.txt declared before guessing paths", async () => {
    const requested: string[] = [];
    const fakeFetch = async (url: string) => {
      requested.push(url);
      return url.includes("custom") ? URLSET : null;
    };

    await discoverFromSitemaps(
      "https://example.com/",
      ["https://example.com/custom-sitemap.xml"],
      { fetchImpl: fakeFetch },
    );

    expect(requested[0]).toBe("https://example.com/custom-sitemap.xml");
  });

  it("returns nothing rather than failing when a site has no sitemap", async () => {
    const entries = await discoverFromSitemaps("https://example.com/", [], {
      fetchImpl: async () => null,
    });
    expect(entries).toEqual([]);
  });
});
