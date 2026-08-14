# AI Enrichment Prompts

Four prompts that turn scraped evidence into the knowledge base's generated fields.
These are the real artifacts — `lib/ai/` executes them verbatim when `ANTHROPIC_API_KEY`
is set, and the mock generator consumes the same templates when it isn't.

| Prompt | Technique demonstrated | Fills |
|---|---|---|
| [`01-company-profile.md`](01-company-profile.md) | Batched generation under hard grounding constraints | `foundation.overview`, `foundation.businessModel`, `positioning.pitch`, `positioning.foundingStory`, `market.customerNeeds`, `market.idealPersona` |
| [`02-offering-normalization.md`](02-offering-normalization.md) | Many-to-one consolidation with a controlled vocabulary | `offerings[]` |
| [`03-writing-style.md`](03-writing-style.md) | Grounding a subjective judgment in computed metrics | `branding.writingStyle` |
| [`04-proof-extraction.md`](04-proof-extraction.md) | Extraction with a machine-verifiable output constraint | `proof.testimonials`, `proof.credentials`, `proof.trustStats` |

---

## Shared conventions

### Model and parameters

```ts
{
  model: "claude-opus-5",
  max_tokens: 16000,
  thinking: { type: "adaptive" },
  output_config: {
    effort: "medium",                                  // per-prompt; see each file
    format: { type: "json_schema", schema: { /* … */ } },
  },
  system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
  messages: [{ role: "user", content: renderTemplate(evidence) }],
}
```

Three deliberate choices:

- **Structured outputs, not prefill.** The older way to force JSON was to prefill the
  assistant turn with `{` and add stop sequences plus a parse-retry loop. That pattern
  now returns a 400 on current models, and `output_config.format` replaces the whole
  stack — schema, stop sequences, retry loop, and all. None of these prompts contain
  "respond only with valid JSON"; the schema enforces it.
- **No `temperature` / `top_p`.** Rejected outright on this model. Where we want
  variance or restraint, it's stated in the prompt instead of dialled in a sampler.
- **No "think step by step".** Adaptive thinking is on by default; the incantation is
  redundant, and depth is controlled by `effort` rather than prose.

### Schema constraints that shaped these files

Structured outputs support a subset of JSON Schema. Every object needs
`additionalProperties: false` and an explicit `required` list, and the following are
**not** supported: `minLength`, `maxLength`, `minimum`, `maximum`, `multipleOf`, and
recursive schemas. Length limits therefore live in the prompt text as instructions, not
in the schema — which is why each prompt states its own word budgets.

### Prompt caching layout

Caching is a prefix match, and render order is `tools` → `system` → `messages`. Each
prompt is built so the stable half comes first:

- **System block (cached)** — role, rules, output contract. Identical across every
  company we ever scrape.
- **User message (not cached)** — the scraped evidence, which differs every time.

That ordering means the system prefix is written once and read on every subsequent
scrape. Interpolating the company name or a timestamp into the system block would
invalidate it on every request, so we don't.

### Grounding rules (shared by all four)

Every prompt enforces the same three rules, because fabrication is the failure mode that
matters most for a knowledge base an SMB will publish from:

1. **Evidence only.** Use the supplied excerpts. Do not use anything you may know about
   this company from elsewhere.
2. **`null` beats a guess.** Every generated field is nullable, and returning `null` is
   always an acceptable answer.
3. **Per-field confidence.** Each field reports `confidence` (0–1), which maps to
   `Sourced<T>.confidence` and drives whether the field lands in the review UI's
   attention tier.

### Degradation and validation

- No `ANTHROPIC_API_KEY` → `lib/ai/client.ts` returns `null`, `mock-enrich.ts` fills the
  same fields from the same templates, and the UI badges them `AI sample`.
- Live output is parsed through the same zod schema as everything else. A validation
  failure falls back to mock rather than surfacing an error — a knowledge base with a
  placeholder pitch beats a broken scrape.
- One batched call per scrape, not one per field. Prompt 01 fills six fields in a single
  request precisely so enrichment costs one round trip.
