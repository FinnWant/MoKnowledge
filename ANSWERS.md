# Answers to the required questions

---

## 1. What approach did you take to scraping and structuring the knowledge base data?

**Extractors propose, a reconciler decides.**

The obvious design is a function per field that reads the page and returns a value. It breaks
on the second page, because the home page and the contact page disagree about the phone
number and whichever extractor ran last wins.

So no extractor writes a field. Each of the eleven returns `Evidence[]` — a claim, the path it
belongs to, the method that produced it (`json-ld`, `opengraph`, `meta`, `dom`, `heuristic`,
`computed`), the page it came from and that page's role. Every extractor runs over every page,
and a separate reconciler settles the resulting pile by source precedence, then by page role
(a phone number on the contact page outranks the same number in a blog footer), then by
agreement across pages. Disagreements survive as `quality.conflicts` with every candidate and
its origin, so the UI can ask rather than guess.

**Every value carries where it came from.** Each scalar is a `Sourced<T>`: `value`, `method`,
`confidence`, `sourceUrls`, optional `note`. Collections are `Sourced<T[]>` whose items carry
their own `RecordProvenance`, because a person is accepted or rejected as a whole card, not
field by field. That one envelope pays for four features that would otherwise need separate
machinery: provenance badges, confidence-driven review triage, per-field revert, and honest
labelling of AI-generated text.

**`null` is a first-class answer.** Roughly half of a typical scrape is
`{value: null, method: "not-found", confidence: 0}`. Across the eight reference profiles
`yearFounded` appears three times and `revenue` once — a system that treats sparsity as
failure either looks broken or starts inventing. Extractors return `null` rather than `""`,
and the review UI renders an explicit "Not found".

**Crawling is budgeted and polite.** robots.txt is honoured, sitemap.xml is read first because
it is the site's own opinion of what matters, URLs are classified by role, and the crawl stops
at 20 pages. Normalization matters more than it sounds: without it a 20-page budget is spent
on `/about`, `/about/`, `/About/`, and `/about?utm_source=google`. One real site emitted
`?et_blog=` on every archive link and cost three budget slots before empty-valued query
parameters were stripped.

**The structure is one zod schema.** `lib/schema/knowledge-base.ts` is the single source of
truth; every type is inferred from it, so runtime validation and compile-time types cannot
drift. A parallel registry (`field-meta.ts`) carries what the schema deliberately does not —
each field's `impact` (1–5), whether the customer plausibly knows the answer, and the
plain-language question to ask if not. That registry is what turns a schema into a product:
it drives the impact-weighted completeness score and the ranked follow-up questions.

**It is measured, not asserted.** `npm run validate` scores extraction against the reference
profiles from `Knowledge_Outputs.pdf`, transcribed as golden JSON, running entirely off
committed HTML fixtures. Current per-field recall: `website` 100%, `socials` 86%,
`mainAddress` 80%, `people` 68%, `yearFounded` 67%, `offerings` 24%; 26% overall across seven
sites. That number needs its caveat: it measures *agreement with a peer system*, not truth. In
most fields we extract considerably more than the reference does — 102 offerings against its
84, 58 people against 31, 63 social profiles against 14 — and producing something the
reference lacks cannot raise the score. Several reference values are also defects we
deliberately disagree with. It is a regression detector, not a grade.

---

## 2. What information beyond our current baseline did you choose to include, and why?

Three categories, and the case for them is not hypothetical — it is visible in MoFlo's own
reference outputs, where these signals are **already being extracted and then squeezed into
fields that don't fit**, losing the useful part.

| In the reference output | Where it landed | What was lost |
|---|---|---|
| "He is a CPA, a member of the AICPA, and a QuickBooks Certified ProAdvisor" | a person's bio prose | credentials, unqueryable and unreusable as trust claims |
| "Press features in Las Vegas Review Journal, Mansion Global" | **Funnels** | press coverage modelled as a marketing funnel |
| "over 14 years", "over a billion dollars in brokerage sales" | pitch prose | reusable proof metrics |
| Bee Cave Drilling: 7 of 8 `Key People` | `Key People` | every one is testimonial-derived, and the source quotes were discarded |
| "well-structured with FAQs, testimonials, and clear service descriptions" | writing-style prose | the FAQ pairs themselves |

**`proof`** — testimonials with author, platform and links back to the people and offerings
they mention; aggregate ratings; case studies; certifications; memberships; awards; press
mentions; trust stats; guarantees; client logos. The point is a *bounded set of verified
claims*: content generation can cite "40+ years" because a page said so, and can never invent
a credential. Prompt 04 enforces this in code — every extracted quote must be a verbatim
substring of the source text, and anything that isn't is dropped.

**`contentIntelligence`** — themes, posts, taxonomy, publishing cadence and staleness,
headline patterns, FAQ pairs, a glossary of the company's own domain terms, seasonal signals,
and content gaps. A blog generator that doesn't know what a company has already written will
write it again.

**`quality`** — per-category completeness, the missing-field list, unresolved conflicts, and up
to six ranked follow-up questions. This is the one that best fits MoFlo's stated thesis of
doing as much for the customer as possible: rather than an empty box labelled `yearFounded`,
the app asks "What year did you start?" and ranks it against every other gap by
`(impact × substitutability) / answerCost`. Dividing by answer cost is the load-bearing
choice — a question the customer abandons is worth nothing regardless of the field's impact.

Scope was deliberately capped at three. `voiceProfile`, `messaging`, `conversionKit`,
`compliance`, `seo`, `competitors`, and `mediaAssets` were designed and cut, to buy scraping
depth and UI polish instead. They are the backlog in question 4.

---

## 3. How would your knowledge base design improve the outputs of MoSocial, MoMail, and MoBlogs specifically?

The general answer — "better input, better output" — is true and useless. The specific answer
is that each app fails in a particular way without a particular field.

**MoSocial.** Social copy fails by sounding like nobody. `branding.writingStyle` is grounded in
metrics computed deterministically in TypeScript — sentence length, reading grade, passive
ratio, first-person-plural frequency — before a model is allowed to describe the voice, so a
tone claim cannot contradict the measured text. `proof.testimonials` supplies quotable social
proof with attribution rather than paraphrase. `contentIntelligence.headlinePatterns` and
`ctas` give the company's own hook and conversion language instead of generic marketing voice.
`seasonalSignals` says when to post about what.

**MoMail.** Email fails by addressing the wrong person about the wrong problem.
`market.buyers`, `idealPersona` and `customerNeeds` are exactly the segmentation an outbound
sequence needs. `offerings[].pricing` is stored **verbatim as published** — "starting at
$250", qualifier included — because the qualifier is the part a salesperson needs and a parsed
number would lose it. `proof.guarantees` and `trustStats` are the trust block. `faqs` are
pre-written objection handling, in the company's own words.

**MoBlogs.** Long-form fails by repeating what the site already says and by getting the
vocabulary wrong. `contentIntelligence.themes`, `posts` and `taxonomy` say what has been
covered; `contentGaps` says what hasn't; `cadence` says how often they publish and whether
they've gone quiet. The `glossary` of the company's own domain terms is the difference between
"water well maintenance" and the term this business actually uses. `caseStudies` and
`testimonials` linked to specific `offerings` turn a generic article into one with evidence.

**Across all three**, two structural properties matter more than any single field:

1. **Provenance on every value.** An app can be told to use only `scraped` and `user-edited`
   fields for factual claims, and treat `ai-mock` or low-confidence values as drafting hints.
   The knowledge base makes that policy expressible instead of leaving it to hope.
2. **Controlled vocabularies.** `offering.category` is an enum. The reference outputs use free
   text — `Service`, `Business Services`, `System Installation`, and `Financial Service` all
   appear in one document — which makes the field useless for the filtering and templating
   that content generation depends on.

---

## 4. What would you improve or change about MoKnowledge if you had more time?

**A real browser for JS-rendered sites.** The single biggest extraction gap. The scraper is
`cheerio` over fetched HTML, so a React site that renders client-side yields metadata and
little else. It is detected and reported honestly rather than failing silently, but a headless
browser for the subset of sites that need one would move recall more than any other change.

**The seven cut categories.** `voiceProfile` (the measured metrics as a first-class field
rather than a prompt input), `messaging`, `conversionKit`, `compliance`, `seo`, `competitors`,
`mediaAssets`. `competitors` is the most valuable and the most dangerous — it needs sources
beyond the company's own site, and every one of them carries a labelling obligation.

**Finish the third enhance affordance.** Adding records and answering gap questions both ship;
`Regenerate` on an AI field, with an optional steer ("warmer", "shorter"), does not. It needs a
per-field enrichment endpoint that the phase it belonged to didn't include. Now that live
enrichment works end to end, this is a small piece of work with a good return.

**Enrichment tiers 3 and 4** (`docs/ENRICHMENT.md`). PDFs and images we already download but
don't mine — line cards and spec sheets are frequently the only place pricing and
certifications are written down, and awards are almost always images. Then third-party sources
for the fields marked `askable: false`: Google Places for `aggregateRatings`, state registries
for `yearFounded`. Both need a new `external` provenance method first, because the rule that
anything not from the customer's own site is labelled with its origin is not negotiable.

**Close the SSRF redirect gap.** Every URL is checked before it is fetched, and the final URL
after redirects is checked too, but `redirect: "follow"` hides the intermediate hops. Following
redirects manually and checking each would close it.

**Evaluation rather than recall.** The current score measures agreement with a peer system.
What it should measure is whether a knowledge base actually produces better content — generate
a post from a knowledge base with and without `proof`, and score the output. That is the
metric the product is really optimising.

---

## 5. What was the most challenging part of this assignment?

Not the scraping. **Deciding what to do when the evidence disagrees with itself** — and then
discovering how much of that judgement is invisible until you run the thing.

The reconciler is the piece I rewrote most. Bee Cave Drilling is the case that shaped it: four
"since YYYY" phrases across the site — 1980 on the contact page, 2011 and 2012 on the team
page, 2016 on the reviews page. Only the first is a founding year; the rest are staff tenure
and review dates. No amount of regex distinguishes them. The resolution was to stop trying: the
extractor emits all four, halves its own confidence for being unsure, and the disagreement
surfaces as a conflict the user settles in one click with each candidate's source page shown.
"Ask a human, cheaply" turned out to be a better answer than any heuristic, and it fits MoFlo's
non-technical customers better too — one tap, no typing.

The harder lesson was how many real defects were invisible to reading. Three separate phases
each found bugs that no amount of code review would have surfaced:

- **Rendering the output found extraction bugs.** Extraction defects don't look like defects in
  a JSON blob; they look like defects on a page. Several extractors were only fixed once the UI
  displayed them.
- **Running the model found two dead code paths.** The Anthropic client had never been executed
  against the API. It sent `thinking: {type: "adaptive"}` and `output_config.effort`
  unconditionally — both 400 on the configured model, which would have made every prompt fail
  and silently fall back to mock. And a nullable enum was rejected outright: `{type: ["string",
  "null"], enum: [..., null]}` returns *"Enum value 'manufacturer' does not match declared
  type"* even with `null` in the enum. That one broke the prompt that fills ten fields.
- **Opening a browser found four more.** Tailwind's focus outline-reset in the shared control
  base compiles to a `:focus` rule at specificity (0,2,0), which beats the global
  `:focus-visible` ring at (0,1,0) — so every input, select and textarea in the app had no
  visible keyboard focus, and nothing in the component source says so. A grid with no explicit
  base track scrolled two pages sideways on mobile. And `alt={item.alt ?? "Logo"}` left six
  links with no accessible name, because `??` does not replace `""`.

None of those fail a type check. None fail a unit test. Every one of them is the kind of thing
that only appears when the thing actually runs — which is why the last three phases were
mostly about running it, and why the validation harness, the live check script and the
byte-stable example generator exist at all.
