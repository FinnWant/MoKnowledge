import { describe, expect, it } from "vitest";
import {
  isSameSite,
  looksLikeHtmlPage,
  normalizeUrl,
  pageSlug,
  registrableDomain,
  siteSlug,
} from "@/lib/utils/url";

describe("normalizeUrl", () => {
  it("assumes https when the user omits a scheme", () => {
    expect(normalizeUrl("beecavedrilling.com")).toBe(
      "https://beecavedrilling.com/",
    );
  });

  it("collapses the four spellings of one page into one URL", () => {
    // The classic budget leak: 20 pages spent on 5 distinct pages.
    const variants = [
      "https://example.com/about",
      "https://example.com/about/",
      "https://WWW.Example.com/about",
      "https://example.com/about?utm_source=google&utm_medium=cpc",
      "https://example.com/about#team",
    ];
    const normalized = new Set(variants.map((url) => normalizeUrl(url)));
    expect(normalized.size).toBe(1);
  });

  it("keeps query parameters that actually select content", () => {
    expect(normalizeUrl("https://example.com/search?page=2&utm_id=x")).toBe(
      "https://example.com/search?page=2",
    );
  });

  it("drops empty-valued parameters that themes append to every link", () => {
    // Divi's `?et_blog=`, seen on a real golden site.
    expect(normalizeUrl("https://planetorange.com/about-us?et_blog=")).toBe(
      "https://planetorange.com/about-us",
    );
    // But pagination beneath it is still a distinct page.
    expect(normalizeUrl("https://planetorange.com/about-us/page/2?et_blog=")).toBe(
      "https://planetorange.com/about-us/page/2",
    );
  });

  it("sorts parameters so ordering can't fork the crawl", () => {
    expect(normalizeUrl("https://example.com/a?b=2&a=1")).toBe(
      normalizeUrl("https://example.com/a?a=1&b=2"),
    );
  });

  it("resolves relative hrefs against the page they were found on", () => {
    expect(normalizeUrl("../contact", "https://example.com/services/wells")).toBe(
      "https://example.com/contact",
    );
  });

  it("rejects non-page schemes rather than queueing them", () => {
    for (const href of [
      "mailto:hi@example.com",
      "tel:+15122737389",
      "javascript:void(0)",
      "ftp://example.com/file",
      "",
    ]) {
      expect(normalizeUrl(href)).toBeNull();
    }
  });

  it("preserves the root slash", () => {
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });
});

describe("registrableDomain", () => {
  it.each([
    ["www.beecavedrilling.com", "beecavedrilling.com"],
    ["blog.example.com", "example.com"],
    ["a.b.example.co.uk", "example.co.uk"],
    ["example.com", "example.com"],
    ["moflo.ai", "moflo.ai"],
  ])("%s -> %s", (host, expected) => {
    expect(registrableDomain(host)).toBe(expected);
  });
});

describe("isSameSite", () => {
  it("follows subdomains, where the blog usually lives", () => {
    expect(
      isSameSite("https://example.com/", "https://blog.example.com/post"),
    ).toBe(true);
  });

  it("stops at a different company", () => {
    expect(isSameSite("https://example.com/", "https://facebook.com/x")).toBe(
      false,
    );
  });
});

describe("looksLikeHtmlPage", () => {
  it("skips assets a nav will happily link to", () => {
    for (const url of [
      "https://example.com/brochure.pdf",
      "https://example.com/logo.png",
      "https://example.com/feed.xml",
    ]) {
      expect(looksLikeHtmlPage(url)).toBe(false);
    }
  });

  it("accepts extensionless and .html paths", () => {
    expect(looksLikeHtmlPage("https://example.com/about")).toBe(true);
    expect(looksLikeHtmlPage("https://example.com/about.html")).toBe(true);
  });
});

describe("fixture slugs", () => {
  it("names a site directory by its registrable domain", () => {
    expect(siteSlug("https://www.beecavedrilling.com/about")).toBe(
      "beecavedrilling-com",
    );
  });

  it("names the homepage file index", () => {
    expect(pageSlug("https://example.com/")).toBe("index");
  });

  it("keeps page filenames readable and unique", () => {
    expect(pageSlug("https://example.com/services/water-well-drilling")).toBe(
      "services-water-well-drilling",
    );
    expect(pageSlug("https://example.com/a?b=1")).not.toBe(pageSlug("https://example.com/a"));
  });
});
