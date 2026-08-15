import { z } from "zod";
import { extractionMethodSchema } from "./sourced";

/** ISO-8601 instant, e.g. `2026-08-15T14:03:00.000Z`. */
export const timestampSchema = z.iso.datetime();

/**
 * A URL as it appeared on the page. Deliberately loose: real SMB sites emit
 * protocol-relative, relative, and outright malformed hrefs, and dropping them
 * would lose provenance we can still show the user. Normalization happens in the
 * crawler; strict validation is reserved for user input.
 */
export const urlSchema = z.string();

/** Strict validator for the URL the user types into the scrape form (R9). */
export const websiteInputSchema = z
  .string()
  .trim()
  .min(1, "Enter a website address")
  .refine((raw) => {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(withProtocol);
      return url.hostname.includes(".") && !url.hostname.endsWith(".");
    } catch {
      return false;
    }
  }, "That doesn't look like a website address (try example.com)");

/**
 * Provenance carried by an individual record inside a collection.
 *
 * Scalar fields use the `Sourced<T>` envelope; records use this instead, so a
 * person or offering gets one badge and one Revert rather than a badge per
 * sub-field. That matches the record card in docs/EDIT-UX.md §4, where the
 * whole card is the unit a reviewer accepts or removes.
 *
 * The surrounding collection is still `Sourced<T[]>`, which is what carries
 * collection-level state such as "review widget detected, content is JS-rendered".
 */
export const recordProvenanceSchema = z.object({
  /** Stable within a knowledge base; used for cross-references and React keys. */
  id: z.string(),
  method: extractionMethodSchema,
  confidence: z.number().min(0).max(1),
  sourceUrls: z.array(urlSchema),
  note: z.string().optional(),
});

export type RecordProvenance = z.infer<typeof recordProvenanceSchema>;

/** Builds a record schema: the caller's fields plus the provenance envelope. */
export function record<Shape extends z.ZodRawShape>(shape: Shape) {
  return recordProvenanceSchema.extend(shape);
}

/**
 * Postal address. `formatted` is the single line a human reads and edits; the
 * parts are populated when JSON-LD `PostalAddress` supplies them, and stay null
 * when the address came from a footer regex. Keeping both means the structured
 * form survives into the Supabase design (R20) without forcing the UI to expose
 * six inputs for a value most users just want to correct as text.
 */
export const addressSchema = z.object({
  formatted: z.string(),
  street: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
});

export type Address = z.infer<typeof addressSchema>;

export const mediaKindSchema = z.enum([
  "logo",
  "client-logo",
  "badge",
  "photo",
  "icon",
  "other",
]);

export const mediaRefSchema = record({
  url: urlSchema,
  alt: z.string().nullable(),
  kind: mediaKindSchema,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});

export type MediaRef = z.infer<typeof mediaRefSchema>;

/**
 * A brand colour with the role it plays, rather than a bare hex list.
 * ROADMAP §2.3: the reference outputs return three flat colours; a content
 * generator needs to know which one is the background and which is the accent.
 */
export const colorRoleSchema = z.enum([
  "background",
  "surface",
  "text",
  "primary",
  "secondary",
  "accent",
  "border",
  "unknown",
]);

export const brandColorSchema = record({
  /** Canonical lowercase `#rrggbb`. Resolved from `var(--x)` where needed. */
  hex: z.string().regex(/^#[0-9a-f]{6}$/, "Expected canonical #rrggbb"),
  role: colorRoleSchema,
  /** Weighted occurrence count across the crawled CSS and inline styles. */
  frequency: z.number().int().nonnegative(),
});

export type BrandColor = z.infer<typeof brandColorSchema>;
