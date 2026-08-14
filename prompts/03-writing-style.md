# Prompt 03 — Writing Style

**Fills:** `branding.writingStyle`
**Technique:** grounding a subjective judgment in pre-computed metrics
**Effort:** `low` — the analysis is already done; the model is describing it

The other prompts feed the model text. This one feeds it **numbers we computed ourselves**
and asks it to explain them, which is the difference between "the tone feels professional"
and a description a content generator can act on.

`lib/scraper/analyzers/text-metrics.ts` computes the measurements deterministically over
the scraped corpus — no LLM involved. The model's job is turning them into prose plus a
small set of structured parameters, with the numbers constraining what it can claim.

---

## System prompt

> You describe a company's writing style so that AI-generated marketing content can match
> it.
>
> You will receive two things: measurements computed from the company's website text, and
> a set of representative sentences drawn from it. Your description must be consistent
> with the measurements — do not call writing "punchy and concise" when the mean sentence
> length is 28 words, or "highly technical" when the reading grade is 7.
>
> Cover, in prose: overall tone, sentence rhythm, how technical the vocabulary is and
> whether jargon is explained, whether it addresses the reader directly, and how it makes
> its case (proof points, credentials, emotional appeal, plain description).
>
> Then extract the structured parameters. For `preferredTerms`, list words and phrases
> this company uses repeatedly that a generic writer would not — real vocabulary from the
> supplied sentences, not synonyms you would choose. For `avoidTerms`, list only terms the
> evidence shows the company deliberately avoids or replaces; return an empty array rather
> than guessing.
>
> Describe what the writing does, not what it should do. This is not an assessment of
> quality, and you should not suggest improvements.
>
> Keep `description` between 70 and 130 words.

## User message template

```
Company: {{companyName}} — {{industry}}

Computed metrics (from {{wordCount}} words across {{pageCount}} pages):
- Mean sentence length: {{meanSentenceLength}} words (σ {{sentenceLengthStdDev}})
- Flesch-Kincaid grade level: {{fleschKincaidGrade}}
- First-person plural ("we", "our"): {{firstPersonPluralRatio}} per 1000 words
- Second person ("you", "your"): {{secondPersonRatio}} per 1000 words
- Questions: {{questionRatio}} per 1000 sentences
- Exclamations: {{exclamationRatio}} per 1000 sentences
- Imperative openers: {{imperativeRatio}} per 1000 sentences
- Mean paragraph length: {{meanParagraphSentences}} sentences
- Distinctive terms (high relative frequency): {{#each distinctiveTerms}}{{term}} ({{count}}), {{/each}}

Representative sentences:
{{#each exemplarSentences}}
- "{{this}}"
{{/each}}

Calls to action found verbatim:
{{#each ctas}}
- "{{this}}"
{{/each}}
```

## Output schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["description", "tone", "formality", "readerAddress",
               "preferredTerms", "avoidTerms", "ctaStyle", "confidence"],
  "properties": {
    "description": { "type": "string" },
    "tone": {
      "type": "array",
      "items": { "type": "string",
                 "enum": ["authoritative", "warm", "professional", "conversational",
                          "technical", "reassuring", "urgent", "aspirational",
                          "educational", "direct", "playful", "formal"] }
    },
    "formality":      { "type": "string", "enum": ["casual", "neutral", "formal"] },
    "readerAddress":  { "type": "string", "enum": ["second-person", "third-person", "mixed"] },
    "preferredTerms": { "type": "array", "items": { "type": "string" } },
    "avoidTerms":     { "type": "array", "items": { "type": "string" } },
    "ctaStyle":       { "type": "string" },
    "confidence":     { "type": "number" }
  }
}
```

`tone` is an enumerated multi-select rather than free text so the three MoFlo apps can
condition on it programmatically. Free-text tone labels are the reason the reference
profiles' `Writing Style` field can be read but not used.

## Edge cases

| Input | Expected behaviour |
|---|---|
| Under ~300 words of body copy | Low confidence, short description, empty term lists |
| Site is mostly a photo gallery | `confidence` near 0 — say the sample is too small |
| Metrics conflict with the sentences (a few long quotes skewing the mean) | Trust the metrics for rhythm claims; use sentences for vocabulary |
| Bilingual site (e.g. J&D Insurance, EN/ES) | Describe the dominant language's style, note the bilingual presence |
| Boilerplate-heavy site (cookie banners, legal footers) | Boilerplate is stripped before metrics; ignore any that survives |

## Design notes

**Why compute the metrics instead of asking the model to.** Two reasons. It is more
accurate — Flesch-Kincaid over 4,000 words is arithmetic, and a model estimating it from a
sample will be roughly right at best. And it is cheaper: the metrics summarize a corpus
too large to fit comfortably in one request, so we send ~40 lines of numbers plus a dozen
exemplar sentences instead of the whole site.

**Why the consistency constraint is stated with examples.** "Do not call writing punchy
when the mean sentence length is 28 words" is checkable; "be accurate" is not. It also
makes the failure mode testable — we can assert that a high-grade-level input never
produces a `casual` formality.

**Why quality assessment is explicitly ruled out.** Asked to describe writing style,
models drift toward critique ("the copy would benefit from shorter paragraphs"). That's
useless here — the field exists so a generator can *imitate* the voice, including its
flaws.

**Why `avoidTerms` defaults to empty.** It's the field most likely to be confabulated,
since there's rarely direct evidence that a company avoids a word. Explicitly permitting
an empty array removes the pressure to produce one.

**On `effort: "low"`.** The hard analysis already happened in TypeScript. This is a
description task with the reasoning pre-supplied, and low effort measurably reduces cost
without hurting output quality on tasks shaped like this one.
