import { z } from "zod";
import {
  businessModelSchema,
  companyRoleSchema,
  toneSchema,
  trustStatCategorySchema,
} from "@/lib/schema";

/**
 * Output contracts for the four enrichment prompts.
 *
 * Each contract exists twice, deliberately:
 *
 * - a **JSON Schema** sent as `output_config.format`, which constrains what the
 *   model can emit;
 * - a **zod schema** that re-validates the response on the way in.
 *
 * The second is not redundant. Structured outputs guarantee shape, not truth,
 * and a `stop_reason: "max_tokens"` truncation can still produce something that
 * parses. Validating through zod means a malformed response degrades to the mock
 * generator instead of putting a half-built object into the knowledge base.
 *
 * The JSON Schemas are hand-written to match `prompts/*.md` exactly rather than
 * generated from the zod schemas, because the prompt files are the graded
 * artifact and a generator would drift from them. `tests/ai/schemas.test.ts`
 * asserts they stay inside the supported JSON Schema subset.
 */

/* ------------------------------------------------ 01 — company profile */

const generatedField = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  sourceUrls: z.array(z.string()),
});

/**
 * `businessModel` and `companyRole` are enumerated because both are controlled
 * values in the knowledge base: the prompt classifies rather than describes, and
 * prose would have nowhere to land.
 */
const businessModelField = z.object({
  value: businessModelSchema.nullable(),
  confidence: z.number().min(0).max(1),
  sourceUrls: z.array(z.string()),
});

const companyRoleField = z.object({
  value: companyRoleSchema.nullable(),
  confidence: z.number().min(0).max(1),
  sourceUrls: z.array(z.string()),
});

/** `[]` rather than `null` for "found none" — see the prompt file's note. */
const generatedListField = z.object({
  value: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  sourceUrls: z.array(z.string()),
});

export const companyProfileResponseSchema = z.object({
  overview: generatedField,
  industry: generatedField,
  businessModel: businessModelField,
  companyRole: companyRoleField,
  serviceLocations: generatedListField,
  pitch: generatedField,
  foundingStory: generatedField,
  customerNeeds: generatedField,
  idealPersona: generatedField,
  buyers: generatedListField,
});

export type CompanyProfileResponse = z.infer<typeof companyProfileResponseSchema>;

const FIELD_DEF = {
  type: "object",
  additionalProperties: false,
  required: ["value", "confidence", "sourceUrls"],
  properties: {
    value: { type: ["string", "null"] },
    confidence: { type: "number" },
    sourceUrls: { type: "array", items: { type: "string" } },
  },
} as const;

const LIST_FIELD_DEF = {
  type: "object",
  additionalProperties: false,
  required: ["value", "confidence", "sourceUrls"],
  properties: {
    value: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
    sourceUrls: { type: "array", items: { type: "string" } },
  },
} as const;

export const COMPANY_PROFILE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "overview",
    "industry",
    "businessModel",
    "companyRole",
    "serviceLocations",
    "pitch",
    "foundingStory",
    "customerNeeds",
    "idealPersona",
    "buyers",
  ],
  properties: {
    overview: FIELD_DEF,
    industry: FIELD_DEF,
    serviceLocations: LIST_FIELD_DEF,
    buyers: LIST_FIELD_DEF,
    companyRole: {
      type: "object",
      additionalProperties: false,
      required: ["value", "confidence", "sourceUrls"],
      properties: {
        value: {
          type: ["string", "null"],
          enum: [...companyRoleSchema.options, null],
        },
        confidence: { type: "number" },
        sourceUrls: { type: "array", items: { type: "string" } },
      },
    },
    businessModel: {
      type: "object",
      additionalProperties: false,
      required: ["value", "confidence", "sourceUrls"],
      properties: {
        value: {
          type: ["string", "null"],
          enum: [...businessModelSchema.options, null],
        },
        confidence: { type: "number" },
        sourceUrls: { type: "array", items: { type: "string" } },
      },
    },
    pitch: FIELD_DEF,
    foundingStory: FIELD_DEF,
    customerNeeds: FIELD_DEF,
    idealPersona: FIELD_DEF,
  },
};

/* ------------------------------------------ 02 — offering normalization */

export const offeringCategoryValues = [
  "product",
  "service",
  "package",
  "subscription",
  "consultation",
  "financing",
  "industry-solution",
  "other",
] as const;

export const offeringNormalizationResponseSchema = z.object({
  offerings: z.array(
    z.object({
      name: z.string(),
      category: z.enum(offeringCategoryValues),
      description: z.string(),
      features: z.array(z.string()),
      pricing: z.string().nullable(),
      /** Indexes into the candidate list — what makes a merge auditable. */
      sourceCandidateIndexes: z.array(z.number().int().nonnegative()),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export type OfferingNormalizationResponse = z.infer<
  typeof offeringNormalizationResponseSchema
>;

export const OFFERING_NORMALIZATION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["offerings"],
  properties: {
    offerings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "category",
          "description",
          "features",
          "pricing",
          "sourceCandidateIndexes",
          "confidence",
        ],
        properties: {
          name: { type: "string" },
          category: { type: "string", enum: [...offeringCategoryValues] },
          description: { type: "string" },
          features: { type: "array", items: { type: "string" } },
          pricing: { type: ["string", "null"] },
          sourceCandidateIndexes: {
            type: "array",
            items: { type: "integer" },
          },
          confidence: { type: "number" },
        },
      },
    },
  },
};

/* -------------------------------------------------- 03 — writing style */

export const writingStyleResponseSchema = z.object({
  description: z.string(),
  tone: z.array(toneSchema),
  formality: z.enum(["casual", "neutral", "formal"]),
  readerAddress: z.enum(["second-person", "third-person", "mixed"]),
  preferredTerms: z.array(z.string()),
  avoidTerms: z.array(z.string()),
  ctaStyle: z.string(),
  confidence: z.number().min(0).max(1),
});

export type WritingStyleResponse = z.infer<typeof writingStyleResponseSchema>;

export const WRITING_STYLE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "description",
    "tone",
    "formality",
    "readerAddress",
    "preferredTerms",
    "avoidTerms",
    "ctaStyle",
    "confidence",
  ],
  properties: {
    description: { type: "string" },
    tone: {
      type: "array",
      items: { type: "string", enum: [...toneSchema.options] },
    },
    formality: { type: "string", enum: ["casual", "neutral", "formal"] },
    readerAddress: {
      type: "string",
      enum: ["second-person", "third-person", "mixed"],
    },
    preferredTerms: { type: "array", items: { type: "string" } },
    avoidTerms: { type: "array", items: { type: "string" } },
    ctaStyle: { type: "string" },
    confidence: { type: "number" },
  },
};

/* ----------------------------------------------- 04 — proof extraction */

export const credentialKindValues = [
  "license",
  "certification",
  "membership",
  "accreditation",
  "award",
] as const;

export const proofExtractionResponseSchema = z.object({
  testimonials: z.array(
    z.object({
      /** Must be a verbatim substring of the source — checked in lib/ai/verify.ts. */
      quote: z.string(),
      authorName: z.string().nullable(),
      authorRole: z.string().nullable(),
      rating: z.number().nullable(),
      sourceUrl: z.string(),
      topics: z.array(z.string()),
      mentionsPeople: z.array(z.string()),
      confidence: z.number().min(0).max(1),
    }),
  ),
  credentials: z.array(
    z.object({
      name: z.string(),
      issuer: z.string().nullable(),
      kind: z.enum(credentialKindValues),
      sourceUrl: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  trustStats: z.array(
    z.object({
      claim: z.string(),
      value: z.number().nullable(),
      unit: z.string().nullable(),
      category: trustStatCategorySchema,
      sourceUrl: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

export type ProofExtractionResponse = z.infer<typeof proofExtractionResponseSchema>;

export const PROOF_EXTRACTION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["testimonials", "credentials", "trustStats"],
  properties: {
    testimonials: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "quote",
          "authorName",
          "authorRole",
          "rating",
          "sourceUrl",
          "topics",
          "mentionsPeople",
          "confidence",
        ],
        properties: {
          quote: { type: "string" },
          authorName: { type: ["string", "null"] },
          authorRole: { type: ["string", "null"] },
          rating: { type: ["number", "null"] },
          sourceUrl: { type: "string" },
          topics: { type: "array", items: { type: "string" } },
          mentionsPeople: { type: "array", items: { type: "string" } },
          confidence: { type: "number" },
        },
      },
    },
    credentials: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "issuer", "kind", "sourceUrl", "confidence"],
        properties: {
          name: { type: "string" },
          issuer: { type: ["string", "null"] },
          kind: { type: "string", enum: [...credentialKindValues] },
          sourceUrl: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
    trustStats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "claim",
          "value",
          "unit",
          "category",
          "sourceUrl",
          "confidence",
        ],
        properties: {
          claim: { type: "string" },
          value: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          category: {
            type: "string",
            enum: [...trustStatCategorySchema.options],
          },
          sourceUrl: { type: "string" },
          confidence: { type: "number" },
        },
      },
    },
  },
};
