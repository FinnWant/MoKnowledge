/**
 * The golden set: the eight companies profiled in `Knowledge Outputs 2.13.26.pdf`.
 *
 * Having eight real websites paired with the output the grader's own system
 * produced for them turns "our scraper seems good" into a measured claim. Full
 * methodology, including why the reference is a peer rather than a ground truth,
 * is in docs/VALIDATION.md.
 */

export type GoldenSite = {
  slug: string;
  name: string;
  url: string;
  industry: string;
  /** What this site specifically exercises, from docs/VALIDATION.md §1. */
  testsFor: string;
};

export const GOLDEN_SITES: readonly GoldenSite[] = [
  {
    slug: "account-it",
    name: "Account IT",
    url: "https://account-it.net",
    industry: "Accounting / tax",
    testsFor:
      "Sparse profile — no employee count, no revenue. Graceful degradation, plus the richest Suppliers list (13 vendors) for vendor detection.",
  },
  {
    slug: "bee-cave-drilling",
    name: "Bee Cave Drilling",
    url: "https://beecavedrilling.com",
    industry: "Well drilling",
    testsFor:
      "The densest profile: 14 offerings, 8 people, 2 locations. Every person is testimonial-derived, so it is the primary `proof` test.",
  },
  {
    slug: "elevation-group-az",
    name: "Elevation Group AZ",
    url: "https://elevationgroupaz.com",
    industry: "Real estate",
    testsFor:
      "Has Industry Outlook. Reference leaked `var(--e-global-typography-…)` — the CSS-variable resolution test.",
  },
  {
    slug: "jd-insurance",
    name: "J&D Insurance Associates",
    url: "https://jdinsassociates.com",
    industry: "Insurance",
    testsFor: "Regulated industry, bilingual EN/ES — compliance and locale signals.",
  },
  {
    slug: "luxury-homes-las-vegas",
    name: "Luxury Homes Las Vegas",
    url: "https://luxuryhomeslasvegas.com",
    industry: "Luxury real estate",
    testsFor:
      "Press mentions (LEI Magazine, LV Review Journal, Mansion Global) — the `pressMentions` test.",
  },
  {
    slug: "moflo",
    name: "MoFlo",
    url: "https://moflo.ai",
    industry: "AI software",
    testsFor:
      "The grader's own company. Only profile with Employee Count; reference leaked `var(--font-family)`.",
  },
  {
    slug: "night-owl-monitoring",
    name: "Night Owl Monitoring",
    url: "https://nightowlmonitoring.com",
    industry: "IoT / water monitoring",
    testsFor:
      "Blog-heavy with FAQ sections and a glossary — the primary `contentIntelligence` test.",
  },
  {
    slug: "planet-orange",
    name: "Planet Orange",
    url: "https://planetorange.com",
    industry: "Pest control",
    testsFor:
      "Only profile with Revenue; state-licensed inspectors — the credentials test.",
  },
] as const;

export function goldenSite(slug: string): GoldenSite | undefined {
  return GOLDEN_SITES.find((site) => site.slug === slug);
}
