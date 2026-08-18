# Knowledge enrichment (R23)

What we do beyond copying text off the page, and what we would do next.

The governing rule, from [`DATA-QUALITY.md`](DATA-QUALITY.md) §8: **anything not from the
customer's own site is labelled with its origin.** A knowledge base is used to generate
marketing copy in the company's voice. A confidently wrong employee count from a data
broker is worse than an empty field, because the empty field gets asked about and the
wrong one gets published.

---

## 1. Where the gaps actually are

Measured, not guessed — this is every field empty across all three
[`examples/`](../examples/). They are empty for three different reasons, and conflating
them would point enrichment effort at the wrong tier.

**(a) Empty only because the examples run in mock mode.** Prompt 01 already targets these
(`profileFields` in [`lib/ai/enrich.ts`](../lib/ai/enrich.ts):282). The committed examples
force the mock branch for reproducibility, and the mock generator produces only `pitch`,
`customerNeeds`, and `writingStyle` — so these read `not-found` in the files but are filled
by a live call. **These are not enrichment gaps.**

*Confirmed 2026-08-18:* a live run over the Bee Cave fixture fills all five and takes that
knowledge base from 0.55 to **0.74** completeness. The table below is what mock mode hides,
not what the pipeline cannot do.

| Field | Impact |
|---|---|
| `market.buyers` | 5 |
| `foundation.businessModel` | 4 |
| `positioning.foundingStory` | 4 |
| `market.idealPersona` | 4 |
| `foundation.companyRole` | 3 |

**(b) Genuinely missing, and the owner knows the answer.** No amount of reading the site
produces these; the customer produces them in seconds. This is Tier 2 territory.

| Field | Impact | Empty in |
|---|---|---|
| `proof.guarantees` | 4 | 3/3 |
| `contentIntelligence.faqs` | 4 | 3/3 |
| `foundation.employeeCount` | 3 | 3/3 |
| `proof.caseStudies` | 3 | 3/3 |
| `proof.testimonials` | 5 | 2/3 |

**(c) Marked `askable: false` — not the customer's to know.** These are excluded from the
completeness denominator entirely ([`field-meta.ts`](../lib/schema/field-meta.ts)), because
a business owner is not failing to report their own Google rating or their industry's
outlook. **They are empty, and they stay empty until enrichment fetches them.** That is the
argument for Tier 4.

| Field | Impact | Empty in |
|---|---|---|
| `proof.aggregateRatings` | 3 | 3/3 |
| `branding.artStyle` | 3 | 3/3 |
| `market.industryGroupings` | 2 | 3/3 |
| `market.industryOutlook` | 2 | 3/3 |

## 2. Tier 1 — shipped: generation from what we already have

Four prompts, in [`prompts/`](../prompts/), run by `lib/ai/enrich.ts` after extraction.
They add nothing external; they turn scraped evidence into fields extraction cannot
produce.

| Prompt | Fills | Technique |
|---|---|---|
| `01-company-profile` | Ten fields in one call: `overview`, `industry`, `businessModel`, `companyRole`, `pitch`, `foundingStory`, `customerNeeds`, `idealPersona`, `serviceLocations`, `buyers` | Batched generation under hard grounding constraints; `null` framed as preferable to a guess |
| `02-offering-normalization` | `offerings` | Many-to-one consolidation into a controlled vocabulary, with auditable merge provenance |
| `03-writing-style` | `branding.writingStyle` | Subjective judgment anchored to metrics computed deterministically in TypeScript |
| `04-proof-extraction` | `proof.testimonials` | Extraction under a machine-verifiable constraint — every quote must be a verbatim substring, checked in code |

Every field they write carries `method: "ai-live"` or `"ai-mock"` and lands in the review
tier by default (`needsReview` in [`lib/schema/sourced.ts`](../lib/schema/sourced.ts)).
Generated content is never silently trusted.

## 3. Tier 2 — the customer, asked well

Shipped, and the cheapest enrichment there is: the group (b) fields above are all things
the owner can answer in seconds, and `proof.testimonials` at impact 5 is among them.

The app computes up to six follow-up questions, ranked by
`(impact × substitutabilityPenalty) / answerCost`, capped at six because a longer list is
a form and forms do not get filled in. An answer is written back as
`method: "user-edited"` at confidence 1.

What would extend this without turning it into a form:

- **Ask in the customer's words, then normalize.** "Who buys from you?" answered as
  "mostly builders and a few homeowners" is a better source for `buyers` and
  `businessModel` than two dropdowns — one free-text answer, one prompt, two fields.
- **Confirmation instead of entry.** For a field where extraction produced a low-confidence
  candidate, "Founded in 1980?" (yes/no) costs less than "What year were you founded?"
  and resolves the four-candidate `yearFounded` conflict visible in the Bee Cave example.
- **Ask at the moment of use.** A gap that blocks the copy someone is generating right now
  has a far better answer rate than the same gap in a review queue.

## 4. Tier 3 — second-party: what we fetch but do not mine

Cheap, no new vendor, no labelling problem — this is still the customer's own material.

- **PDFs.** Line cards, spec sheets, and capability statements are linked from the sites we
  already crawl and are frequently the only place pricing, certifications, and guarantees
  are written down. We currently record them as `warnings: non-html` and move on.
- **Images with text.** Awards, certification badges, and trust stats are overwhelmingly
  images. OCR over the small set of images we already download for `logos` and
  `clientLogos` would populate `proof.certifications` and `proof.awards` — empty in all
  three examples.
- **`sitemap.xml`.** The crawler is budget-limited and role-driven. A sitemap gives the
  full page inventory, which both improves `contentIntelligence.cadence` and tells us what
  we chose not to read — an honest input to `contentGaps`.
- **Archived copies.** A founding year is more often in a 2009 footer than a 2026 one.
  This is the one second-party source that needs a label: it is the customer's own site,
  but not as it stands today.

## 5. Tier 4 — third-party: the `askable: false` fields

These fill the gaps nothing else can. Each needs explicit origin labelling, and each is
listed with what it actually costs.

| Source | Fills | Cost / risk |
|---|---|---|
| **Google Places / Business Profile** | `aggregateRatings`, `testimonials`, `mainAddress`, `phone`, opening hours | Paid per lookup; needs place-id matching, which is the failure mode — matching the wrong branch of a franchise |
| **State business registries** | `yearFounded`, `legalEntityType`, registered name | Free, authoritative, per-state formats; the highest-quality answer for the field our own extractor is least sure about |
| **LinkedIn company pages** | `employeeCount`, `industry`, `altNames` | ToS-constrained; employee count is self-reported and stale. Label as an estimate or not at all |
| **Review platforms** (Yelp, Birdeye, Trustpilot) | `testimonials`, `aggregateRatings` | We already detect these widgets and record `widget-detected` when their content is JS-rendered — we know exactly which sites would benefit |
| **Industry classification** (NAICS/SIC) | `industryGroupings`, `industryOutlook` | Static reference data, one-time cost. `industryOutlook` is genuinely not the customer's to know |
| **Search Console / analytics**, if the customer connects it | `market.channels`, `funnels`, real query data | Requires OAuth and a customer decision, but it replaces inference with measurement |

## 6. What the schema would need

Less than it looks. `Sourced<T>` already carries `sourceUrls` and a `note`, and the
review tier already exists. Two changes:

1. **An `external` value in `ExtractionMethod`** ([`sourced.ts`](../lib/schema/sourced.ts)),
   alongside `scraped` / `derived` / `ai-live` / `ai-mock` / `user-edited` / `not-found`,
   plus a `sourceName` (`"Google Places"`, `"Texas SOS"`) so the badge can say where a
   value came from rather than just that it was not on the site. `needsReview` returns
   true for it, so external data is confirmed before it is used, exactly like AI output.
2. **A per-organization enrichment toggle**, because "do not send my client list to a data
   broker" is a legitimate position and an agency has to be able to hold it.

Nothing else moves. Extractors already return `Evidence[]` and the reconciler already
settles disagreements by confidence, so a third-party source is one more evidence
producer — it competes with the page rather than overwriting it, and a conflict between
the site and Google surfaces as a conflict rather than a silent replacement.

## 7. Ordering

0. ~~**Get a live key working.**~~ Done — group (a) closes on its own once enrichment runs
   live (ROADMAP §10.2). It was the cheapest item here and it needed no new design, only a
   working provider.
1. **Confirmation-style questions** — no new dependency, targets group (b), and improves
   the thing every other tier depends on: a human having looked.
2. **PDFs and OCR** — the largest gain per unit of new risk. Still the customer's own
   material, so no labelling or consent question.
3. **Google Places** — the only realistic filler for `aggregateRatings` and, on 2 of 3
   examples, `testimonials`. Needs the `external` method first.
4. **Business registries** — cheap and authoritative, but narrow.
5. **Everything else** — after there is evidence anyone wants it.

## 8. What we would not do

- **Infer demographics.** `person.gender` is already the schema's most uncomfortable
  field; it ships at low confidence in the review tier because the reference outputs
  carry it. Nothing further down that road.
- **Buy contact data.** Personal emails and direct dials for people found on a team page
  is a different product with a different consent story.
- **Fill silently.** No enrichment writes a field without a badge saying where it came
  from. A field the customer cannot trace is a field they cannot correct.
- **Guess to raise the score.** Completeness measures how much we know, and an enrichment
  that improves the number without improving the knowledge has broken the instrument.
