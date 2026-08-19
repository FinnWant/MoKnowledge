import { loadEnv } from "./env";

/**
 * `npm run ai:check` — one live call, to answer "is enrichment actually on?"
 *
 * Enrichment degrades silently by design: any failure falls back to the labelled
 * mock so a scrape still produces a knowledge base. That is the right behaviour
 * in the app and a bad way to find out your key is wrong, so this script runs
 * the same code path with the failure reason printed instead of swallowed.
 *
 * It exercises `lib/ai/client.ts` itself rather than a bespoke request, which
 * means a green run here is evidence about the thing that actually runs.
 */

loadEnv(".env.local", ".env");

async function main(): Promise<void> {
  const { hasApiKey, model, runPrompt, supportsReasoningControls } = await import(
    "@/lib/ai/client"
  );
  const { WRITING_STYLE_JSON_SCHEMA, writingStyleResponseSchema } = await import(
    "@/lib/ai/schemas"
  );

  console.log(`model    : ${model()}`);
  console.log(`key      : ${describeKey(process.env.ANTHROPIC_API_KEY)}`);
  console.log(
    `request  : structured output${
      supportsReasoningControls()
        ? " + adaptive thinking + effort"
        : " only (this model rejects thinking/effort)"
    }`,
  );

  if (!hasApiKey()) {
    console.log(
      "\nNo ANTHROPIC_API_KEY set. Enrichment will use the labelled mock generator,\n" +
        "which is a supported path — see prompts/README.md.",
    );
    return;
  }

  console.log("\nRunning prompt 03 against the live endpoint…");
  const started = Date.now();
  const outcome = await runPrompt({
    promptId: "03-writing-style",
    jsonSchema: WRITING_STYLE_JSON_SCHEMA,
    responseSchema: writingStyleResponseSchema,
    userMessage: SAMPLE_EVIDENCE,
  });
  const elapsed = Date.now() - started;

  if (outcome.ok) {
    console.log(`\n✓ live enrichment is working (${elapsed}ms)`);
    console.log(JSON.stringify(outcome.value, null, 2).slice(0, 600));
    return;
  }

  console.log(`\n✗ the call failed after ${elapsed}ms: ${outcome.reason}`);

  const advice = ADVICE[outcome.reason] ?? ADVICE[outcome.reason.split(":")[0]];
  if (advice) console.log(`\n  ${advice}`);

  console.log("\n  Scrapes will still work — enrichment falls back to the mock generator.");
  process.exitCode = 1;
}

/** Enough to identify a key without putting it in a terminal transcript. */
function describeKey(key: string | undefined): string {
  if (!key) return "not set";
  return `${key.slice(0, 6)}… (${key.length} chars)`;
}

const ADVICE: Record<string, string> = {
  "auth-failed":
    "The key was rejected. Check it is a live API key from console.anthropic.com and that\n" +
    "  the workspace still has credit — an exhausted balance reports as an auth failure\n" +
    "  rather than a quota one.",
  "model-not-found":
    "That model id does not exist on this account. Check ANTHROPIC_MODEL in .env.local\n" +
    "  against the ids in console.anthropic.com; note that some ids carry a date suffix.",
  "sdk-not-installed": "Run `npm install` — @anthropic-ai/sdk is a dependency.",
  "rate-limited": "Rate limited. Wait and re-run.",
  truncated: "The response was cut off. Raise ANTHROPIC_MAX_TOKENS.",
  "api-error-400":
    "The request was rejected. The usual cause is a model that does not accept the\n" +
    "  parameters we sent — `supportsReasoningControls` in lib/ai/client.ts gates adaptive\n" +
    "  thinking and `effort` for exactly this reason, so a 400 here means an id it does not\n" +
    "  yet know about.",
  "schema-mismatch":
    "The model answered, but not in the shape lib/ai/schemas.ts requires. Structured\n" +
    "  output should make this impossible — if it happens, the schema and the prompt file\n" +
    "  have drifted apart.",
};

/**
 * One real company's evidence, trimmed to the shape `renderCompanyProfileMessage`
 * produces. Prompt 03 is the cheapest of the four to run — it takes metrics we
 * already computed rather than a full page corpus — which is what makes it the
 * right one for a smoke test.
 */
const SAMPLE_EVIDENCE = `COMPANY: Bee Cave Drilling
INDUSTRY: Water well drilling

MEASURED METRICS (computed in TypeScript, not by you):
- Average sentence length: 18.1 words
- Reading grade level: 9.2
- Passive voice: 8% of sentences
- First person plural ("we"): 34 occurrences
- Exclamation marks: 2

SAMPLE COPY:
"Serving Austin and the Texas Hill Country since 1980. We drill, case, and complete
residential and commercial water wells. Our crews handle permitting, mud control, and
site protection so you don't have to. Call us for a free site assessment."

"When your well stops producing, you need answers fast. We troubleshoot pressure tanks,
pumps, and controls, and we carry the parts to fix most problems on the first visit."`;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
