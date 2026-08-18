# Example knowledge bases (R19)

Three complete knowledge bases, exactly as the app produces them.

| File | Company | Completeness | Why this one |
|---|---|---|---|
| [`knowledge-base-bee-cave-drilling.json`](knowledge-base-bee-cave-drilling.json) | Bee Cave Drilling | 55% | Widest entity extraction — a 30-person crew page and 18 offerings, from a site with no blog and no testimonials |
| [`knowledge-base-elevation-group-az.json`](knowledge-base-elevation-group-az.json) | Kelly Jones / Elevation Group AZ | 47% | The proof and content case — 10 testimonials, 39 posts, and 4 conflicts for the reconciler to flag |
| [`knowledge-base-account-it.json`](knowledge-base-account-it.json) | Account-it Consulting Services | 52% | Twenty pages of content and no proof whatsoever — brand scores 0.81 against proof's 0.25 |

They are **build output, not documents**:

```bash
npm run examples           # rebuild all three
npm run examples -- --check   # fail if the committed files are stale
```

`scripts/build-examples.ts` runs the real pipeline — `buildKnowledgeBase` →
`enrichKnowledgeBase` — over the committed HTML fixtures in `tests/fixtures/sites/`,
then validates the result against `knowledgeBaseSchema` before writing. An example that
drifts from the shipped schema is a failing `--check`, not a stale file nobody re-read.

## What to look at

**The envelope.** Every scalar is a `Sourced<T>`: `value`, `method`, `confidence`,
`sourceUrls`, and an optional `note`. Open any field and you can see where it came from.

```jsonc
"yearFounded": {
  "value": 1980,
  "method": "scraped",
  "confidence": 0.45,          // low: the site disagrees with itself
  "sourceUrls": ["https://www.beecavedrilling.com/", /* …13 more */],
  "note": "We found 4 different values: 2011, 2012, 2016"
}
```

That field is the whole strategy in one object. Four "since YYYY" phrases appear across
the site — 1980 on the Contact page, 2011 and 2012 on the team page, 2016 on the reviews
page — and only the first is a founding year. The extractor cannot tell which, so it
emits all four and halves its own confidence for saying so
(`lib/scraper/extractors/identity.ts:58`). The reconciler keeps the best candidate,
leaves the confidence below the 0.5 attention threshold, and writes the disagreement
into `note` rather than silently picking one. `quality.conflicts` carries all four
candidates with the page each came from, so a human can settle it in one click.

**Absence is a value.** Roughly half of every file is `{"value": null, "method":
"not-found", "confidence": 0}`. That is the point — see [`../docs/DATA-QUALITY.md`](../docs/DATA-QUALITY.md).
No example invents a founding year it could not find.

**`quality` is computed about the knowledge base**, not extracted from the site, so it is
the one category with no provenance envelope. It carries the completeness score, the
per-category breakdown, unresolved conflicts, and the six follow-up questions the app
would ask the business owner.

## Two things are pinned for reproducibility

Both are properties of these committed files, not of the running app:

1. **The clock** is fixed at `2026-08-18T12:00:00Z`, so `createdAt` and every `fetchedAt`
   do not churn the diff on each run.
2. **Record ids** are renumbered (`bee-cave-drilling-0001`, …) in traversal order. The app
   mints real UUIDs; a `crypto.randomUUID()` per extracted record means several hundred
   lines of noise per run. References are rewritten alongside declarations, so
   `testimonial.relatedOffering` still resolves to a real offering.

## Why the AI fields say `ai-mock`

Enrichment is forced down the mock branch here even when `ANTHROPIC_API_KEY` is set, because
a live model does not return the same prose twice and these files have to be byte-stable.
So `positioning.pitch` and `branding.writingStyle` carry `method: "ai-mock"` and render
with the `AI sample` badge — placeholder output, clearly labelled as such.

Live generation is demonstrated separately by `npm run ai:check`, which runs prompt 03
against the configured model and prints the real result. The same four prompts are in
[`../prompts/`](../prompts/).
