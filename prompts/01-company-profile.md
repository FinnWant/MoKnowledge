# Prompt 01 — Company Profile

**Fills:** `foundation.overview`, `foundation.businessModel`, `positioning.pitch`,
`positioning.foundingStory`, `market.customerNeeds`, `market.idealPersona`
**Technique:** batched generation under hard grounding constraints
**Effort:** `medium` — prose synthesis from supplied evidence, not deep reasoning

Six fields in one call. Batching is the point: these fields draw on the same evidence and
would otherwise re-send the whole scraped corpus six times. It also keeps them mutually
consistent — a pitch that contradicts the overview is a real failure mode when each field
is generated in isolation.

---

## System prompt

> You write company profiles for MoFlo, a platform that generates marketing content for
> small businesses. Everything downstream — social posts, emails, blog articles — is
> written from the profile you produce, so a fabricated detail here becomes a false claim
> published under the business's own name.
>
> You will receive evidence scraped from a single company's website: page excerpts, each
> labelled with the URL and page role it came from. Write the requested fields using only
> that evidence.
>
> Rules:
>
> - Use only the supplied evidence. Do not use anything you may already know about this
>   company, and do not infer facts from the industry in general.
> - Return `null` for any field the evidence does not support. `null` is always an
>   acceptable answer and is strongly preferred over a plausible guess. A profile with
>   three good fields and three nulls is more useful than six fields where two are wrong.
> - Do not invent numbers, dates, founder names, locations, or credentials. If the
>   evidence says "decades of experience", write that — do not convert it to a year.
> - Write in third person for `overview`, `businessModel`, `customerNeeds`, and
>   `idealPersona`. Write `pitch` in the company's own first-person voice ("we", "our").
> - Match the company's register. A drilling contractor and a SaaS vendor should not
>   sound alike.
> - Set `confidence` per field: how well the evidence supports what you wrote. Below 0.5
>   means a human should check it before use.
>
> Length: `overview` 60–120 words. `pitch` 60–110 words. `businessModel` one to three
> sentences. `customerNeeds` and `idealPersona` 50–100 words each. `foundingStory` 40–90
> words, and `null` unless the evidence actually describes a founding.

## User message template

```
Company: {{companyName}}
Website: {{websiteUrl}}
Industry (extracted): {{industry}}

Structured facts already extracted (treat as reliable):
{{#each extractedFacts}}
- {{label}}: {{value}}   [from {{sourceUrl}}]
{{/each}}

Page excerpts:
{{#each pages}}
--- {{url}} (role: {{role}}) ---
{{text}}
{{/each}}
```

## Output schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["overview", "businessModel", "pitch", "foundingStory",
               "customerNeeds", "idealPersona"],
  "properties": {
    "overview":      { "$ref": "#/$defs/field" },
    "businessModel": { "$ref": "#/$defs/field" },
    "pitch":         { "$ref": "#/$defs/field" },
    "foundingStory": { "$ref": "#/$defs/field" },
    "customerNeeds": { "$ref": "#/$defs/field" },
    "idealPersona":  { "$ref": "#/$defs/field" }
  },
  "$defs": {
    "field": {
      "type": "object",
      "additionalProperties": false,
      "required": ["value", "confidence", "sourceUrls"],
      "properties": {
        "value":      { "type": ["string", "null"] },
        "confidence": { "type": "number" },
        "sourceUrls": { "type": "array", "items": { "type": "string" } }
      }
    }
  }
}
```

The wrapper mirrors `Sourced<T>` exactly, so the response drops into the knowledge base
without a translation layer, and `sourceUrls` gives the review UI a "where did this come
from" link for a field the model wrote rather than scraped.

Word budgets live in the prompt rather than the schema because structured outputs don't
support `minLength` / `maxLength`.

## Edge cases

| Input | Expected behaviour |
|---|---|
| Thin site (one page, under ~200 words) | `overview` and `pitch` at low confidence; everything else `null` |
| No founding information anywhere | `foundingStory: null`, confidence 0 — not a paraphrase of the About page |
| Two conflicting descriptions of the business | Write the one from the higher-priority page role, note the conflict is unresolved by lowering confidence |
| Evidence is a parked domain or holding page | All six `null` |
| Site is in a language other than English | Write in the site's language; do not translate the brand voice away |

## Design notes

**Why the harm is stated in the system prompt.** "Fabricated detail becomes a false claim
published under the business's own name" does more work than an instruction not to
hallucinate, because it tells the model *why* the constraint exists and lets it apply the
principle to cases the rules don't enumerate.

**Why `null` is framed as a good outcome.** A model asked to fill six fields will fill six
fields. Saying "a profile with three good fields and three nulls is more useful" changes
the objective from completeness to accuracy — which matches the reality that roughly 40%
of the reference profiles' fields are empty.

**Why `pitch` is first person and the rest are third.** It's the only field written as the
company rather than about it, and mixing the two is the most common defect in the
reference examples.

**What is deliberately absent.** No `CRITICAL:` / `YOU MUST` emphasis — current models
follow the system prompt closely, and stacked emphasis causes over-application. No
"think step by step" — adaptive thinking covers it. No JSON formatting instructions — the
schema does that.
