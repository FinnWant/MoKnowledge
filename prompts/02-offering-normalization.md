# Prompt 02 — Offering Normalization

**Fills:** `offerings[]`
**Technique:** many-to-one consolidation with a controlled vocabulary
**Effort:** `medium` — mostly matching and merging; raise to `high` above ~40 candidates

Different from prompt 01: nothing here is *written*, it's *reconciled*. A services page,
a pricing table, a nav menu, and three landing pages describe the same eight services in
different words. The scraper emits every mention; this prompt turns them into one deduped
list.

Bee Cave Drilling is the worst case in the reference set — 14 offerings, several appearing
on four pages each under slightly different names ("Water Well Drilling" / "Well Drilling"
/ "New Well Installation").

---

## System prompt

> You consolidate a company's product and service listings into one clean catalog.
>
> You will receive candidate offerings extracted from multiple pages of a single company's
> website. The same offering usually appears several times with different wording. Merge
> them.
>
> Merge rules:
>
> - Two candidates are the same offering when they describe the same work for the same
>   buyer, even if the names differ. "Well Drilling" and "New Water Well Installation" are
>   one offering. "Well Drilling" and "Well Inspection" are two.
> - Prefer the name the company uses in its own navigation or page headings over one
>   inferred from body text.
> - Union the features across merged candidates, then drop duplicates that differ only in
>   phrasing.
> - Keep offerings distinct when a real buyer would purchase them separately, even if
>   they're related.
>
> Constraints:
>
> - Every offering you return must trace to at least one candidate. Do not add offerings
>   the company plausibly provides but did not list.
> - Copy pricing only when a candidate states it. Never estimate, never convert a range to
>   a point, never infer "free consultation" from a contact form. `null` when unstated.
> - Descriptions must come from the candidates' own content. Rewrite for concision, not
>   for marketing polish.
> - `category` must be one of the enumerated values. Use `other` rather than forcing a
>   poor fit.
>
> Order the result by prominence: offerings from the main services page and top-level
> navigation first, incidental mentions last. Keep each description under 40 words and
> each feature under 20.

## User message template

```
Company: {{companyName}}
Industry: {{industry}}

Candidate offerings ({{candidates.length}} extracted across {{pageCount}} pages):
{{#each candidates}}
[{{@index}}] name: {{name}}
    source: {{sourceUrl}} ({{sourceRole}}, {{extractionMethod}})
    description: {{description}}
    features: {{#each features}}{{this}}; {{/each}}
    pricing: {{pricing}}
{{/each}}
```

Each candidate carries `extractionMethod` — `json-ld` candidates come from schema.org
`Product`/`Offer` markup and are more trustworthy than `dom-heuristic` ones scraped from a
card grid. The model is told the field exists via the schema's source tracking; prominence
ordering follows from `sourceRole`.

## Output schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["offerings"],
  "properties": {
    "offerings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "category", "description", "features",
                     "pricing", "sourceCandidateIndexes", "confidence"],
        "properties": {
          "name":        { "type": "string" },
          "category":    { "type": "string",
                           "enum": ["product", "service", "package", "subscription",
                                    "consultation", "financing", "industry-solution",
                                    "other"] },
          "description": { "type": "string" },
          "features":    { "type": "array", "items": { "type": "string" } },
          "pricing":     { "type": ["string", "null"] },
          "sourceCandidateIndexes": { "type": "array", "items": { "type": "integer" } },
          "confidence":  { "type": "number" }
        }
      }
    }
  }
}
```

**`sourceCandidateIndexes` is the load-bearing field.** It makes every merge auditable:
we can assert in tests that the indexes are valid, that each one is used at most once, and
that every input candidate is accounted for. It also lets the edit UI show "merged from 4
mentions" and expand to the originals — a reviewer can undo a bad merge without
re-scraping.

## Edge cases

| Input | Expected behaviour |
|---|---|
| One offering listed on 6 pages | One entry, six `sourceCandidateIndexes`, high confidence |
| Two genuinely similar services ("Well Maintenance" / "Well Inspection") | Two entries — different purchases |
| Pricing stated as "starting at $X" | Copy verbatim, including the qualifier |
| Pricing only on a gated quote form | `null` |
| A candidate that's actually a blog post title | Omit it; not every candidate survives |
| Zero candidates | `offerings: []` — not an invented catalog |

## Design notes

**Why the enum instead of free-text categories.** The reference profiles use inconsistent
categorization (`Service`, `Business Services`, `System Installation`, `Financial Service`
in one document), which makes the field unusable for filtering. A fixed vocabulary with an
`other` escape hatch is the fix, and it lets `/knowledge/view` offer a real category filter.

**Why the pricing rule is stated three ways.** "Never estimate, never convert a range to a
point, never infer from a contact form" enumerates the three failure modes we actually saw
rather than relying on a general instruction. Wrong pricing is the single most damaging
error this prompt could make — an SMB whose generated content advertises a price they
don't offer has a real problem.

**Why merges are auditable rather than trusted.** Consolidation is lossy and the model
will occasionally over-merge. Returning provenance indexes makes that recoverable in the
UI instead of silently destroying data.
