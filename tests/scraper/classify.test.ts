import { describe, expect, it } from "vitest";
import { classifyUrl, HIGH_VALUE_ROLES } from "@/lib/scraper/classify";

describe("classifyUrl", () => {
  it.each([
    ["https://example.com/", "home"],
    ["https://example.com/about", "about"],
    ["https://example.com/about-us/", "about"],
    ["https://example.com/our-story", "about"],
    ["https://example.com/services", "services"],
    ["https://example.com/what-we-do", "services"],
    ["https://example.com/contact-us", "contact"],
    ["https://example.com/our-team", "team"],
    ["https://example.com/testimonials", "testimonials"],
    ["https://example.com/reviews", "testimonials"],
    ["https://example.com/pricing", "pricing"],
    ["https://example.com/faq", "faq"],
    ["https://example.com/blog", "blog-index"],
    ["https://example.com/blog/how-deep-should-a-well-be", "blog-post"],
    ["https://example.com/2025/03/well-maintenance", "blog-post"],
    ["https://example.com/privacy-policy", "legal"],
  ])("%s -> %s", (url, role) => {
    expect(classifyUrl(url).role).toBe(role);
  });

  it("ranks the pages that carry knowledge above the ones that don't", () => {
    // This ordering is the whole value of the classifier: with a 20-page budget
    // on a 200-page site, About must beat a 2019 blog post.
    const priority = (url: string) => classifyUrl(url).priority;

    expect(priority("https://example.com/")).toBeGreaterThan(
      priority("https://example.com/about"),
    );
    expect(priority("https://example.com/about")).toBeGreaterThan(
      priority("https://example.com/blog/old-post"),
    );
    expect(priority("https://example.com/services")).toBeGreaterThan(
      priority("https://example.com/privacy-policy"),
    );
  });

  it("falls back to anchor text when the path says nothing", () => {
    const blind = classifyUrl("https://example.com/p/12345");
    expect(blind.role).toBe("other");

    const hinted = classifyUrl("https://example.com/p/12345", "About Our Company");
    expect(hinted.role).toBe("about");
    // Lower confidence than a path match, and ranked below one.
    expect(hinted.confidence).toBeLessThan(0.9);
    expect(hinted.priority).toBeLessThan(
      classifyUrl("https://example.com/about").priority,
    );
  });

  it("prefers a shallow unclassified path over a deep one", () => {
    expect(classifyUrl("https://example.com/well-drilling").priority).toBeGreaterThan(
      classifyUrl("https://example.com/a/b/c/d").priority,
    );
  });

  it("treats every role it ranks highly as high-value", () => {
    for (const url of [
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/services",
      "https://example.com/contact",
    ]) {
      expect(HIGH_VALUE_ROLES.has(classifyUrl(url).role)).toBe(true);
    }
    expect(HIGH_VALUE_ROLES.has(classifyUrl("https://example.com/terms").role)).toBe(
      false,
    );
  });
});
