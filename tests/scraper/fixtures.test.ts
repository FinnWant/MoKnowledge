import { describe, expect, it } from "vitest";
import {
  capturedSlugs,
  loadPageByRole,
  loadSite,
} from "../fixtures/load";
import { GOLDEN_SITES } from "../golden/sites";
import { classifyUrl } from "@/lib/scraper/classify";
import { detectJsRendered } from "@/lib/scraper/detect";
import { extractLinks } from "@/lib/scraper/links";
import { isSameSite, normalizeUrl } from "@/lib/utils/url";
import { pageRoleSchema } from "@/lib/schema";

/**
 * The golden-set fixtures, checked against what P2 promised.
 *
 * These run over committed snapshots of real SMB websites — the point being that
 * the crawler's output is verified against messy real HTML, not hand-written
 * pages that happen to suit it.
 */

const slugs = capturedSlugs();

describe("golden fixtures", () => {
  it("captured seven of the eight golden sites", () => {
    // J&D Insurance is missing on purpose: its domain now serves a Wix
    // "ConnectYourDomain Error" page and 404s at every path. The reference PDF
    // was generated 2026-02-13 and it is now 2026-08-15 — this is exactly the
    // temporal drift docs/VALIDATION.md §2 warned about, and inventing a fixture
    // for it would defeat the purpose of a golden set.
    expect(slugs).toHaveLength(7);
    expect(slugs).not.toContain("jd-insurance");
    expect(GOLDEN_SITES).toHaveLength(8);
  });

  it.each(slugs)("%s has a manifest matching its files", (slug) => {
    const { manifest, pages } = loadSite(slug);

    expect(manifest.slug).toBe(slug);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      expect(page.status).toBe(200);
      expect(page.html.length).toBeGreaterThan(0);
    }
  });

  it.each(slugs)("%s stayed inside its own site", (slug) => {
    const { manifest, pages } = loadSite(slug);
    for (const page of pages) {
      expect(isSameSite(page.url, manifest.url), page.url).toBe(true);
    }
  });

  it.each(slugs)("%s has no duplicate pages", (slug) => {
    // Redirects are how this breaks: `/blog`, `/listings`, and half a nav can
    // all 301 to `/`, and one real site spent 9 of 20 budget slots on copies of
    // its own homepage before the crawler deduped on the landed URL.
    const { pages } = loadSite(slug);
    const urls = pages.map((page) => page.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it.each(slugs)("%s respected the 20-page budget", (slug) => {
    expect(loadSite(slug).pages.length).toBeLessThanOrEqual(20);
  });

  it.each(slugs)("%s captured its homepage", (slug) => {
    const home = loadPageByRole(slug, "home");
    expect(home).not.toBeNull();
  });

  it.each(slugs)("%s pages are readable HTML, not JS shells", (slug) => {
    // The no-headless-browser decision only holds if the sites we target are
    // actually server-rendered. This is the check that would tell us otherwise.
    const { pages } = loadSite(slug);
    const readable = pages.filter((page) => !detectJsRendered(page.html).isJsRendered);
    expect(readable.length / pages.length).toBeGreaterThan(0.5);
  });

  it.each(slugs)("%s stored roles the classifier still agrees with", (slug) => {
    const { pages } = loadSite(slug);

    for (const page of pages) {
      expect(pageRoleSchema.safeParse(page.role).success, page.role).toBe(true);
    }

    // Not an exact match, deliberately. The manifest role is the one assigned at
    // discovery time from the URL we requested; a redirect can land on a URL
    // that classifies differently (`/tag/testimonials/` → `/tag/testimonial/`).
    // What this guards is the classifier changing wholesale underneath the
    // fixtures, which a strict per-page assertion would confuse with redirects.
    const agree = pages.filter(
      (page) => classifyUrl(page.url).role === page.role,
    );
    expect(agree.length / pages.length).toBeGreaterThan(0.8);
  });

  it("reached the page types the knowledge base actually needs", () => {
    // The classifier's whole purpose: with a 20-page budget on a 200-page site,
    // About and Contact must beat blog posts from 2019.
    const coverage = slugs.map((slug) => {
      const roles = new Set(loadSite(slug).pages.map((page) => page.role));
      return { slug, hasAbout: roles.has("about"), hasContact: roles.has("contact") };
    });

    const withContact = coverage.filter((site) => site.hasContact);
    expect(withContact.length).toBeGreaterThanOrEqual(6);
  });

  it("finds real internal links on every homepage", () => {
    for (const slug of slugs) {
      const { manifest } = loadSite(slug);
      const home = loadPageByRole(slug, "home");
      if (!home) continue;

      const links = extractLinks(home.html, home.url, manifest.url);
      expect(links.length, slug).toBeGreaterThan(3);
      for (const link of links) {
        expect(normalizeUrl(link.url)).toBe(link.url);
      }
    }
  });
});
