# Prompt 04 — Proof Extraction

**Fills:** `proof.testimonials`, `proof.credentials`, `proof.trustStats`
**Technique:** extraction with a machine-verifiable output constraint
**Effort:** `medium`

The only prompt whose output we can **automatically prove correct**. Every quote it
returns must appear verbatim in the supplied text, so `lib/ai/verify.ts` checks each one
with a substring match and drops any that fails. Fabrication doesn't need to be detected
by a human — it can't survive the pipeline.

That guarantee is why this prompt matters beyond its own fields: a testimonial is a real
person's words attributed to them by name. Getting it wrong isn't a quality problem.

---

## System prompt

> You extract trust signals from a company's website: customer testimonials, professional
> credentials, and quantified claims about the business.
>
> Every quote you return must appear **character-for-character** in the supplied text.
> Copy, never paraphrase, never clean up grammar, never merge two sentences from different
> places. Quotes are checked against the source automatically and any that does not match
> exactly is discarded, so a lightly-edited quote is a lost quote.
>
> Attribution: return the attributed name only when the text attributes it. A quote in a
> testimonial slider with no name gets `authorName: null`, not "A satisfied customer".
> Never assign a name from elsewhere on the page.
>
> Extract three kinds of signal:
>
> **Testimonials** — customer statements about their experience. Not the company
> describing itself, not staff bios, not marketing copy in quotation marks. If you cannot
> tell whether a quote is from a customer or from the company's own copy, omit it.
>
> **Credentials** — licenses, certifications, professional memberships, accreditations,
> awards. Include the issuing body when stated. Do not expand abbreviations you are not
> certain of.
>
> **Trust stats** — quantified claims about the business: years in operation, customers
> served, projects completed, volume transacted, team size. Copy the claim verbatim into
> `claim` and put the parsed figure in `value` and `unit`. "Over 40 years of experience"
> gives `value: 40`, `unit: "years"`, and a `category` of `years-in-business`.
>
> When a testimonial names a member of staff, record the name in `mentionsPeople`.
>
> Return empty arrays where there is nothing to extract. Most SMB sites have few or no
> credentials, and that is a normal result.

## User message template

```
Company: {{companyName}}
Industry: {{industry}}

Page excerpts:
{{#each pages}}
--- {{url}} (role: {{role}}) ---
{{text}}
{{/each}}

Known staff names (for testimonial linking):
{{#each knownPeople}}
- {{name}} (id: {{id}})
{{/each}}
```

## Output schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["testimonials", "credentials", "trustStats"],
  "properties": {
    "testimonials": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["quote", "authorName", "authorRole", "rating",
                     "sourceUrl", "topics", "mentionsPeople", "confidence"],
        "properties": {
          "quote":          { "type": "string" },
          "authorName":     { "type": ["string", "null"] },
          "authorRole":     { "type": ["string", "null"] },
          "rating":         { "type": ["number", "null"] },
          "sourceUrl":      { "type": "string" },
          "topics":         { "type": "array", "items": { "type": "string" } },
          "mentionsPeople": { "type": "array", "items": { "type": "string" } },
          "confidence":     { "type": "number" }
        }
      }
    },
    "credentials": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "issuer", "kind", "sourceUrl", "confidence"],
        "properties": {
          "name":       { "type": "string" },
          "issuer":     { "type": ["string", "null"] },
          "kind":       { "type": "string",
                          "enum": ["license", "certification", "membership",
                                   "accreditation", "award"] },
          "sourceUrl":  { "type": "string" },
          "confidence": { "type": "number" }
        }
      }
    },
    "trustStats": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["claim", "value", "unit", "category", "sourceUrl", "confidence"],
        "properties": {
          "claim":      { "type": "string" },
          "value":      { "type": ["number", "null"] },
          "unit":       { "type": ["string", "null"] },
          "category":   { "type": "string",
                          "enum": ["years-in-business", "customers-served",
                                   "projects-completed", "volume-transacted",
                                   "team-size", "response-time", "other"] },
          "sourceUrl":  { "type": "string" },
          "confidence": { "type": "number" }
        }
      }
    }
  }
}
```

## Post-processing (not the model's job)

Three checks run on the response before it reaches the knowledge base:

1. **Verbatim check** — normalize whitespace, then assert `quote` is a substring of the
   source page text. Failures are dropped and counted.
2. **Person linking** — resolve `mentionsPeople` names against `people[].id`; unmatched
   names are discarded rather than creating phantom people.
3. **Dedup** — hash normalized quotes to collapse testimonials repeated across pages.

The verbatim check is stated in the prompt *and* enforced in code. Telling the model its
output is verified measurably improves compliance; verifying it anyway is what makes the
guarantee real.

## Edge cases

| Input | Expected behaviour |
|---|---|
| Testimonial slider rendered by JavaScript | Nothing in the text to extract → empty array. The scraper separately flags the widget |
| Company's own marketing copy in quotation marks | Omitted — not a customer statement |
| Quote with a typo or grammatical error | Copied exactly, typo included |
| "Licensed, bonded, and insured" | Not a credential — it goes to `guarantees`, handled elsewhere |
| Star rating as an image with `aria-label="5 out of 5"` | `rating: 5` if the label is in the text passed in |
| "Serving Texas since 1980" | Trust stat, `category: years-in-business`, `value: 1980`, `unit: "since-year"` |
| Staff bio containing praise | Not a testimonial |

## Design notes

**Why the verbatim constraint is the whole design.** Prompts 01–03 produce prose that a
human has to judge. This one produces claims attributed to named third parties, where the
cost of a fabrication is categorically higher — so the output is constrained to something
a computer can check. Where you can make a generation task verifiable, do.

**Why "a lightly-edited quote is a lost quote."** Models tidy grammar by default; it reads
as helpful. Stating the consequence of the edit is more effective than prohibiting it,
because it explains why the tidying is counterproductive rather than just forbidden.

**Why anonymous stays anonymous.** "A satisfied customer" is a small, natural-seeming
invention, and it's exactly the kind of filler that makes a knowledge base untrustworthy.
Naming the failure mode in the prompt is more reliable than a general accuracy rule.

**Why empty is normalized as a good answer.** Testimonials are the most commonly
JavaScript-injected content on SMB sites, so empty results are frequent and correct. Left
unstated, a model given a page with no testimonials will find some.

**Why `mentionsPeople` exists at all.** Bee Cave Drilling's reference profile lists seven
staff members whose entire biographies were derived from customer testimonials — while the
testimonials themselves were discarded. This field keeps both halves and the link between
them.
