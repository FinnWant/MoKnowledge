import { describe, expect, it } from "vitest";
import { capturedSlugs, loadPageByRole, loadSite } from "../fixtures/load";
import type { PageInput, SiteContext } from "@/lib/scraper/evidence";
import { extractJsonLd, parseJsonLd } from "@/lib/scraper/extractors/jsonld";
import { extractMetadata, nameFromTitle } from "@/lib/scraper/extractors/metadata";
import { extractContact, normalizePhone, parseUsAddress } from "@/lib/scraper/extractors/contact";
import {
  collectCustomProperties,
  extractColors,
  extractFonts,
  resolveCustomProperties,
} from "@/lib/scraper/extractors/assets";
import { detectVendorHits } from "@/lib/scraper/extractors/vendors";
import { extractProof, extractCredentials, extractTrustStats } from "@/lib/scraper/extractors/proof";
import { extractOfferings, normalizeName } from "@/lib/scraper/extractors/offerings";
import { extractPeople } from "@/lib/scraper/extractors/people";
import { extractContent, extractCtas } from "@/lib/scraper/extractors/content";
import { extractLocations } from "@/lib/scraper/extractors/locations";
import { extractIdentity } from "@/lib/scraper/extractors/identity";
import * as cheerio from "cheerio";

/**
 * Extractor behaviour, checked on real fixture HTML wherever a real page shows
 * the case and on hand-written HTML only where the case is a specific defect we
 * have to guarantee (a `var()` that cannot resolve, a WordPress author node).
 */

const SITE: SiteContext = { originUrl: "https://example.com", domain: "example.com" };

function page(html: string, role: PageInput["role"] = "home"): PageInput {
  return { url: "https://example.com/", role, html };
}

const slugs = capturedSlugs();

/* --------------------------------------------------------------- JSON-LD */

describe("JSON-LD", () => {
  it("flattens @graph and resolves @id references", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", "@id": "#site", publisher: { "@id": "#org" } },
        {
          "@type": "Plumber",
          "@id": "#org",
          name: "Acme Plumbing",
          telephone: "(512) 555-0100",
          address: { "@id": "#addr" },
          sameAs: ["https://facebook.com/acme"],
        },
        {
          "@type": "PostalAddress",
          "@id": "#addr",
          streetAddress: "1 Main St",
          addressLocality: "Austin",
          addressRegion: "TX",
          postalCode: "78701",
        },
      ],
    })}</script>`;

    const claims = extractJsonLd(page(html), SITE);
    const at = (path: string) => claims.find((claim) => claim.path === path)?.value;

    expect(at("companyName")).toBe("Acme Plumbing");
    expect(at("foundation.phone")).toBe("(512) 555-0100");
    expect(at("foundation.industry")).toBe("Plumber");
    expect((at("foundation.mainAddress") as { formatted: string }).formatted).toBe(
      "1 Main St, Austin, TX 78701",
    );
    expect(claims.every((claim) => claim.method === "json-ld")).toBe(true);
  });

  it("ignores WordPress author accounts as people", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Person",
      name: "webdev@drivinglocalleads.com",
      description: "Site administrator with a long enough bio to pass the filter.",
    })}</script>`;

    expect(extractJsonLd(page(html), SITE).filter((claim) => claim.path === "people")).toHaveLength(0);
  });

  it("parses every fixture page without throwing", { timeout: 30_000 }, () => {
    for (const slug of slugs) {
      for (const fixture of loadSite(slug).pages) {
        expect(() => parseJsonLd(fixture.html)).not.toThrow();
      }
    }
  });
});

/* -------------------------------------------------------------- metadata */

describe("metadata", () => {
  it("takes the shortest segment of a noisy title", () => {
    expect(nameFromTitle("Water Well Drilling Austin TX | Bee Cave Drilling")).toBe(
      "Bee Cave Drilling",
    );
  });

  it("finds a company name on every captured home page", () => {
    for (const slug of slugs) {
      const home = loadPageByRole(slug, "home");
      if (!home) continue;
      const claims = extractMetadata({ url: home.url, role: "home", html: home.html }, SITE);
      expect(claims.some((claim) => claim.path === "companyName")).toBe(true);
    }
  });
});

/* --------------------------------------------------------------- contact */

describe("contact", () => {
  it("normalizes phone formats to one string", () => {
    expect(normalizePhone("(512) 273-7389")).toBe(normalizePhone("512.273.7389"));
    expect(normalizePhone("1-512-273-7389")).toBe(normalizePhone("512 273 7389"));
    expect(normalizePhone("1234567890")).toBeNull();
  });

  it("prefers tel: links over text matches", () => {
    const html = `<a href="tel:+15122730000">Call</a><p>Old number 512-273-9999</p>`;
    const phones = extractContact(page(html, "contact"), SITE).filter(
      (claim) => claim.path === "foundation.phone",
    );
    expect(phones).toHaveLength(1);
    expect(phones[0].method).toBe("dom");
  });

  it("splits a US address into parts", () => {
    expect(parseUsAddress("1 Main St, Austin, TX 78701")).toMatchObject({
      city: "Austin",
      region: "TX",
      postalCode: "78701",
    });
  });
});

/* ---------------------------------------------------------------- assets */

describe("assets", () => {
  it("resolves CSS custom properties instead of leaking them", () => {
    const css = `:root{--brand:#2663eb;--font-family:Inter, sans-serif}
      body{color:var(--brand);font-family:var(--font-family)}`;
    const variables = collectCustomProperties(css);

    expect(resolveCustomProperties("var(--brand)", variables)).toBe("#2663eb");
    expect(extractFonts(css, variables)).toContain("Inter");
    expect(extractColors(css, variables).map((color) => color.hex)).toContain("#2663eb");
  });

  it("returns null for a variable it cannot resolve", () => {
    // The ROADMAP §2.3 defect: the reference output shipped
    // `var(--e-global-typography-502e136-font-family)` as a font name.
    const variables = collectCustomProperties(":root{--a:1px}");
    expect(resolveCustomProperties("var(--e-global-typography-502e136-font-family)", variables)).toBeNull();
    expect(extractFonts("body{font-family:var(--missing)}", variables)).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- vendors */

describe("vendors", () => {
  it("separates known signatures from unrecognised third-party hosts", () => {
    const html = `
      <script src="https://www.googletagmanager.com/gtag/js"></script>
      <script src="https://cdn.userway.org/widget.js"></script>
      <img src="https://example.com/logo.png">
      <a href="https://www.facebook.com/example">Facebook</a>`;

    const hits = detectVendorHits(html, "example.com");
    expect(hits.known).toContain("Google Analytics");
    expect(hits.unknown).toContain("Userway.org");
    // Own assets and social profiles are not suppliers.
    expect([...hits.known, ...hits.unknown].join(" ")).not.toMatch(/example\.com|facebook/i);
  });
});

/* ----------------------------------------------------------------- proof */

describe("proof", () => {
  it("reports a review widget as a named honest failure", () => {
    const html = `<script src="https://birdeye.com/embed/v5/123/4/56"></script>`;
    const claims = extractProof(page(html, "testimonials"), SITE);
    const widget = claims.find((claim) => claim.path === "proof.testimonials");

    expect(widget?.value).toEqual([]);
    expect(widget?.note).toMatch(/Birdeye/i);
    expect(widget?.note).toMatch(/JS-rendered/i);
  });

  it("keeps a quote with its attribution and drops page furniture", () => {
    const html = `
      <div class="testimonial">
        <blockquote>They drilled our well in two days and cleaned up every scrap. Outstanding work from start to finish.</blockquote>
        <cite>— Karen M., Spicewood TX</cite>
      </div>
      <div class="testimonial"><p>Read more</p></div>`;

    const quotes = extractProof(page(html, "testimonials"), SITE).filter(
      (claim) => claim.path === "proof.testimonials" && Array.isArray(claim.value) === false,
    );
    expect(quotes).toHaveLength(1);
    expect((quotes[0].value as { authorName: string }).authorName).toBe("Karen M.");
  });

  it("parses trust stats into value and unit", () => {
    const stats = extractTrustStats("Over 40 years of experience serving the Hill Country.");
    expect(stats[0]).toMatchObject({ value: 40, unit: "years", category: "years-in-business" });
  });

  it("recognises a licence as a credential", () => {
    const credentials = extractCredentials(
      "Licensed by the Texas Department of Licensing and Regulation. Better Business Bureau accredited.",
    );
    expect(credentials.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------- offerings */

describe("offerings", () => {
  it("treats a single-topic page's H1 as an offering", () => {
    const html = `<h1>Well Inspections</h1><p>We inspect residential wells across the Hill Country every day.</p>`;
    const claims = extractOfferings(
      { url: "https://example.com/well-inspections/", role: "other", html },
      SITE,
    );
    expect((claims[0].value as { name: string }).name).toBe("Well Inspections");
    expect(claims[0].method).toBe("heuristic");
  });

  it("ignores page furniture and taglines", () => {
    const html = `<h1>Since 1980</h1><p>Serving the Texas Hill Country with pride for decades now.</p>`;
    expect(
      extractOfferings({ url: "https://example.com/about-us/", role: "other", html }, SITE),
    ).toHaveLength(0);
  });

  it("reads a services dropdown off the home page", () => {
    const html = `<nav><ul><li><a href="/services">Services</a>
      <ul><li><a href="/well-drilling">Well Drilling</a></li>
          <li><a href="/pumping-systems">Pumping Systems</a></li></ul>
      </li></ul></nav>`;
    const names = extractOfferings(page(html), SITE).map(
      (claim) => (claim.value as { name: string }).name,
    );
    expect(names).toEqual(["Well Drilling", "Pumping Systems"]);
  });

  it("normalizes names so the same service merges once", () => {
    expect(normalizeName("Well Drilling Services")).toBe(normalizeName("Well Drilling"));
  });
});

/* ---------------------------------------------------------------- people */

describe("people", () => {
  it("only runs on team and about pages", () => {
    const html = `<div class="team-member"><h3>Jim Blair</h3><p class="title">Owner</p></div>`;
    expect(extractPeople(page(html, "blog-post"), SITE)).toHaveLength(0);
    expect(extractPeople(page(html, "team"), SITE)).toHaveLength(1);
  });

  it("requires a title or a bio before believing a heading is a person", () => {
    const html = `<div class="team-member"><h3>Our Values</h3></div>`;
    expect(extractPeople(page(html, "team"), SITE)).toHaveLength(0);
  });
});

/* --------------------------------------------------------------- content */

describe("content", () => {
  it("reads FAQ pairs out of <details> markup", () => {
    const html = `<details><summary>How deep will my well be?</summary>
      <p>Most wells in this area are between 300 and 600 feet deep.</p></details>`;
    const faqs = extractContent(page(html, "faq"), SITE).filter(
      (claim) => claim.path === "contentIntelligence.faqs",
    );
    expect((faqs[0].value as { question: string }).question).toBe("How deep will my well be?");
  });

  it("keeps calls to action and drops navigation labels", () => {
    const $ = cheerio.load(
      `<a class="btn" href="/quote">Request a Quote</a><a href="/about">About Us</a>`,
    );
    const ctas = extractCtas($);
    expect(ctas).toContain("Request a Quote");
    expect(ctas).not.toContain("About Us");
  });
});

/* ------------------------------------------------------------- locations */

describe("locations", () => {
  it("reads the areas named in a serving line", () => {
    const html = `<h1>Proudly Serving The Texas Hill Country Since 1980</h1>`;
    const values = extractLocations(page(html), SITE).map((claim) => claim.value);
    expect(values).toContain("Texas Hill Country");
  });

  it("does not treat an audience as a place", () => {
    const html = `<p>Serving SMBs and homeowners across the country.</p>`;
    expect(extractLocations(page(html), SITE)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------- identity */

describe("identity", () => {
  it("reads a founding year from a since-line", () => {
    const claims = extractIdentity(page(`<p>Family-owned since 1980.</p>`), SITE);
    expect(claims.find((claim) => claim.path === "foundation.yearFounded")?.value).toBe(1980);
  });

  it("never reads the founding year off a copyright range", () => {
    const claims = extractIdentity(
      page(`<footer>Copyright © 2007-2023 Bee Cave Drilling, All Rights Reserved</footer>`),
      SITE,
    );
    expect(claims.find((claim) => claim.path === "foundation.yearFounded")).toBeUndefined();
    expect(claims.find((claim) => claim.path === "foundation.altNames")?.value).toBe(
      "Bee Cave Drilling",
    );
  });

  it("takes the entity type from the legal name's suffix", () => {
    const claims = extractIdentity(
      page(`<footer>© 2024 Account-it Consulting Services, LLC. All Rights Reserved.</footer>`),
      SITE,
    );
    expect(claims.find((claim) => claim.path === "foundation.legalEntityType")?.value).toBe("LLC");
  });
});
