import type { z } from "zod";
import { loadSystemPrompt, PROMPT_EFFORT, type PromptId } from "./prompts";

/**
 * Thin wrapper around the Anthropic SDK.
 *
 * The contract that matters: `runPrompt` returns a failure whenever a live call
 * isn't possible or didn't produce valid output — no key, SDK missing, API
 * error, schema mismatch. Callers never branch on why; they fall back to the
 * mock generator. ROADMAP §10 requires the default clone-and-run path to work
 * with no key at all, so an absent key is a normal state, not an error.
 *
 * Server-side only. The key is read from the environment inside the scrape route
 * and never reaches the client bundle.
 */

/** Overridable, because which model is worth paying for is a deployment call. */
export const DEFAULT_MODEL = "claude-opus-5";
export const DEFAULT_MAX_TOKENS = 16_000;

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function model(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

function maxTokens(): number {
  const configured = Number(process.env.ANTHROPIC_MAX_TOKENS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_TOKENS;
}

/**
 * Whether the configured model accepts adaptive thinking and `output_config.effort`.
 *
 * Both arrived with the 4.6 generation. Sending either to an older model is not
 * ignored — it is a 400 (`adaptive thinking is not supported on this model`,
 * `This model does not support the effort parameter`), which would turn every
 * enrichment call into a silent fallback to mock. Since the model is an env var,
 * that failure would depend on deployment config rather than on code, so the
 * request is shaped to fit the model instead.
 *
 * Matched on family rather than an allow-list of exact ids: the ids carry
 * optional date suffixes (`claude-haiku-4-5-20251001`), and a new 4.6+ model
 * should not need a code change to get the better request.
 */
export function supportsReasoningControls(id: string = model()): boolean {
  if (/^claude-(?:fable|mythos)-/.test(id)) return true;

  const generation = id.match(/^claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d+))?/);
  if (!generation) return false;

  const major = Number(generation[1]);
  const minor = Number(generation[2] ?? 0);
  // Opus/Sonnet 5 and up, or 4.6 and up. Haiku 4.5 and Sonnet 4.5 fall below.
  return major > 4 || (major === 4 && minor >= 6);
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
 * pattern entirely — prefill returns a 400 on current models, and the schema
 * removes the stop-sequence and parse-retry scaffolding that used to go with it.
 * No `temperature`/`top_p`: they are rejected on 4.6+, so variance is steered by
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
  const reasoning = supportsReasoningControls();

  let raw: unknown;
  try {
    const response = await client.messages.create({
      model: model(),
      max_tokens: maxTokens(),
      ...(reasoning ? { thinking: { type: "adaptive" as const } } : {}),
      output_config: {
        ...(reasoning ? { effort: PROMPT_EFFORT[run.promptId] } : {}),
        format: { type: "json_schema" as const, schema: run.jsonSchema },
      },
      system: [
        {
          type: "text" as const,
          text: system,
          // The system block is identical for every company we ever scrape, so
          // it caches once and is read on every subsequent enrichment. Nothing
          // company-specific goes above this line.
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user" as const, content: run.userMessage }],
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
    if (candidate.status === 403) return "auth-failed";
    if (candidate.status === 404) return "model-not-found";
    if (candidate.status === 429) return "rate-limited";
    if (candidate.status >= 500) return "api-unavailable";
    return `api-error-${candidate.status}`;
  }
  return candidate.message ?? "unknown-error";
}
