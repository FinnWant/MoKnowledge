import type { z } from "zod";
import { loadSystemPrompt, PROMPT_EFFORT, type PromptId } from "./prompts";

/**
 * Thin wrapper around the Anthropic SDK.
 *
 * The contract that matters: `runPrompt` returns `null` whenever a live call
 * isn't possible or didn't produce valid output — no key, SDK missing, API
 * error, schema mismatch. Callers never branch on why; they fall back to the
 * mock generator. ROADMAP §10 requires the default clone-and-run path to work
 * with no key at all, so an absent key is a normal state, not an error.
 *
 * Server-side only. The key is read from the environment inside the scrape route
 * and never reaches the client bundle.
 */

export const MODEL = "claude-opus-5";
export const MAX_TOKENS = 16_000;

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type PromptRun<T> = {
  promptId: PromptId;
  jsonSchema: Record<string, unknown>;
  responseSchema: z.ZodType<T>;
  userMessage: string;
};

export type PromptOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/**
 * Executes one prompt and validates the response.
 *
 * Structured outputs (`output_config.format`) replace the assistant-prefill
 * pattern entirely — prefill returns a 400 on this model, and the schema removes
 * the stop-sequence and parse-retry scaffolding that used to go with it. No
 * `temperature`/`top_p`: they are rejected outright, so variance is steered by
 * the prompt text instead.
 */
export async function runPrompt<T>(run: PromptRun<T>): Promise<PromptOutcome<T>> {
  if (!hasApiKey()) return { ok: false, reason: "no-api-key" };

  let Anthropic: typeof import("@anthropic-ai/sdk").default;
  try {
    // Imported dynamically so the default, key-free path never loads the SDK.
    ({ default: Anthropic } = await import("@anthropic-ai/sdk"));
  } catch {
    return { ok: false, reason: "sdk-not-installed" };
  }

  const client = new Anthropic();
  const system = loadSystemPrompt(run.promptId);

  let raw: unknown;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Adaptive thinking is the default on this model; stated for clarity.
      thinking: { type: "adaptive" },
      output_config: {
        effort: PROMPT_EFFORT[run.promptId],
        format: { type: "json_schema", schema: run.jsonSchema },
      },
      system: [
        {
          type: "text",
          text: system,
          // The system block is identical for every company we ever scrape, so
          // it caches once and is read on every subsequent enrichment. Nothing
          // company-specific goes above this line.
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: run.userMessage }],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, reason: "refusal" };
    }
    if (response.stop_reason === "max_tokens") {
      // Structured output guarantees shape, not completeness — a truncated
      // response can still parse. Reject it rather than store half a profile.
      return { ok: false, reason: "truncated" };
    }

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (!text.trim()) return { ok: false, reason: "empty-response" };

    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: describeError(error) };
  }

  const parsed = run.responseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: `schema-mismatch: ${parsed.error.issues[0]?.message}` };
  }

  return { ok: true, value: parsed.data };
}

function describeError(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid-json";

  const candidate = error as { status?: number; name?: string; message?: string };
  if (typeof candidate.status === "number") {
    // Named rather than typed against the SDK's error classes so this file
    // still compiles when the optional dependency isn't installed.
    if (candidate.status === 401) return "auth-failed";
    if (candidate.status === 429) return "rate-limited";
    if (candidate.status >= 500) return "api-unavailable";
    return `api-error-${candidate.status}`;
  }
  return candidate.message ?? "unknown-error";
}
