# Data Quality Strategy

How MoKnowledge handles incomplete, conflicting, and unverifiable data — and how it turns
gaps into something the customer can act on. Satisfies R22.

---

## 1. The premise: sparsity is normal

Across the 8 reference profiles, `Year Founded` appears 3 times, `Employee Count` once,
`Revenue` once. A typical scrape fills roughly 40–60% of the schema. A system that treats
that as failure will either look broken or start inventing values.

So the design target is: **a half-filled knowledge base is a normal, useful output.**

---

## 2. Never fabricate

Every field is `Sourced<T>` with an explicit state. A missing field is
`{ value: null, method: 'not-found', confidence: 0 }` — rendered as a "Not found" chip.
Never an empty string, never a plausible placeholder.

This is enforced in three places, not just intended:

| Layer | Enforcement |
|---|---|
| Extractors | Return `null` rather than a default; no `?? ''` fallbacks |
| AI prompts | `null` is framed as preferred over a guess (see [`prompts/01-company-profile.md`](../prompts/01-company-profile.md)) |
| Post-processing | Prompt 04's quotes are substring-verified against source text and dropped on mismatch |

---

## 3. Tiered fallback per field

Each field declares an ordered source chain. The first tier that produces a value wins,
and the tier determines confidence.

**Worked example — `foundation.yearFounded`:**

| Tier | Source | Confidence |
|---|---|---|
| 1 | JSON-LD `Organization.foundingDate` | 0.95 |
| 2 | Regex `(since\|est\.?\|founded in)\s+(19\|20)\d{2}` on about + footer | 0.75 |
| 3 | "over N years" + scrape date → derived year | 0.45 |
| 4 | Earliest copyright year in footer (weak floor) | 0.25 |
| 5 | Ask the customer | — |

Tiers 3 and 4 are labelled `derived` and land in the review UI's attention tier by
construction, because anything under 0.5 does.

**Same shape, other fields:** `mainAddress` (JSON-LD `PostalAddress` → contact-page
microformat → footer regex → ask); `logos` (JSON-LD `logo` → OpenGraph image → largest
header `<img>` with "logo" in name/alt → ask); `socials` (JSON-LD `sameAs` → footer icon
links → any outbound link to a known social host → ask).

---

## 4. Conflicts are surfaced, not silently resolved

The reconciler resolves by source precedence (JSON-LD > meta > semantic DOM > heuristic).
When two candidates share a tier, it keeps both and flags the field.

The UI then asks — one tap, no typing, highest-precedence candidate pre-selected, and the
rejected values preserved in the field's `note` rather than discarded. Full interaction
design in [`EDIT-UX.md`](EDIT-UX.md) §6.

Silently picking one would throw away information the customer could have confirmed in a
second.

---

## 5. Completeness scoring

Raw fill rate is misleading: "42% complete" reads as bad when the missing 58% is
`revenue`, `employeeCount`, and other rarely-published fields.

So completeness is **impact-weighted**. Each field carries a static `impact` (1–5) scored
by how much its absence degrades generated content:

```
categoryScore = Σ(impact of filled fields) / Σ(impact of all fields in category)
overallScore  = Σ(impact of filled fields) / Σ(impact of askable fields)
```

Fields marked `askable: false` — `writingStyle`, `artStyle`, `industryOutlook`, and the
other derived or external ones — are excluded from the denominator entirely. Penalising a
customer for not knowing their own Flesch-Kincaid grade would be absurd.

Per-category scores drive the left rail's ✓ / ⚠ indicators; the overall score drives the
meter in the footer.

---

## 6. Turning gaps into questions

This is where the brief's "do as much for them as possible" gets concrete. Rather than
showing an empty field labelled `yearFounded`, the app asks a question.

### Which gaps become questions

A gap is askable when all three hold:

1. `askable: true` — the customer plausibly knows the answer.
2. The field is genuinely empty (a low-confidence value is a *conflict* to confirm, not a
   gap to fill — cheaper for the user and handled in the attention tier).
3. No sibling field already covers it (see substitutability below).

### Ranking

```
priority = (impact × substitutabilityPenalty) / answerCost
```

| Term | Range | Meaning |
|---|---|---|
| `impact` | 1–5 | How much content generation degrades without it |
| `substitutabilityPenalty` | 0.3–1.0 | 0.3 when a sibling field mostly covers it (missing `overview` matters less when `pitch` exists) |
| `answerCost` | 1–3 | 1 = a fact the owner knows instantly (founding year); 3 = requires real thought (ideal customer persona) |

Dividing by `answerCost` is the load-bearing choice: it front-loads questions that are
**high value and cheap to answer**, so the first two questions clear the most ground. A
question the customer abandons has zero value regardless of the field's impact.

### Presentation

- **Cap at 6.** More is a form, and a form is what this design exists to avoid.
- **Group related questions** into one prompt: *"Where are you based, and which areas do
  you serve?"* fills `mainAddress` and `serviceLocations` together.
- **Plain language with an example**: *"What year did you start? (e.g. 2003)"* — never the
  field name.
- **Always skippable.** Save is never gated on answering.

### Worked example — Account IT

Its reference profile is missing `employeeCount`, `revenue`, `otherLocations`,
`industryOutlook`, `foundingStory`, and several socials. After filtering and ranking:

| # | Question | Fills | Why it ranks here |
|---|---|---|---|
| 1 | "Roughly how many people work at the business?" | `employeeCount` | impact 3, answerCost 1 |
| 2 | "Which other locations do you serve?" | `otherLocations` | impact 4, answerCost 1 |
| 3 | "Are you on Instagram or LinkedIn?" | `onlinePresence` | impact 4, answerCost 1 |
| 4 | "What made you start the business?" | `foundingStory` | impact 4, answerCost 2 |

`revenue` (impact 1) and `industryOutlook` (`askable: false` — external market data)
never appear. Six slots, four questions — the cap is a ceiling, not a quota.

---

## 7. Honest failure reporting

Some gaps aren't the customer's to fill; they're ours to explain. Each maps to a specific
message rather than a generic error:

| Condition | What the user sees |
|---|---|
| JS-rendered SPA, near-empty DOM | "This site loads its content with JavaScript, which our scraper can't read yet. We got what we could from the page metadata." |
| Review widget detected, no text | "We found a Birdeye review widget on /about but couldn't read the reviews — they load separately." |
| robots.txt disallow | "This site asks automated tools not to read [path]. We skipped it." |
| Crawl budget hit | "We read 20 pages and stopped. [N] more were found." |
| Timeout / 5xx after retry | "[URL] didn't respond. Everything else scraped fine." |

Every one of these still returns a partial knowledge base. A dead end is never the output.

---

## 8. What we deliberately do not do

- **No confidence numbers in the UI.** `0.73` isn't actionable for a non-technical user.
  Confidence determines *placement* (attention tier or not), and nothing more.
- **No blocking on completeness.** Save always works; the button reads `Save anyway` with
  a quiet count when items are unreviewed.
- **No auto-filling from a third party without saying so.** Enrichment sources are a real
  option (see [`ENRICHMENT.md`](ENRICHMENT.md)), but anything not from the customer's own
  site is labelled with its origin.
