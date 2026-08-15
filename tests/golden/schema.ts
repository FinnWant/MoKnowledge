import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Shape of a transcribed golden profile.
 *
 * Validated in the test suite so a hand-edited golden file can't quietly drift
 * into a shape the scoring harness will mis-read. Field classes mirror
 * docs/VALIDATION.md §3.
 */

const GOLDEN_ROOT = fileURLToPath(new URL(".", import.meta.url));

export const goldenProfileSchema = z.object({
  slug: z.string(),
  name: z.string(),
  url: z.string(),
  source: z.literal("Knowledge Outputs 2.13.26.pdf"),
  referenceGeneratedAt: z.string(),
  /** Where the reference is wrong and a disagreement counts as a win. */
  knownReferenceDefects: z.array(z.string()),

  /** Compared by normalized equality. */
  exact: z.object({
    website: z.string().nullable(),
    industry: z.string().nullable(),
    companyRole: z.string().nullable(),
    yearFounded: z.number().int().nullable(),
    legalEntityType: z.string().nullable(),
    employeeCount: z.number().int().nullable(),
    revenue: z.string().nullable(),
    mainAddress: z.string().nullable(),
    logoUrl: z.string().nullable(),
    socials: z.record(z.string(), z.string()),
  }),

  /** Compared by precision / recall with fuzzy member matching. */
  sets: z.object({
    serviceLocations: z.array(z.string()),
    otherLocations: z.array(z.string()),
    altNames: z.array(z.string()),
    buyers: z.array(z.string()),
    industryGroupings: z.array(z.string()),
    channels: z.array(z.string()),
    funnels: z.array(z.string()),
    ctas: z.array(z.string()),
    suppliers: z.array(z.string()),
    fonts: z.array(z.string()),
    colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/)),
  }),

  /** Compared by record-level F1, matched on name. */
  records: z.object({
    people: z.array(
      z.object({
        name: z.string(),
        title: z.string().nullable(),
        gender: z.string().nullable(),
      }),
    ),
    offerings: z.array(
      z.object({
        name: z.string(),
        category: z.string().nullable(),
        pricing: z.string().nullable(),
      }),
    ),
  }),
});

export type GoldenProfile = z.infer<typeof goldenProfileSchema>;

export function loadGolden(slug: string): GoldenProfile {
  const file = path.join(GOLDEN_ROOT, `${slug}.json`);
  return goldenProfileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
