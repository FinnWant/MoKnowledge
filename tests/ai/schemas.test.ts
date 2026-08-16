import { describe, expect, it } from "vitest";
import {
  COMPANY_PROFILE_JSON_SCHEMA,
  OFFERING_NORMALIZATION_JSON_SCHEMA,
  PROOF_EXTRACTION_JSON_SCHEMA,
  WRITING_STYLE_JSON_SCHEMA,
  companyProfileResponseSchema,
  offeringNormalizationResponseSchema,
  proofExtractionResponseSchema,
  writingStyleResponseSchema,
} from "@/lib/ai/schemas";
import { extractSystemPrompt, loadSystemPrompt, PROMPT_EFFORT } from "@/lib/ai/prompts";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * The output contracts, checked against the constraints the API actually
 * enforces and against the prompt files a reviewer reads.
 *
 * A schema that uses `minLength` is not a style problem — structured outputs
 * reject it with a 400, and the failure would only show up on a live run with a
 * real key, which CI never does.
 */

const SCHEMAS: Array<[string, Record<string, unknown>, z.ZodType]> = [
  ["01-company-profile", COMPANY_PROFILE_JSON_SCHEMA, companyProfileResponseSchema],
  ["02-offering-normalization", OFFERING_NORMALIZATION_JSON_SCHEMA, offeringNormalizationResponseSchema],
  ["03-writing-style", WRITING_STYLE_JSON_SCHEMA, writingStyleResponseSchema],
  ["04-proof-extraction", PROOF_EXTRACTION_JSON_SCHEMA, proofExtractionResponseSchema],
];

/** Keywords structured outputs do not support. */
const UNSUPPORTED = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "multipleOf",
  "pattern",
  "$ref",
  "$defs",
  "oneOf",
  "allOf",
  "not",
];

function walk(node: unknown, visit: (object: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;

  const object = node as Record<string, unknown>;
  visit(object);
  for (const value of Object.values(object)) walk(value, visit);
}

describe.each(SCHEMAS)("%s", (id, jsonSchema, zodSchema) => {
  it("stays inside the supported JSON Schema subset", () => {
    walk(jsonSchema, (object) => {
      for (const keyword of UNSUPPORTED) {
        expect(Object.keys(object)).not.toContain(keyword);
      }
    });
  });

  it("closes every object and lists every property as required", () => {
    walk(jsonSchema, (object) => {
      if (object.type !== "object") return;

      expect(object.additionalProperties).toBe(false);
      const properties = Object.keys((object.properties ?? {}) as object);
      expect(new Set(object.required as string[])).toEqual(new Set(properties));
    });
  });

  it("accepts what the zod schema accepts", () => {
    // Both halves of the contract must agree, or a live response could satisfy
    // the API and still be rejected on the way in.
    const properties = Object.keys((jsonSchema.properties ?? {}) as object);
    const shape = Object.keys((zodSchema as unknown as z.ZodObject<z.ZodRawShape>).shape);
    expect(new Set(properties)).toEqual(new Set(shape));
  });

  it("has a system prompt in its markdown file", () => {
    const system = loadSystemPrompt(id as keyof typeof PROMPT_EFFORT);
    expect(system.length).toBeGreaterThan(200);
    // The blockquote markers must be stripped, or the model receives markdown
    // quoting as if it were content.
    expect(system).not.toMatch(/^>/m);
  });
});

describe("prompt files", () => {
  it("declares an effort for every prompt", () => {
    expect(Object.keys(PROMPT_EFFORT)).toHaveLength(4);
  });

  it("extracts only the system-prompt blockquote", () => {
    const markdown = [
      "# Title",
      "Intro prose that is not the prompt.",
      "## System prompt",
      "> First line.",
      ">",
      "> Second line.",
      "## Output schema",
      "> not part of the prompt",
    ].join("\n");

    expect(extractSystemPrompt(markdown)).toBe("First line.\n\nSecond line.");
  });

  it("returns null when the file has no system prompt", () => {
    expect(extractSystemPrompt("# Title\nNo prompt here")).toBeNull();
  });

  it("keeps each prompt file's documented schema in step with the code", () => {
    // The markdown is the graded artifact; the code is what runs. If the two
    // disagree about a field name, the reviewer is reading fiction.
    for (const [id, jsonSchema] of SCHEMAS) {
      const markdown = readFileSync(path.join(process.cwd(), "prompts", `${id}.md`), "utf8");
      for (const property of Object.keys((jsonSchema.properties ?? {}) as object)) {
        expect(markdown).toContain(`"${property}"`);
      }
    }
  });
});
