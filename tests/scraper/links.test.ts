import { describe, expect, it } from "vitest";
import { extractCanonical, extractLinks } from "@/lib/scraper/links";
import { detectJsRendered, detectReviewWidgets } from "@/lib/scraper/detect";

const PAGE = "https://beecavedrilling.com/";

const HTML = `<!doctype html>
<html><head>
  <link rel="canonical" href="https://beecavedrilling.com/home/">
</head><body>
  <nav>
    <a href="/about">About Us</a>
    <a href="/services/">Services</a>
    <a href="https://beecavedrilling.com/contact">Contact</a>
  </nav>
  <main>
    <p>Read <a href="/about">click here</a> for more, or see our
    <a href="/services/water-well-drilling">well drilling page</a>.</p>
    <a href="https://www.facebook.com/beecavedrilling">Facebook</a>
    <a href="mailto:office@beecavedrilling.com">Email us</a>
    <a href="/brochure.pdf">Download the brochure</a>
  </main>
  <footer>
    <a href="/privacy-policy">Privacy Policy</a>
    <a href="/about?utm_source=footer">About</a>
  </footer>
</body></html>`;

describe("extractLinks", () => {
  const links = extractLinks(HTML, PAGE);
  const byUrl = new Map(links.map((link) => [link.url, link]));

  it("keeps only same-site page links", () => {
    expect(byUrl.has("https://beecavedrilling.com/about")).toBe(true);
    expect(byUrl.has("https://www.facebook.com/beecavedrilling")).toBe(false);
    expect([...byUrl.keys()].some((url) => url.includes("mailto"))).toBe(false);
    expect([...byUrl.keys()].some((url) => url.endsWith(".pdf"))).toBe(false);
  });

  it("deduplicates a page linked from several places", () => {
    // /about appears in the nav, the body, and the footer with a UTM tag.
    const aboutLinks = links.filter((link) => link.url.endsWith("/about"));
    expect(aboutLinks).toHaveLength(1);
  });

  it("credits the strongest placement, not the last one seen", () => {
    // A site's own nav is the best statement of which pages matter.
    expect(byUrl.get("https://beecavedrilling.com/about")?.placementBonus).toBe(15);
    expect(
      byUrl.get("https://beecavedrilling.com/privacy-policy")?.placementBonus,
    ).toBe(8);
    expect(
      byUrl.get("https://beecavedrilling.com/services/water-well-drilling")
        ?.placementBonus,
    ).toBe(0);
  });

  it("prefers the descriptive anchor text over 'click here'", () => {
    expect(byUrl.get("https://beecavedrilling.com/about")?.anchorText).toBe(
      "About Us",
    );
  });
});

describe("extractCanonical", () => {
  it("reads the declared canonical URL", () => {
    expect(extractCanonical(HTML, PAGE)).toBe("https://beecavedrilling.com/home");
  });

  it("returns null when none is declared", () => {
    expect(extractCanonical("<html><body>hi</body></html>", PAGE)).toBeNull();
  });
});

describe("detectJsRendered", () => {
  it("flags an empty React shell", () => {
    const verdict = detectJsRendered(
      `<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
    );
    expect(verdict.isJsRendered).toBe(true);
    expect(verdict.framework).toBe("React");
  });

  it("does not flag a framework site that server-renders its content", () => {
    // Plenty of Next.js sites are perfectly readable; the marker alone proves nothing.
    const body = "Bee Cave Drilling has served Central Texas since 1980. ".repeat(20);
    const verdict = detectJsRendered(
      `<html><body><div id="__next"><p>${body}</p></div></body></html>`,
    );
    expect(verdict.framework).toBe("Next.js");
    expect(verdict.isJsRendered).toBe(false);
  });

  it("ignores script and style text when measuring content", () => {
    const filler = "x".repeat(5000);
    const verdict = detectJsRendered(
      `<html><body><div id="root"></div><script>${filler}</script></body></html>`,
    );
    expect(verdict.isJsRendered).toBe(true);
  });
});

describe("detectReviewWidgets", () => {
  it("names the widget so the warning can be specific", () => {
    expect(
      detectReviewWidgets(
        `<div class="bdreview"></div><script src="https://birdeye.com/embed.js"></script>`,
      ),
    ).toEqual(["Birdeye"]);
  });

  it("returns nothing on a page with real on-page testimonials", () => {
    expect(
      detectReviewWidgets(`<blockquote>Great service.</blockquote>`),
    ).toEqual([]);
  });
});
