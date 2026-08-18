# Schema Extensions: `proof` and `contentIntelligence`

Design detail for the two headline beyond-baseline categories. A third, `quality`
(completeness scoring + generated follow-up questions), is specified in
[`../extra/ROADMAP.md`](../extra/ROADMAP.md) §6 as part of the data-quality strategy.

**Beyond-baseline scope is these three and no more.** `voiceProfile`, `messaging`,
`conversionKit`, `compliance`, `seo`, `competitors`, and `mediaAssets` were designed and
deliberately cut — see ROADMAP §4.2.

---

## Why these two

The strongest justification isn't hypothetical — it's visible in MoFlo's own reference
outputs. Both kinds of signal are already being extracted, then **squeezed into fields that
don't fit them**, losing the useful part:

| Evidence in `Knowledge Outputs 2.13.26.pdf` | Where it landed | What was lost |
|---|---|---|
| "He is a CPA, a member of the AICPA, and a QuickBooks Certified ProAdvisor" | Person bio prose | Credentials aren't queryable or reusable as trust claims |
| "Several client testimonials praise her as an exceptional… agent who fights for the best deal" | Person bio prose | The actual quotes, and who said them |
| "He provided a testimonial praising the NightOwl Monitoring team" | Person bio prose | The testimonial itself — only its existence survives |
| "Press features in publications (e.g., Las Vegas Review Journal, Mansion Global)" | **Funnels** | Press mentions modelled as a marketing funnel |
| "Testimonials and Case Studies" | **Funnels** | Content assets modelled as a funnel |
| "over 14 years", "over forty years", "over 50 years", "over a billion dollars in brokerage sales" | Pitch / Overview prose | Reusable proof metrics, unextractable |
| Bee Cave Drilling: 7 of 8 `Key People` (Ethan, Kevin, Melanie, Barry, Kenneth, Shawn, Alexander) | `Key People` | Every one is testimonial-derived; the source quotes were discarded |
| "The content is well-structured with FAQs, testimonials, and clear service descriptions" | Writing Style prose | The FAQ Q&A pairs themselves |
| "Articles are well-structured with clear headings, bullet points, and FAQ sections" | Writing Style prose | The article topics, headlines, and cadence |

So this isn't inventing new requirements — it's giving already-harvested signal a proper home,
which is the most defensible kind of "beyond baseline."

There's also a hard product argument. A content generator that lacks real proof points will
either omit them (weak copy) or **invent them** — and "licensed and insured since 1985" is a
claim a non-technical SMB can be sued over. Capturing verified claims is a safety feature, not
just a quality one.

---

## Category: `proof`

Trust signals, social proof, and verifiable claims.

### Fields

```ts
proof: {
  testimonials: Sourced<Testimonial[]>;
  aggregateRatings: Sourced<AggregateRating[]>;
  caseStudies: Sourced<CaseStudy[]>;
  certifications: Sourced<Credential[]>;
  memberships: Sourced<Credential[]>;
  awards: Sourced<Award[]>;
  pressMentions: Sourced<PressMention[]>;
  trustStats: Sourced<TrustStat[]>;
  guarantees: Sourced<Guarantee[]>;
  clientLogos: Sourced<MediaRef[]>;
}
```

| Type | Fields | Notes |
|---|---|---|
| `Testimonial` | `quote`, `authorName`, `authorRole`, `authorCompany`, `authorLocation`, `rating`, `date`, `platform`, `sourceUrl`, `mediaUrl`, `topics[]`, `mentionsPeople[]`, `mentionsOfferings[]` | `mentionsPeople` is the link that would have let MoFlo keep Bee Cave's quotes attached to Ethan/Kevin/Melanie instead of paraphrasing them |
| `AggregateRating` | `platform`, `ratingValue`, `bestRating`, `reviewCount`, `sourceUrl` | Straight from JSON-LD `AggregateRating` where present |
| `CaseStudy` | `title`, `client`, `problem`, `solution`, `results[]`, `metrics[]`, `url` | Distinguished from testimonials by length + structure |
| `Credential` | `name`, `issuer`, `identifier`, `validUntil`, `verifyUrl`, `kind` (`license` \| `certification` \| `membership` \| `accreditation`) | CPA, AICPA, QuickBooks ProAdvisor, NGWA, BBB, state contractor/insurance licenses |
| `Award` | `name`, `issuer`, `year`, `sourceUrl` | |
| `PressMention` | `outlet`, `title`, `url`, `date`, `kind` (`feature` \| `quote` \| `listing`) | Las Vegas Review Journal, Mansion Global, LEI Magazine |
| `TrustStat` | `claim`, `value`, `unit`, `category`, `asOfDate`, `sourceUrl` | `category` ∈ years-in-business, customers-served, projects-completed, volume-transacted, team-size, response-time |
| `Guarantee` | `text`, `kind` (`warranty` \| `satisfaction` \| `licensing` \| `insurance` \| `bonding`), `terms` | "licensed, bonded, and insured" is the single most common SMB trust phrase |

### Extraction strategy

| Signal | Method | Confidence |
|---|---|---|
| JSON-LD `Review`, `AggregateRating` | Direct parse | High |
| Review-widget embeds (Google, Birdeye, Trustpilot, Yotpo, Podium, NiceJob) | Host signature match → flag `widget-detected` | Presence high, content often unavailable |
| On-page testimonials | DOM heuristics: `blockquote`, class/id matching `testimonial\|review\|quote\|slider`, quote-delimited runs of 40–500 chars followed by a short attribution line, star glyph runs or `aria-label="5 out of 5"` | Medium |
| Credentials | Dictionary match (CPA, AICPA, NGWA, BBB, LEED, NATE, ASE, EPA, state license patterns like `TX #\d+`) + trust-strip image alt text | Medium–high |
| Trust stats | Regex families: `(over|more than|nearly)?\s*\d[\d,]*\+?\s*(years|customers|clients|projects|homes|wells|policies)` and currency magnitudes (`$8.5B`, `over a billion`) | Medium |
| Press | Anchor text/alt in "as seen in"/"featured in" strips + outbound links to known media domains | Medium |

### Data-quality notes

Testimonials are the **most commonly JavaScript-injected content on SMB sites**, which
collides directly with our no-headless-browser decision. Handling:
- When a review widget is detected but no testimonial text is recoverable, emit
  `{ value: [], method: 'not-found', note: 'Birdeye review widget detected at /about; content is JS-rendered and not accessible to the static scraper' }`.
- That's an honest, actionable message — and it's exactly the kind of gap the completeness
  score should turn into a follow-up question for the customer.

Deduplication across pages by normalized quote hash (lowercased, whitespace- and
punctuation-collapsed, first 120 chars) — testimonial sliders repeat on every page.

### Value per MoFlo app

- **MoSocial** — testimonial quote cards are among the highest-performing SMB post formats; needs short quote + attribution + which service it praises (`topics[]`).
- **MoMail** — credential/guarantee blocks in signatures and footers; review-request campaigns targeted at customers of offerings with thin proof.
- **MoBlogs** — case studies convert directly into article briefs; `trustStats` become citable proof points instead of vague filler.
- **All three** — a bounded set of *verified* claims to draw from, so the model never has to invent a credential.

---

## Category: `contentIntelligence`

What the company talks about, how it packages it, and how often.

### Fields

```ts
contentIntelligence: {
  themes: Sourced<Theme[]>;
  posts: Sourced<ContentItem[]>;
  taxonomy: Sourced<{ categories: string[]; tags: string[] }>;
  cadence: Sourced<Cadence>;
  headlinePatterns: Sourced<HeadlinePattern[]>;
  faqs: Sourced<Faq[]>;
  glossary: Sourced<GlossaryTerm[]>;
  seasonalSignals: Sourced<SeasonalSignal[]>;
  contentGaps: Sourced<ContentGap[]>;
}
```

| Type | Fields | Notes |
|---|---|---|
| `Theme` | `label`, `weight`, `terms[]`, `exampleUrls[]` | Term-frequency over the scraped corpus with boilerplate stripped, scored against a stopword + generic-business-language baseline |
| `ContentItem` | `title`, `url`, `publishedAt`, `author`, `category`, `excerpt`, `wordCount`, `headings[]` | JSON-LD `BlogPosting`/`Article` first, blog-index DOM second |
| `Cadence` | `postsPerMonth`, `firstPublished`, `lastPublished`, `daysSinceLast`, `isStale` | `isStale` (>90 days) is a direct MoBlogs sales trigger |
| `HeadlinePattern` | `pattern`, `count`, `examples[]` | how-to · listicle · question · "X vs Y" · local+service · seasonal |
| `Faq` | `question`, `answer`, `topic`, `sourceUrl` | JSON-LD `FAQPage` + `<details>`/accordion DOM |
| `GlossaryTerm` | `term`, `definition`, `sourceUrl` | Domain vocabulary the company itself defines |
| `SeasonalSignal` | `label`, `period`, `text`, `sourceUrl` | e.g. Bee Cave's "Fall Water Well Savings" |
| `ContentGap` | `topic`, `reason`, `relatedOffering` | v1 heuristic: an offering with no supporting page or post |

### Why `glossary` earns its place

Reference outputs show these companies defining their own terms — "static water level"
(NightOwl), "offer-in-compromise" (Account IT), "cathodic protection" (Bee Cave). Capturing
term + the company's own definition gives all three apps the industry vocabulary **and** the
company's preferred phrasing of it, which is exactly what stops generated content from
reading like it was written by someone outside the trade.

### `contentGaps` — the highest-value derived field

Cross-reference `offerings[]` against `posts[]` + site pages: any offering with no supporting
content is a gap. For Bee Cave, that surfaces concrete briefs like "Cathodic Protection —
14 offerings, no blog coverage." This is the field that most directly fits MoFlo's stated
posture of doing the work *for* the customer rather than making them figure out what to write.

### Value per MoFlo app

- **MoBlogs** — a ready topic pipeline, existing-coverage awareness (no duplicate articles), brand-matched headline formulas, real customer FAQs as SEO-ready briefs, correct terminology.
- **MoSocial** — FAQ pairs become Q&A/carousel posts; `themes` become content pillars; `seasonalSignals` seed the calendar.
- **MoMail** — newsletters need recent posts to link to; `cadence` reveals how much material exists; FAQs become onboarding drip sequences.

---

## Cross-category links

Both categories connect to existing entities rather than duplicating them:
`Testimonial.mentionsPeople[] → people[].id`, `Testimonial.mentionsOfferings[] → offerings[].id`,
`ContentGap.relatedOffering → offerings[].id`. Modelled as ID references in the JSON output,
and as foreign keys in the Supabase design (R27).
