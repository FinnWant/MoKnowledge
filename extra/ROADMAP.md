# MoKnowledge — Build Roadmap

A web app that scrapes a company website and turns it into a structured, reviewable,
editable knowledge base saved as JSON. Built for the MoFlo SMB Knowledge assignment.

**Stack (mandated):** Next.js 15 (App Router) · TypeScript · Tailwind CSS · React hooks + Context
**Environment verified:** Node v20.19.2, npm 10.8.2 (Next 15 requires ≥20.0.0 ✓)

---

## 1. Requirements Traceability

Every graded requirement from the instructions, mapped to where it gets satisfied.
Nothing ships until this table is fully green. **All 28 are satisfied as of P9.**

| # | Requirement | Satisfied by | Phase |
|---|---|---|---|
| R1 | Input a company website URL | `/knowledge` URL form + zod validation | P4 |
| R2 | Scrape site for meaningful business info | `lib/scraper/*` real fetch + parse pipeline | P2–P3 |
| R3 | Display results in structured reviewable format | Category accordion on `/knowledge` | P4 |
| R4 | User can review, edit, enhance | Field-level inline editors + draft context | P5 |
| R5 | Save final KB as structured JSON | `POST /api/knowledge-bases` → JSON store | P5 |
| R6 | Cover all baseline categories | `lib/schema/knowledge-base.ts` (§4) | P1 |
| R7 | Think beyond baseline | Extended categories (§4.2) | P1, P3 |
| R8 | Loading/progress state while scraping | NDJSON streamed progress → progress UI | P3–P4 |
| R9 | Form validation + error handling | zod + typed `Result`, error boundaries | P4, P8 |
| R10 | `/knowledge/view` list of saved KBs | View page | P6 |
| R11 | Multiple view modes (card/table/detail) | View-mode switcher, persisted | P6 |
| R12 | Filtering and/or search | Client filter + search across KBs | P6 |
| R13 | Edit and delete functionality | Row actions + `PATCH`/`DELETE` routes | P6 |
| R14 | Additional management utilities | Export, duplicate, version history, completeness score | P6 |
| R15 | Responsive design | Mobile-first Tailwind, tested at 375/768/1440 | P4–P6 |
| R16 | Error handling throughout | Typed errors, per-page boundaries, retry | P8 |
| R17 | TypeScript with proper types | zod-inferred types, no `any` | all |
| R18 | Clean file organization | Directory layout (§3.3) | P0 |
| R19 | `.json` file with ≥1 complete example output | `examples/knowledge-base-*.json` | P7 |
| R20 | Database schema design documented | `docs/DATABASE.md` + `supabase/schema.sql` | P7 |
| R21 | 2–3 example LLM prompts | `prompts/` directory, real files | P7 |
| R22 | Data quality / incomplete-data approach documented | `docs/DATA-QUALITY.md` | P7 |
| R23 | Knowledge enrichment ideas documented | `docs/ENRICHMENT.md` | P7 |
| R24 | Answers to 5 required questions | [`ANSWERS.md`](../ANSWERS.md) | P9 ✅ |
| R25 | README (7 required sub-sections) | [`README.md`](../README.md) | P9 ✅ |
| R26 | Screenshots of app in action | [`docs/screenshots/`](../docs/screenshots/) | P9 ✅ |
| R27 | **Bonus:** Supabase schema, RLS, multi-company, versioning | `supabase/schema.sql` + `docs/DATABASE.md` (applied live; `npm run db:parity` + `npm run db:check`) | P7, P10 |
| R28 | UI visually matches MoFlo platform | Dark theme, `#2663eb` accent (§3.4) | P1, P4 |

**Evaluation criteria** → scraping quality (P2–P3), knowledge design (§4), prompting (P7),
technical execution (all), product thinking (§4.2), UI/UX (P4–P6).

---

## 2. What the Reference Outputs Tell Us

`Knowledge Outputs 2.13.26.pdf` contains 8 real profiles. Treating it as a spec:

### 2.1 Field frequency (out of 8 profiles)

| Always (8/8) | Common (4–7) | Rare (1–3) |
|---|---|---|
| Website, Industry, Business Model, Company Role, Service Locations, Buyers, Customer Needs, Ideal Persona, Funnels, Writing Style, Art Style, Fonts, Colors, Logos | Alt Names (6), Main Address (5), CTAs (7), Channels (7), LinkedIn (5), Suppliers (4), Industry Groupings (4), Facebook (4), Twitter (4) | Year Founded (3), Legal Entity (3), Other Locations (3), Instagram (3), Industry Outlook (2), Employee Count (1), Revenue (1) |

**Implication:** every field is optional. The schema is nullable-by-default with an explicit
"not found" state, and the UI must render gracefully at ~40% fill. This is the core of the
Data Quality answer (R22).

### 2.2 Which fields are scraped vs. derived vs. AI-generated

This split drives the whole architecture, and the assignment explicitly allows mock AI
outputs **so long as they are clearly labelled**.

| Origin | Fields | How we produce it |
|---|---|---|
| **Scraped** (verbatim from HTML/JSON-LD/meta) | website, address, socials, logos, phone, offerings, people names/titles, CTAs, testimonials, FAQ | Deterministic extractors |
| **Derived** (computed from scraped text, no LLM) | fonts, brand colors, suppliers/tech vendors, writing-style metrics, channels, funnels, industry groupings, content themes | Deterministic analyzers |
| **AI-enriched** (needs an LLM) | overview, pitch, customer needs, ideal persona, art style, founding story, business model prose, industry outlook | Real prompt files, executed live when an API key is present, mock generator otherwise; badge-labelled in UI either way |

Two concrete tells confirming this reading:
- `Art Style: "This image features a flat, monochromatic field of solid gray…"` — a vision
  model describing the logo, and in that case describing a **failed** logo fetch. Our
  version detects that case instead of narrating it.
- `Suppliers: Box.com, Google, Rackspace, DialogTech, Wufoo.com, Sendgrid, Twilio, Plausible,
  AWS, Yext, MailGun, Bright Local, TransUnion` — that is a third-party script/vendor
  fingerprint, not prose. We reproduce it with a signature table (§5.4).

### 2.3 Where we beat the reference baseline

Small, demonstrable wins worth calling out in the README:
- `Fonts: var(--font-family), sans-serif` and `var(--e-global-typography-502e136-font-family)`
  — the reference leaks unresolved CSS custom properties. We resolve variables and filter junk.
- `Art Style` narrating a blank gray image — we validate the asset before describing it.
- Reference gives 3 flat colors; we return a **role-assigned** palette
  (background/surface/text/accent) with usage frequency, which is what a content generator
  actually needs.

---

## 3. Architecture

### 3.1 Data flow

```
[URL input]
    │  POST /api/scrape  (streams NDJSON progress events)
    ▼
┌─ Crawler ──────────────────────────────────────────┐
│ robots.txt → sitemap.xml → homepage → link discovery│
│ URL classifier (about/services/pricing/team/…)      │
│ Budgeted fetch: ≤20 pages, concurrency 4, timeouts  │
└────────────────────┬───────────────────────────────┘
                     ▼  RawPage[] { url, html, status, role }
┌─ Extractors (per page, pure functions) ────────────┐
│ jsonld · metadata · contact · social · people ·    │
│ offerings · testimonials · faq · cta · media ·     │
│ legal · css(colors/fonts) · vendors · text corpus  │
└────────────────────┬───────────────────────────────┘
                     ▼  Evidence[] { field, value, sourceUrl, method, confidence }
┌─ Reconciler ───────────────────────────────────────┐
│ merge by field · precedence JSON-LD > meta > DOM   │
│ > heuristic · dedupe · conflict flags · confidence │
└────────────────────┬───────────────────────────────┘
                     ▼
┌─ Analyzers (derived, no LLM) ──────────────────────┐
│ voice metrics · palette roles · theme clustering   │
│ completeness scoring · gap questions               │
└────────────────────┬───────────────────────────────┘
                     ▼
┌─ AI enrichment (mock, clearly labelled) ───────────┐
│ prompts/*.md are the real artifact; mock generator │
│ fills pitch/persona/overview from scraped evidence │
└────────────────────┬───────────────────────────────┘
                     ▼
              KnowledgeBase draft
                     │  user reviews + edits (React Context)
                     ▼
        POST /api/knowledge-bases → JSON store (+ version)
```

### 3.2 Key architectural decisions

| Decision | Choice | Why |
|---|---|---|
| Scrape execution | Node runtime route handler, not edge | Needs `cheerio`, sockets, longer timeouts |
| Progress reporting | Single `POST` streaming **NDJSON** | No job store, no polling, no SSE plumbing; survives one process |
| HTML parsing | `cheerio` | Fast, server-only, no browser download |
| JS-rendered sites | Not supported v1; detected and reported | Playwright is a heavy dep; we detect near-empty DOM + framework markers and tell the user honestly |
| Validation + types | `zod` schema as single source of truth, types inferred | Satisfies R17 with zero drift between runtime and compile time |
| Persistence | `StorageAdapter` interface; `LocalJsonAdapter` default | Reviewer can `npm run dev` with zero setup; Supabase schema applied and verified live (`npm run db:check`), adapter slot-in ready |
| State | `KnowledgeDraftContext` + `useReducer`, split into state/dispatch contexts | Mandated (hooks + context); reducer suits path-addressed field edits. Split + memoized record cards avoid re-render storms on a 14-offering draft |
| Errors | Typed `Result<T, ScrapeError>`, never throw across boundary | Partial results still render — a half-scraped KB is valuable |

### 3.3 Directory layout

```
app/
  layout.tsx                     root shell, MoFlo-styled
  page.tsx                       → redirect to /knowledge
  knowledge/
    page.tsx                     scrape & build
    view/page.tsx                manage saved KBs
    view/[id]/page.tsx           detail view
  api/
    scrape/route.ts              POST, streams NDJSON
    knowledge-bases/route.ts     GET list · POST create
    knowledge-bases/[id]/route.ts  GET · PATCH · DELETE
components/
  ui/                            Button, Input, Badge, Card, Accordion, Skeleton…
  knowledge/                     UrlForm, ScrapeProgress, KnowledgeEditor,
                                 CategorySection, EditableField, AttentionTier,
                                 GapQuestions, SaveBar, JsonPreview, CompletenessRail,
                                 ProvenanceBadge
    editors/                     FieldEditor (8 kinds) · RecordListField
    library/                     Library, LibraryToolbar, FilterPanel, KbCard, KbTable,
                                 RecordMenu, DeleteToast, CompletenessRing,
                                 KnowledgeDetail, VersionRail, DiffPanel, RescrapePanel
lib/
  schema/knowledge-base.ts       zod schema + inferred types  ← source of truth
  scraper/
    crawler.ts  robots.ts  classify.ts  fetcher.ts
    extractors/*.ts              one file per extractor, pure + unit-tested
    analyzers/*.ts               palette, themes, text-metrics, completeness
    reconcile.ts                 evidence → knowledge base
    vendors.ts                   third-party signature table
  ai/
    prompts.ts                   prompt templates as constants
    mock-enrich.ts               labelled placeholder generator
  knowledge/
    display.ts                   knowledge base → readable, pure and unit-tested
    draft.ts                     draft reducer, attention triage, autosave codec
    records.ts                   per-collection editor specs and blank records
    progress.ts                  NDJSON events → progress state
    library.ts                   search, filters, sorting, duplicate-as-template
    diff.ts                      field-level diff for version history + re-scrape
    client.ts                    typed calls to the knowledge-base routes
  storage/
    types.ts  local-json.ts  supabase.ts(documented)
  utils/
context/knowledge-draft.tsx      split state/dispatch contexts + autosave + guard
prompts/                         R21 — the graded prompt artifacts
docs/                            DATABASE.md · DATA-QUALITY.md · ENRICHMENT.md · screenshots/
examples/                        R19 — real scraper output, built by scripts/build-examples.ts
supabase/schema.sql              R27 bonus
data/knowledge-bases/            local store (gitignored except examples)
tests/fixtures/                  saved HTML for deterministic extractor tests
```

### 3.4 Visual identity (R28)

Derived from the instructions PDF and MoFlo's own profile in the outputs PDF:
near-black background, white text, primary blue `#2663eb`, secondary gray `#4a4a4a`,
Inter-family sans, generous spacing, rounded cards. Dark-first with the accent used
sparingly on primary actions and active states.

### 3.5 What building the scrape page changed (P4, built)

Same method as §5.4b/c — everything below came from running the page against a real
scrape of `beecavedrilling.com`, not from reasoning about it beforehand.

| Found | Fix |
|---|---|
| **The result event is always split across chunk boundaries.** It carries a whole knowledge base — ~400 KB for a twenty-page site — so a client that parses per chunk works on a stub and fails on every real site | A line splitter that buffers the remainder between reads. Tested by feeding the stream three bytes at a time |
| **The "extracting" event never reached the browser before extraction finished.** Extraction is synchronous and cheerio-heavy, so it blocks the event loop with the event still in the buffer — the user watches a stalled list for the whole of it | Yield to the event loop after enqueuing the stage event, before the blocking work starts |
| **"Products & services: 1 of 1 found"** — true of a category whose single field holds eighteen offerings, and useless | Where a category *is* one collection, the summary counts records, not fields |
| **A muted `Chip` rendered at full contrast.** `cn` is a plain join, not `tailwind-merge` (deliberately — see `lib/utils/cn.ts`), so `text-ink-subtle` passed as `className` never beat the component's own `text-ink` | Gaps render as their own muted element rather than a restyled `Chip`. The rule this implies: pass `className` for layout, never to override a component's own colours |

### 3.6 What building the library changed (P6, built)

Same method again. Everything below came out of building `/knowledge/view` against a
store holding five real scrapes, not from reading the design doc back.

| Found | Fix |
|---|---|
| **A diff over stored values reports every record as changed.** Records are minted with `crypto.randomUUID` at extraction, so re-scraping an unchanged page produces structurally different objects holding identical content — all fourteen offerings would come back "changed" on the first run and the feature would be noise | Compare fields **as rendered**, reusing the P4 presenters. It is also the right question: a diff answers "is this different", not "was this rewritten". This is the load-bearing test in `tests/knowledge/diff.test.ts` — two builds of the same crawl must report nothing |
| **The summary couldn't answer the questions the library asks.** Cards and the table both show a location; search is specified across offering and people names; the filters need testimonial counts. None of it was in `KnowledgeBaseSummary`, and shipping the categories that hold it would have broken the one promise the summary exists to keep | `location`, `testimonialsCount` and a capped `keywords[]` computed server-side. Search matches an offering name without the list route shipping the offerings |
| **`needsReviewCount` counted conflicts.** The filter set distinguishes "has unreviewed fields" from "has conflicts", and the field named for the first was measuring the second | Split into `attentionCount` (fields in the review tier) and `conflictCount` |
| **`SavedVersion.rescraped` was defined in P5 and written by nothing** | Derived, not stored: editing keeps the crawl a knowledge base was built from, and applying a re-scrape brings the new crawl across with the values — so a version whose `scrape.startedAt` differs from its predecessor's is exactly a re-scraped one |
| **Undo-after-delete would have silently destroyed the version history.** Deleting removes every version; restoring the record the build page's way — delete, then put it back — would re-create it as v1, so the undo would look like it worked and quietly lose the history | The request is *held* for the length of the toast rather than sent and reversed. Which makes the countdown worth showing, and makes `keepalive` the thing that flushes it when the page closes |
| **Delete on the detail page has nowhere to put a ten-second undo** — the page it would appear on is the record being deleted | Deleting there routes back to the library with `?delete=<id>` and the library runs its own held delete. One delete path, one guard |
| **The autosave key collides.** `KnowledgeDraftProvider` keyed drafts by `sourceUrl`, so editing a *saved* record of a site that had also been scraped fresh could restore the wrong draft over it | An explicit `autosaveKey`, `moknowledge:saved:<id>` for a saved record |

---

## 4. The Knowledge Base Schema

### 4.1 Provenance envelope

Every value is wrapped, which is what makes editing, quality scoring, and honest AI
labelling all work off one mechanism:

```ts
type Sourced<T> = {
  value: T | null;
  method: 'scraped' | 'derived' | 'ai-mock' | 'user-edited' | 'not-found';
  confidence: number;          // 0–1
  sourceUrls: string[];
  note?: string;               // e.g. "conflicting values on /about and /contact"
};
```

### 4.2 Categories

**Baseline (required by the assignment):**

1. `foundation` — overview, website, industry, businessModel, companyRole, yearFounded,
   legalEntityType, employeeCount, revenue, mainAddress, otherLocations, serviceLocations, altNames
2. `positioning` — pitch, foundingStory
3. `market` — buyers, customerNeeds, idealPersona, industryGroupings, industryOutlook,
   channels, funnels, ctas, suppliersPartners
4. `branding` — writingStyle, artStyle, fonts, colors[], logos[]
5. `onlinePresence` — linkedin, facebook, instagram, twitter/x, youtube, tiktok, other[]
6. `people[]` — name, title, role, gender, bio
7. `offerings[]` — name, category, description, features[], pricing

**Beyond baseline — each justified by which MoFlo app it improves:**

**Prioritized** (full design in [`docs/SCHEMA-EXTENSIONS.md`](../docs/SCHEMA-EXTENSIONS.md)):

| Extension | Contents | Serves |
|---|---|---|
| **`proof`** ★ | testimonials (quote/author/role/platform/linked people + offerings), aggregate ratings, case studies, certifications, memberships, awards, press mentions, trust stats ("40+ years", "$8.5B in sales"), guarantees, client logos | MoSocial credibility posts, MoMail trust blocks, MoBlogs case studies — and a bounded set of *verified* claims so the model never invents a credential |
| **`contentIntelligence`** ★ | themes, posts, taxonomy, cadence + staleness, headline patterns, FAQ pairs, glossary of the company's own domain terms, seasonal signals, content gaps | MoBlogs topic pipeline, MoSocial hooks, MoMail newsletters |

★ = prioritized. Both are justified directly by defects in the reference outputs, where these
signals are already extracted but forced into ill-fitting fields (press mentions filed under
`Funnels`; testimonial content paraphrased into person bios with the quotes discarded).

| **`quality`** ★ | per-category completeness %, missing-field list, conflict flags, generated follow-up questions to ask the customer | Fits MoFlo's "do as much for them as possible" thesis, and carries the Data Quality requirement (R22) |

**Scope is exactly these three.** `voiceProfile`, `messaging`, `conversionKit`, `compliance`,
`seo`, `competitors`, and `mediaAssets` were considered and deliberately cut to keep the schema
sharp and buy time for scraping depth and UI polish. Two consequences worth noting:

- The cut list is genuinely good material for **Answer #4** ("what would you improve with more
  time") — a considered backlog reads better than a wish list.
- Text metrics (sentence length, reading grade, pronoun ratios) are *not* dropped entirely;
  they survive as an internal input to the `writingStyle` enrichment prompt rather than as a
  schema category of their own.

### 4.3 Implementation notes (P1, built)

Six places where the built schema in `lib/schema/` refines §4.2. Each is a superset of what
was designed — nothing was dropped:

| Refinement | Why |
|---|---|
| Records carry `RecordProvenance` (`id`, `method`, `confidence`, `sourceUrls`) instead of wrapping each sub-field in `Sourced<T>` | The record card in [`docs/EDIT-UX.md`](../docs/EDIT-UX.md) §4 is the unit a reviewer accepts, edits, or removes — one badge and one Revert per card, not per sub-field. The surrounding collection stays `Sourced<T[]>`, which is what carries "Birdeye widget detected; content is JS-rendered" |
| `onlinePresence` is `profiles: Sourced<SocialProfile[]>` rather than `linkedin`/`facebook`/… | A record with a `platform` enum handles the two Facebook pages and the Yelp listing that fixed fields cannot, and maps directly onto the `social_profiles` child table in the Supabase design (R20) |
| `mainAddress` is a structured `Address` with a `formatted` line | JSON-LD `PostalAddress` is the tier-1 source; discarding its structure would lose data the database design needs. The `formatted` line is what the text editor edits, so the UI is unchanged |
| `branding.writingStyle` is structured, not prose | Matches the output contract of [`prompts/03-writing-style.md`](../prompts/03-writing-style.md). `tone` as an enumerated multi-select is what lets MoSocial/MoMail/MoBlogs condition on voice programmatically — the reference profiles' free-text Writing Style can be read but not used |
| `foundation.phone` and `foundation.email` added | Contact details are extracted anyway, and `phone` is the worked conflict example in [`docs/DATA-QUALITY.md`](../docs/DATA-QUALITY.md) §4; they had nowhere to live |
| `proof.certifications` / `memberships` / `awards` stay separate arrays | Prompt 04 returns one `credentials[]` with a `kind` discriminator; `lib/ai/` routes by `kind` on the way in. Separate arrays keep the UI sections and database tables clean |

Alongside the schema, `lib/schema/field-meta.ts` holds the static per-field registry —
`impact` (1–5), `askable`, `answerCost`, plain-language `question`, `substitutes`, and which
of the eight editors renders it. That table is what turns the schema into impact-weighted
completeness scoring and ranked follow-up questions rather than a raw fill rate.

---

## 5. Scraping Pipeline Detail

### 5.1 Crawl strategy
Fetch and honour `robots.txt` (incl. crawl-delay). Read `sitemap.xml` / sitemap index when
present, else discover via nav + footer links. Same-registrable-domain only. Budget: ≤20
pages, concurrency 4, 10s per-request timeout, 2MB response cap, one retry on 5xx/timeout,
descriptive User-Agent.

### 5.2 URL classification
Score each candidate URL by path/anchor keywords into roles — `home`, `about`, `services`,
`products`, `pricing`, `contact`, `team`, `testimonials`, `faq`, `blog-index`, `blog-post`,
`legal` — then crawl highest-value roles first so a truncated crawl still gets the good pages.

### 5.3 Extraction precedence
`JSON-LD (schema.org)` > `OpenGraph/meta` > `computed` > `semantic DOM` > `regex heuristic`.
(The planned `microdata/RDFa` tier was dropped in P3: zero of the 133 captured fixture pages
use `itemtype`, while six of seven sites emit JSON-LD and all seven emit OpenGraph.)
JSON-LD is the highest-leverage target: `Organization`, `LocalBusiness`, `Person`, `Product`,
`Offer`, `FAQPage`, `Review`, `AggregateRating` cover founding year, address, hours, phone,
`sameAs` socials, people, offerings and reviews in one hit, and most WordPress/Wix/Squarespace
SMB sites emit it.

### 5.4 Derived analyzers
- **Palette** — collect hex/rgb/hsl from inline styles + linked CSS, resolve `var(--x)`
  custom properties, rank by weighted frequency, assign roles, drop near-duplicates.
- **Fonts** — `@font-face`, Google Fonts `<link>`, resolved `font-family` stacks, filtered.
- **Vendors/suppliers** — map script/iframe/link hosts against a signature table
  (Sendgrid, Twilio, Wufoo, Yext, HubSpot, Mailchimp, Calendly, Stripe, GA, Plausible…).
- **Text metrics** — sentence length distribution, Flesch-Kincaid grade, pronoun ratios,
  exclamation/question density, imperative-verb frequency, top distinctive n-grams. Real
  computation on the scraped corpus, fed into the `writingStyle` enrichment prompt so that
  field is grounded in measured signal rather than vibes. Internal input, not a schema field.
- **Themes** — term frequency over the corpus with boilerplate stripped, scored against a
  stopword + generic-business-language baseline. Feeds `contentIntelligence.themes`.
- **Completeness** — per-category fill rate, conflict detection, and generated follow-up
  questions. Feeds `quality`.

### 5.4b What crawling the real sites changed (P2, built)

Every one of these was found by running the crawler against the eight golden sites, not by
reasoning about it beforehand. They are the substance of Answer #5 ("most challenging part").

| Found | Fix |
|---|---|
| **Elevation Group AZ spent 9 of 20 budget slots on copies of its own homepage.** Half its nav 301s to `/`, and each alias looks like a distinct URL right up until the response arrives | Dedupe on the URL we *landed* on, after redirects resolve — not the one we requested |
| **A 20-page budget fetched 23 pages.** All four workers passed the `pages.length < maxPages` check before any of them pushed a result | Claim the budget slot *before* the await; release it only if the fetch failed, so a dead link costs a request but not a page |
| **The homepage was fetched twice** — crawled explicitly for its nav, then again out of the frontier, because the sitemap lists `/` like any other URL | Mark the origin seen before discovery runs, not after |
| **`?et_blog=` cost Planet Orange three slots.** Divi appends the empty parameter to every archive link | Drop empty-valued query parameters during normalization — an empty parameter never selects content |
| **`/help/privacy-policy` classified as FAQ**, because legal pages nest under help and resources sections | Check legal patterns anywhere in the path, before the ordered rules |
| **A nav link's good label was overwritten by a body link's "click here"**, because the tiebreak preferred the longer string | Placement decides; length only breaks a tie *within* a placement |
| **`response.url` is empty on some responses**, and an empty string fails the same-site check — which would report every page as an offsite redirect | Fall back to the requested URL |

Concurrency is 4, but all four workers share one rate limiter, so throughput stays at the
~1 req/sec the etiquette rules require. Concurrency buys tolerance of a slow page — Account
IT timed out on 16 requests and still returned its 20 pages — not extra load on the host.

### 5.4c What extracting from the real sites changed (P3, built)

Same method as §5.4b: everything below came out of `npm run validate` disagreeing with the
reference on a specific field, then reading the fixture to find out why.

| Found | Fix |
|---|---|
| **Bee Cave's thirteen services scored 2/13.** Its service pages live at `/well-inspections/`, `/pumping-systems/`, `/drilling/` — all classified `other`, and the offering extractor only ran on `services`/`products`/`pricing` | Two new sources: the services dropdown on the home page (the company's own catalogue, in its own words), and the `<h1>` of any single-segment page. 2/13 → 9/13 |
| **"Key People" included `webdev@drivinglocalleads.com` and `christy23424232hey`.** WordPress emits its post authors as schema.org `Person` | A name is capitalised words with no `@`, no digits, no slashes. A CMS login is not a member of staff |
| **`"@type": "Plumber"` was not recognised as a business at all**, so every JSON-LD field on those sites was skipped — the suffix regex only matched `…Business`, `…Service`, `…Agency` | An explicit set of schema.org `LocalBusiness` subtypes alongside the suffix match |
| **Every site's own assets were reported as third-party suppliers.** `registrableDomain` takes a hostname; the pipeline passed it a URL, so nothing ever matched the own-domain check | Pass the hostname. Caught by a fixture assertion, not by reading the code |
| **`#111827` — the near-black half of every Tailwind palette — was never assigned the `text` role**, because HSL saturation blows up at the ends of the lightness range and reported it at 0.39 | Role assignment uses chroma (max−min channel distance), not HSL saturation |
| **`Service Locations` scored 0 of 59.** Only one site publishes `areaServed` in markup; the rest write "Proudly Serving The Texas Hill Country" in a header | A locations extractor for the two shapes SMB sites actually use, plus prompt 01 for the prose case |
| **Prompt 01 asked for one to three sentences of `businessModel`** — a field the schema stores as a controlled enum. Prose would have had nowhere to land | The prompt returns an enum. Four more classification/list fields (`industry`, `companyRole`, `buyers`, `serviceLocations`) moved into the same batched call, since the reference fills all four on all eight profiles and no parser produces them without guessing |
| **Generated fields never wrote anything**, because `<meta name="description">` had already filled `foundation.overview` and the rule was "never overwrite an extracted value" | Five fields the schema documents as generated treat a low-confidence extraction as a *seed*: a 0.5-confidence SEO description gives way to a real overview, everything else still wins |

### 5.4d What rendering the output changed (P3 defects found in P4)

Reading a knowledge base on a page is a different test from scoring it in a table.
Four defects were invisible in `npm run validate` and obvious the moment a person
looked at the result; the fifth was visible in the table all along and the page is
what made anyone go and read the number. Overall recall **23% → 26%**, people
**16% → 68%**.

| Found | Fix |
|---|---|
| **`.text()` fuses words across element boundaries.** A footer reading `…All Rights Reserved</p><a>Privacy Policy</a>` came out as "ReservedPrivacy Policy", which is how a company's registered name reached the UI with a menu item welded on — and why `\ball rights reserved\b` silently stopped matching | `visibleText` inserts a space at block and link boundaries, and nowhere else: `<b>Bee</b>Cave` must stay one word. Every text-based extractor was reading fused text |
| **People were found on one of seven sites.** The extractor read person *cards*; the other six sites publish a heading sequence (`<h2>NATHAN</h2>` then "CEO & Co-Founder", in unrelated containers) or a page per person (`/team/kamran-zand`) | Three strategies instead of one, plus a personhood test — nouns that never appear in a name, function words, single words only when set in caps. Bee Cave 30 · Luxury Homes 0 → 9 · moflo 0 → 10 (exactly the reference's nine, plus one it missed) · elevation 0 → 3 (exact) |
| **A blog byline was published as a key person.** WordPress emits post authors as full `Person` nodes, with a Gravatar and a biography — indistinguishable from a staff profile except for what points at them | Skip `Person` nodes the graph names as an article's `author`, and any whose URL is an `/author/` archive |
| **Every profile listed `Gmpg.org` as a supplier** — a 2003 XFN spec URL WordPress puts in every page. The exclusion list meant to catch it required a `.com\|.org\|.net` suffix *after* the name, so it only matched `gmpg.org.org` | Fixed the pattern, and dropped machine-generated hostnames (`ksrndkehqnwntyxlhgto.com`) by vowel ratio. Nine real vendors gained signatures on the way |
| **"Texas Hill Country Pumping" was listed as a service area.** It is Bee Cave's sister company, and a business named after the region it serves looks exactly like the region | Trade-name words join the not-a-place list |

### 5.5 Failure modes we handle explicitly
Non-200 / DNS failure · redirect to different domain · robots disallow · JS-rendered SPA with
empty DOM · Cloudflare or bot challenge · non-HTML content type · timeout · site with a single
page · no `<body>` text. Each maps to a specific user-facing message and, wherever possible,
a partial result rather than a dead end.

---

## 6. Data Quality Strategy (R22)

Full design in [`docs/DATA-QUALITY.md`](../docs/DATA-QUALITY.md). Summary:

1. **Never fabricate.** A missing field is `{ value: null, method: 'not-found' }`, rendered as
   an explicit "Not found" chip — not an empty string, not an invented plausible value.
2. **Tiered fallback per field:** primary source → secondary source → derived inference
   (labelled, lower confidence) → user prompt. Example for `yearFounded`: JSON-LD
   `foundingDate` (0.95) → "since 1980"/"est. 1980" regex (0.55, dropping to 0.40 when a
   page yields several years) → ask the user. The copyright year is deliberately *not* a
   tier — it dates the site, not the company. Full chain in docs/DATA-QUALITY.md §3.
3. **Confidence is surfaced, not hidden** — badge per field, so the reviewer's attention goes
   where it's needed.
4. **Conflicts are flagged, not silently resolved** — two different phone numbers shows both.
5. **Completeness score + generated questions** — the app tells the SMB exactly which 6
   questions would most improve their knowledge base.

---

## 7. AI / Prompting Strategy (R21, graded)

The assignment does not require a live LLM. We ship **real prompts** plus a mock generator,
and additionally execute those prompts for real when `ANTHROPIC_API_KEY` is present — so the
default clone-and-run path needs no key, but the prompts are demonstrably functional rather
than hypothetical. Minimum three, each demonstrating a different technique:

**Written — see [`prompts/`](../prompts/) (4 files + conventions README):**

1. `prompts/01-company-profile.md` — batched generation under hard grounding constraints.
   Six prose fields in one call; `null` framed as a preferred outcome over a plausible guess.
2. `prompts/02-offering-normalization.md` — many-to-one consolidation across pages with a
   controlled category vocabulary and auditable merge provenance.
3. `prompts/03-writing-style.md` — grounds a subjective judgment in metrics we compute
   deterministically in TypeScript, so tone claims can't contradict the measured text.
4. `prompts/04-proof-extraction.md` — extraction under a machine-verifiable constraint:
   every quote must be a verbatim substring of the source, checked in code and dropped if not.

Each file: purpose · model + params · system prompt · user template with `{{placeholders}}` ·
JSON Schema output contract · edge-case table · design notes. Generated fields carry an
unmissable badge in the UI — `AI sample` for placeholder output as instructed, `AI draft`
when a real call produced it — so the reviewer is never unsure which they're looking at.

Three properties of the provider shaped all four (documented in `prompts/README.md`):
generation is constrained by `output_config.format` rather than by a "reply with JSON"
instruction, so no prompt has to beg for valid JSON; `effort` is set per prompt, `low` for
prompt 03 whose judgment is already grounded in metrics computed in TypeScript; and the
schemas stay simple — no recursion, no `minLength`/`maxLength` — so length budgets live in
the prompt text rather than in a constraint the model cannot see.

The model is set by `ANTHROPIC_MODEL`, and the request adapts to it: the reasoning controls
go out only to models that accept them. See §10.1 for the provider history and §10.2 for
what the first live run found.

---

## 8. Persistence & Bonus (R20, R27)

**v1 runtime store:** `data/knowledge-bases/{id}.json` behind `StorageAdapter`, so a reviewer
needs no credentials. Each save writes a new immutable version and moves a `current` pointer.

**Supabase design, applied and verified** (`supabase/schema.sql` + `docs/DATABASE.md`):
`organizations` → `companies` → `knowledge_bases` → `knowledge_base_versions` (immutable
snapshots, `version_no`, `created_by`) with normalized child tables `people`, `offerings`,
`testimonials`, `social_profiles`, plus `scrape_jobs` and `field_provenance`. Includes column
types, FKs, indexes, RLS policies (tenant isolation via `organization_id` + `auth.uid()`
membership join), and a written explanation of how versioning and multi-company support work.

Applied to a live Supabase project (PostgreSQL 17.6): 42 tables, 25 enum types, 83 RLS
policies, 38 triggers, 141 indexes. Every one of the nine knowledge base categories is
normalized into typed tables; nothing the knowledge base standard names is stored only as
jsonb, and `document` is retained as the immutable round-trip record the projections are
rebuilt from.

Verified by two scripts. `npm run db:parity` (252 checks) walks the zod schema and fails
if any of the 231 field paths lacks a column, comparing every enum value by value through
the column's own type. `npm run db:check` (33 checks) exercises behaviour and loads all
three committed `examples/*.json` into the schema.

Executing the schema found four defects that reviewing it had not:

1. the append-only trigger fired on cascaded deletes, making `remove(id)` impossible and
   an organization undeletable;
2. `offering_category` held five of its eight values, so a `consultation` offering could
   never be saved;
3. record ids were `uuid`, which rejects all 289 non-UUID ids in `examples/`;
4. projections were keyed on `id` alone, so the second save of an edited knowledge base
   collided on the primary key — versioning broken by the tables meant to support it.

RLS is exercised as the `authenticated` role, since the `postgres` role in a Supabase
connection string has `BYPASSRLS` and would pass against policies that do nothing.
`LocalJsonAdapter` remains the shipped default — a clone still needs no credentials.

---

## 9. Phase Plan

Each phase ends with a working, committable state.

| Phase | Deliverable | Done when |
|---|---|---|
| **P0 — Scaffold** | `create-next-app@15` (TS, Tailwind, App Router, ESLint), Vitest, deps (`cheerio`, `zod`, `lucide-react`, `robots-parser`), scripts, `.gitignore`, first commit | `npm run dev` serves, `npm run lint` + `npm test` pass clean |
| **P1 — Schema + design system** | zod schema for the full KB (§4), inferred types, `Sourced<T>` envelope, MoFlo theme tokens, base UI primitives | Schema compiles; a hand-written fixture KB validates; UI kit renders on a scratch page |
| **P2 — Crawler + golden set** | robots, sitemap, discovery, classifier, budgeted concurrent fetcher, typed errors, `scripts/snapshot.ts`, HTML fixtures + transcribed golden JSON for all 8 reference sites | Crawler snapshots all 8 golden sites and reports classified pages; fixtures committed so tests never hit the network |
| **P3 — Extractors + reconciler + analyzers** ✅ | All extractors, vendor table, voice/palette/theme analyzers, evidence reconciliation, AI layer (mock + optional live client), `scripts/validate.ts` scoring harness | Unit tests on fixtures green; all 8 golden sites produce schema-valid KBs; `npm run validate` prints per-field recall vs. the reference; enrichment works with and without an API key |
| **P4 — Scrape page** ✅ | `/knowledge`: URL form + validation, streaming `POST /api/scrape`, NDJSON progress UI, category display, provenance + attention badges, completeness rail, JSON download — what building it changed is in §3.5 | Paste a URL → live progress → structured result; bad URLs and dead sites fail gracefully. Route tested end-to-end over a stubbed site; display presenters tested against a real fixture scrape |
| **P5 — Edit + save** ✅ | Draft context + reducer, 8 field editors, attention triage tier, conflict resolution, gap-question form, add/remove/reorder records, localStorage autosave, unsaved-changes guard, JSON preview, `StorageAdapter` + versioned local JSON store, save/read/delete routes — design and outcomes in [`docs/EDIT-UX.md`](../docs/EDIT-UX.md) | Save with zero edits produces a schema-valid KB; an edit shows `You edited`; `Accept all safe` clears uncontested items; every save writes a new immutable version. `Regenerate` (EDIT-UX §7, third enhance affordance) deferred — it needs an enrichment endpoint |
| **P6 — View/manage** ✅ | `/knowledge/view` card + table + detail modes, search, filters, edit, delete w/ undo, export, duplicate as template, version history + diff, re-scrape with per-field accept — design in [`docs/VIEW-PAGE.md`](../docs/VIEW-PAGE.md), what building it changed in §3.6 | Full CRUD round-trip verified end to end; all three view modes usable at 375px. Library rules and the diff engine unit-tested against real scrapes |
| **P7 — Docs + artifacts** ✅ | `examples/*.json` generated by `npm run examples` from the committed fixtures and schema-validated on every build, `docs/DATABASE.md`, `docs/ENRICHMENT.md`, `supabase/schema.sql` (since rewritten to normalize all nine categories, applied live and verified — see §8), `docs/DATA-QUALITY.md` audited against shipped code, `prompts/` | Every graded artifact exists and is accurate to shipped code; `npm run examples -- --check` fails if an example drifts |
| **P8 — Hardening** ✅ | `error.tsx` / `global-error.tsx` / `not-found.tsx` (none existed), SSRF guard on every fetched URL, keyboard focus ring restored across all form controls, horizontal-overflow fix in 14 responsive grids, accessible names on media links, model-call timeout sized against the route budget — findings in §9.1 | Adversarial URL list all handled; keyboard-only pass; no console errors — all three verified in a browser against a production build |
| **P9 — Submission** ✅ | `README.md` rewritten around the 7 required sub-sections, `ANSWERS.md` (5 questions), 11 screenshots in `docs/screenshots/` captured from a production build, `examples/` (P7) | Traceability table (§1) fully green. Fresh `git clone && npm i && npm run dev` verified in a scratch clone: all routes serve, no key or config needed, 0 page errors on an empty store |

**Critical path:** P0 → P1 → P2 → P3 → P4 → P5 → P6. P7 can be drafted alongside P3–P6;
P8/P9 are the finish.

### 9.1 What hardening found (P8)

Five defects, four of which no amount of re-reading the source would have surfaced.

| Defect | Why it was invisible |
|---|---|
| **SSRF** — `http://169.254.169.254/latest/meta-data/` passed validation and was crawled, so cloud-instance credentials would land in a knowledge base as scraped content | `websiteInputSchema` only required a dot in the hostname, and a metadata address has three |
| **No keyboard focus ring on any form control** | Tailwind's focus outline-reset in the shared control base compiles to a `:focus` rule at specificity (0,2,0), silently beating the global `:focus-visible` ring at (0,1,0). Nothing in the component says so |
| **Horizontal overflow at 375px and 768px** on the detail page (1211px wide) and library (493px) | A grid with no explicit base track gets an implicit max-content column; the rail's nowrap chips sized it and `overflow-x-auto` never engaged |
| **Six links with no accessible name** | `alt={item.alt ?? "Logo"}` — `??` does not replace `""`, so an empty alt marked the image decorative and left the link nameless |
| **No error boundaries at all** | Nothing fails until something throws, and then it is a blank page in production |

The first four were found by running the app, not by reading it: three viewports x six
routes under headless Chromium, a tab walk recording the computed outline at every stop,
and a check for interactive elements with no accessible name. The a11y work already in
the design system held up — contrast is measured and documented in `globals.css`, the
focus ring is defined once, reduced motion is respected, and every raw input already
carried a label. The focus ring was the one hole, and it was invisible from the source.

---

## 10. Decisions (locked 2026-08-13)

| Decision | Chosen | Consequence |
|---|---|---|
| Persistence v1 | Local JSON store behind `StorageAdapter` | Zero-setup for the reviewer. Supabase ships as a fully normalized schema applied and verified against a live project (R27); the adapter behind the same seam is not written yet, though its projection half is |
| JS-rendered sites | Detect and report, no headless browser | `cheerio` only. SPA/empty-DOM detection returns partial results plus an honest message; documented as a known limitation in the README |
| AI enrichment | **Mock by default, live Anthropic call when `ANTHROPIC_API_KEY` is set** (§10.1 — briefly moved to NVIDIA and back) | Prompts in `/prompts` are executable, not theoretical. Must degrade cleanly to mock with no key, and label output `AI (live)` vs `AI (mock)` distinctly |
| Testing | Vitest unit tests on saved HTML fixtures | Covers extractors, reconciler, analyzers. No E2E layer |
| Beyond-baseline scope | Exactly three: `proof`, `contentIntelligence`, `quality` (§4.2, [`docs/SCHEMA-EXTENSIONS.md`](../docs/SCHEMA-EXTENSIONS.md)) | Seven other proposed extensions cut; they become the substance of Answer #4 |
| Test corpus | The 8 companies from the reference PDF ([`docs/VALIDATION.md`](../docs/VALIDATION.md)) | Enables measured accuracy claims by cross-referencing our output against MoFlo's own. **7 of 8 captured** — `jdinsassociates.com` went offline between the reference date and ours |

### Follow-on work created by the live-LLM decision

- `lib/ai/client.ts` — thin wrapper: reads `ANTHROPIC_API_KEY`, fails closed when absent so
  every caller falls back to `mock-enrich.ts` without branching at the call site.
- Prompt templates become the shared input to both paths — the mock generator consumes the
  same `{{placeholders}}`, so the prompts are proven by the mock path even with no key.
- Enrichment runs server-side only, inside the scrape route, after reconciliation; the key
  never reaches the client.
- Response validation: LLM JSON output is parsed through the same zod schema as everything
  else, and a validation failure degrades to mock rather than surfacing an error.
- README gains a short "Running with live AI enrichment (optional)" section; the default
  documented path stays key-free.
- Costs/latency: enrichment is one batched call over the reconciled evidence, not per field.

### 10.1 Provider: Anthropic → NVIDIA → Anthropic (settled 2026-08-18)

The AI layer moved to NVIDIA's hosted inference API on 2026-08-17 and moved back the next
day. Recording the round trip rather than deleting it, because the reason it failed is the
useful part.

**Why the move back.** NVIDIA's free `build.nvidia.com` endpoints were not usable. A valid
inference key authenticated (a deliberately bogus key 403s in ~1s; a real one did not) and
then every `chat/completions` request hung with no response headers at all, on both
`meta/llama-3.3-70b-instruct` and `meta/llama-3.2-1b-instruct`. `GET /v1/models` answered
in 1.1s throughout, so the endpoint was reachable — the inference path simply never
returned. Nothing in the code could fix that.

**The seam held, twice.** One file talks to a provider. `lib/ai/enrich.ts`, `messages.ts`,
`verify.ts`, and `mock-enrich.ts` were untouched in both directions, and the four prompt
files were executed verbatim throughout. The move out and the move back were each
essentially one file plus its test.

**What came back with it:** `@anthropic-ai/sdk`, `output_config.format` for structured
output, `cache_control: ephemeral` on the system block, `PROMPT_EFFORT` per prompt in place
of `PROMPT_TEMPERATURE`, and `stop_reason` rather than `finish_reason`. `extractJson` and
the guided-JSON retry are gone — structured output makes both unnecessary.

**What is new, and was not in the pre-NVIDIA version:**

| Change | Why |
|---|---|
| `ANTHROPIC_MODEL` / `ANTHROPIC_MAX_TOKENS` env overrides | The model was hardcoded to `claude-opus-5` before. Which model is worth paying for is a deployment decision |
| `supportsReasoningControls()` gates `thinking` and `effort` | See §10.2 — both are a 400 on pre-4.6 models, and the model is now an env var, so the request has to fit whatever is configured |
| `nullableEnum()` in `schemas.ts` | See §10.2 — the old schema shape was rejected outright, and had never been run live |

### 10.2 What the first live run actually found (2026-08-18)

The pre-NVIDIA Anthropic client had never been executed against the API. Running it
surfaced two defects that no amount of re-reading would have:

1. **`thinking: {type: "adaptive"}` and `output_config.effort` are 400s on Haiku 4.5**
   (`adaptive thinking is not supported on this model`, `This model does not support the
   effort parameter`). Both arrived with the 4.6 generation. The old client sent them
   unconditionally, so with the configured model every one of the four prompts would have
   failed and silently fallen back to mock. `supportsReasoningControls()` now matches on
   model family — not an id allow-list, since ids carry optional date suffixes — and shapes
   the request accordingly.

2. **A nullable enum was rejected by structured outputs.** `{type: ["string","null"],
   enum: [...options, null]}` returns `Enum value 'manufacturer' does not match declared
   type '['string', 'null']'`, and does so *even though `null` is in the enum* — probing
   confirmed the type union and the enum simply cannot be combined. Dropping the redundant
   `type` fixes it and keeps nullability, which matters: `null` is the answer these prompts
   are supposed to give when the site does not say. This affected `companyRole` and
   `businessModel`, so prompt 01 — the one that fills ten fields — was the one failing.

**Verified working after both fixes**, against the Bee Cave fixture with
`claude-haiku-4-5-20251001`:

| Prompt | Result |
|---|---|
| `01-company-profile` | live, 9 fields filled |
| `02-offering-normalization` | live |
| `03-writing-style` | live |
| `04-proof-extraction` | live, 3 fields filled |

Completeness on that fixture goes **0.55 → 0.74** between the mock and live paths — which
is the group (a) prediction in [`docs/ENRICHMENT.md`](../docs/ENRICHMENT.md) §1 coming true:
those fields were never enrichment gaps, only mock-mode artifacts. Four sequential calls
take ~42s, which sits inside the scrape route's budget but is the number to watch if a
fifth prompt is ever added.
