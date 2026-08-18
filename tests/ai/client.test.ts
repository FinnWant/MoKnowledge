import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRIES,
  runPrompt,
  supportsReasoningControls,
} from "@/lib/ai/client";
import { COMPANY_PROFILE_JSON_SCHEMA } from "@/lib/ai/schemas";

/**
 * The provider seam (ROADMAP §10).
 *
 * Two questions run through this file. First: does the request we send match
 * what the model we configured actually accepts — because the model is an env
 * var, and the reasoning controls that are mandatory on one generation are a 400
 * on the previous one. Second: when a call fails for any reason at all, does it
 * end in a named failure rather than an exception, so enrichment falls back to
 * mock instead of taking the scrape down with it.
 */

const create = vi.fn();
/** Client options, so the timeout and retry budget can be asserted. */
const constructed: unknown[] = [];

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  // The error classes are real: `describeError` matches on constructor name, so
  // a stubbed stand-in would prove nothing about the code that runs.
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  return {
    ...actual,
    default: class {
      messages = { create };
      constructor(options?: unknown) {
        constructed.push(options);
      }
    },
  };
});

beforeEach(() => {
  create.mockReset();
  constructed.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ------------------------------------------------- the capability gate */

describe("supportsReasoningControls", () => {
  it("is on for 4.6 and later, where adaptive thinking and effort exist", () => {
    for (const id of [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-fable-5",
    ]) {
      expect(supportsReasoningControls(id), id).toBe(true);
    }
  });

  it("is off for 4.5 and earlier, which reject both parameters", () => {
    for (const id of [
      "claude-haiku-4-5",
      // The dated form is what the console hands you, and it must not change
      // the answer — this is the id the project is currently configured with.
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-5",
      "claude-opus-4-5-20251101",
    ]) {
      expect(supportsReasoningControls(id), id).toBe(false);
    }
  });

  it("does not guess about an id it cannot parse", () => {
    expect(supportsReasoningControls("some-other-model")).toBe(false);
  });
});

/* --------------------------------------------------------------- the call */

const run = {
  promptId: "01-company-profile" as const,
  jsonSchema: COMPANY_PROFILE_JSON_SCHEMA,
  responseSchema: z.object({ overview: z.object({ value: z.string().nullable() }) }),
  userMessage: "evidence goes here",
};

const good = { overview: { value: "A real overview." } };

function reply(payload: unknown, stop_reason = "end_turn") {
  return {
    stop_reason,
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

function lastRequest() {
  return create.mock.calls[0][0];
}

describe("runPrompt", () => {
  it("does not call anything without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    expect(await runPrompt(run)).toEqual({ ok: false, reason: "no-api-key" });
    expect(create).not.toHaveBeenCalled();
  });

  it("asks for the schema, and sends the prompt file as the system block", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    create.mockResolvedValue(reply(good));

    expect(await runPrompt(run)).toEqual({ ok: true, value: good });

    const body = lastRequest();
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.output_config.format).toEqual({
      type: "json_schema",
      schema: COMPANY_PROFILE_JSON_SCHEMA,
    });
    // The prompt file is the system message, verbatim — that claim is what
    // makes prompts/ the real artifact rather than documentation.
    expect(body.system[0].text).toContain("MoFlo");
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.messages[0].content).toBe("evidence goes here");
  });

  it("sends the reasoning controls when the model has them", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-opus-5");
    create.mockResolvedValue(reply(good));

    await runPrompt(run);

    const body = lastRequest();
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config.effort).toBe("medium");
  });

  it("omits them for a model that answers 400 to either one", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001");
    create.mockResolvedValue(reply(good));

    await runPrompt(run);

    const body = lastRequest();
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    expect(body.thinking).toBeUndefined();
    expect(body.output_config.effort).toBeUndefined();
    // The schema is not a reasoning control and must survive the downgrade.
    expect(body.output_config.format.type).toBe("json_schema");
  });

  it("names the failure so the report can say why it fell back", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");

    const cases: Array<[number, string]> = [
      [401, "auth-failed"],
      [403, "auth-failed"],
      [404, "model-not-found"],
      [429, "rate-limited"],
      [503, "api-unavailable"],
      [418, "api-error-418"],
    ];

    for (const [status, reason] of cases) {
      create.mockRejectedValueOnce(Object.assign(new Error("nope"), { status }));
      expect(await runPrompt(run), String(status)).toEqual({ ok: false, reason });
    }
  });

  it("names a timeout and a connection failure from the SDK's own error types", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    const sdk = await import("@anthropic-ai/sdk");

    // These carry `name: "Error"` — only the constructor identifies them, which
    // is exactly the trap `describeError` is written around.
    create.mockRejectedValueOnce(
      new sdk.APIConnectionTimeoutError({ message: "Request timed out." }),
    );
    expect(await runPrompt(run)).toEqual({ ok: false, reason: "timeout" });

    create.mockRejectedValueOnce(
      new sdk.APIConnectionError({ message: "Connection error." }),
    );
    expect(await runPrompt(run)).toEqual({ ok: false, reason: "network-error" });
  });

  it("bounds the call so one hang cannot eat the scrape route's budget", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    create.mockResolvedValue(reply(good));

    await runPrompt(run);

    // The SDK defaults to 10 minutes and two retries; the route only has 300s
    // for the whole scrape, enrichment included.
    expect(constructed[0]).toEqual({ timeout: DEFAULT_TIMEOUT_MS, maxRetries: MAX_RETRIES });
    expect(DEFAULT_TIMEOUT_MS * (MAX_RETRIES + 1) * 4).toBeLessThan(275_000);
  });

  it("rejects a truncated response rather than storing half a profile", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    create.mockResolvedValue(reply(good, "max_tokens"));

    expect(await runPrompt(run)).toEqual({ ok: false, reason: "truncated" });
  });

  it("reports a refusal rather than treating it as an empty answer", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    create.mockResolvedValue({ stop_reason: "refusal", content: [] });

    expect(await runPrompt(run)).toEqual({ ok: false, reason: "refusal" });
  });

  it("reports a network failure without throwing into the scrape", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    create.mockRejectedValue(new Error("socket hang up"));

    expect(await runPrompt(run)).toEqual({ ok: false, reason: "socket hang up" });
  });

  it("fails validation rather than trusting a well-formed wrong answer", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    create.mockResolvedValue(reply({ overview: "a bare string" }));

    const outcome = await runPrompt(run);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/^schema-mismatch/);
  });

  it("treats an empty completion as a failure, not an empty profile", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "key");
    create.mockResolvedValue({ stop_reason: "end_turn", content: [] });

    expect(await runPrompt(run)).toEqual({ ok: false, reason: "empty-response" });
  });
});
