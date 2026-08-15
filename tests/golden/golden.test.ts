import { describe, expect, it } from "vitest";
import { GOLDEN_SITES } from "./sites";
import { goldenProfileSchema, loadGolden } from "./schema";
import { capturedSlugs } from "../fixtures/load";

/**
 * The transcribed reference profiles.
 *
 * These assertions are about the *data entry*, not the scraper. Transcription
 * errors are silent and would corrupt every accuracy claim built on top of them,
 * so the counts that were verified by hand against the PDF are pinned here.
 */

const slugs = GOLDEN_SITES.map((site) => site.slug);

describe("golden profiles", () => {
  it("has a file for all eight reference companies", () => {
    expect(slugs).toHaveLength(8);
  });

  it.each(slugs)("%s parses against the golden schema", (slug) => {
    const result = goldenProfileSchema.safeParse(loadGolden(slug));
    expect(result.success ? null : result.error.issues).toBeNull();
  });

  it.each(slugs)("%s matches its site registry entry", (slug) => {
    const golden = loadGolden(slug);
    const site = GOLDEN_SITES.find((candidate) => candidate.slug === slug);
    expect(golden.url).toBe(site?.url);
    expect(golden.referenceGeneratedAt).toBe("2026-02-13");
  });

  it("pins the record counts verified by hand against the PDF", () => {
    // Each of these caught a real extraction bug. Account IT's 8 offerings
    // exposed that the reference omits the blank line between some entries;
    // Night Owl's 8 people exposed that two of them have no gender line.
    const expected: Record<string, { people: number; offerings: number }> = {
      "account-it": { people: 1, offerings: 8 },
      "bee-cave-drilling": { people: 8, offerings: 13 },
      "elevation-group-az": { people: 3, offerings: 14 },
      "jd-insurance": { people: 0, offerings: 11 },
      "luxury-homes-las-vegas": { people: 2, offerings: 10 },
      moflo: { people: 9, offerings: 15 },
      "night-owl-monitoring": { people: 8, offerings: 10 },
      "planet-orange": { people: 0, offerings: 14 },
    };

    for (const [slug, counts] of Object.entries(expected)) {
      const golden = loadGolden(slug);
      expect(golden.records.people.length, `${slug} people`).toBe(counts.people);
      expect(golden.records.offerings.length, `${slug} offerings`).toBe(
        counts.offerings,
      );
    }
  });

  it("confirms the sparsity that drives the whole schema design", () => {
    // ~40-60% fill is the normal case, not a failure. If this ever stops being
    // true, nullable-by-default and impact-weighted completeness lose their
    // justification and the design should be revisited.
    const all = slugs.map(loadGolden);
    const count = (pick: (g: (typeof all)[number]) => unknown) =>
      all.filter((golden) => pick(golden) !== null).length;

    expect(count((g) => g.exact.yearFounded)).toBe(3);
    expect(count((g) => g.exact.legalEntityType)).toBe(3);
    expect(count((g) => g.exact.employeeCount)).toBe(1);
    expect(count((g) => g.exact.revenue)).toBe(1);
    // Meanwhile the fields every profile has:
    expect(count((g) => g.exact.website)).toBe(8);
    expect(count((g) => g.exact.industry)).toBe(8);
  });

  it("records the reference defects we intend to diverge from", () => {
    // ROADMAP §2.3. Divergence here is a win, and scoring must not read it as a miss.
    expect(loadGolden("account-it").knownReferenceDefects[0]).toContain(
      "solid gray",
    );
    expect(loadGolden("moflo").knownReferenceDefects[0]).toContain("var(");
    expect(loadGolden("elevation-group-az").knownReferenceDefects[0]).toContain(
      "var(",
    );
  });

  it("keeps list items whole where a naive comma split would break them", () => {
    expect(loadGolden("account-it").sets.altNames).toEqual([
      "Account-it Consulting Services, LLC",
    ]);
    expect(loadGolden("bee-cave-drilling").sets.funnels).toContain(
      "Promotional Offers (e.g., Fall Water Well Savings)",
    );
  });

  it("holds URLs unbroken by PDF line-wrapping", () => {
    for (const slug of slugs) {
      const golden = loadGolden(slug);
      const urls = [
        golden.exact.logoUrl,
        ...Object.values(golden.exact.socials),
      ].filter((url): url is string => url !== null);

      for (const url of urls) {
        expect(url, `${slug}: ${url}`).not.toMatch(/\s/);
        expect(() => new URL(url)).not.toThrow();
      }
    }
  });

  it("has fixtures for every golden site that is still online", () => {
    const captured = capturedSlugs();
    const missing = slugs.filter((slug) => !captured.includes(slug));
    // See tests/golden/README.md — jd-insurance's domain now 404s at every path.
    expect(missing).toEqual(["jd-insurance"]);
  });
});
