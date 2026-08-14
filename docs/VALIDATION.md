# Validation Plan: Golden-Set Cross-Reference

We have something most scraper projects never get — **eight real websites paired with the
output the grader's own system produced for them**. Using them as a golden set turns
"our scraper seems good" into a measured claim, and it's a strong README/answers point.

Companion to [`../ROADMAP.md`](../ROADMAP.md) §9 (phases P2–P3).

---

## 1. The golden set

All eight companies profiled in `Knowledge Outputs 2.13.26.pdf`:

| # | Company | Site | Industry | Why it's a useful test |
|---|---|---|---|---|
| 1 | Account IT | `account-it.net` | Accounting / tax | Sparse profile — no employee count, no revenue; tests graceful degradation. Richest `Suppliers` list (13 vendors) → best vendor-detection test |
| 2 | Bee Cave Drilling | `beecavedrilling.com` | Well drilling | 14 offerings, 8 people, 2 locations — the densest profile. All people testimonial-derived → primary `proof` test |
| 3 | Elevation Group AZ | `elevationgroupaz.com` | Real estate | Has `Industry Outlook`; leaked `var(--e-global-typography-…)` font → CSS-variable resolution test |
| 4 | J&D Insurance Associates | `jdinsassociates.com` | Insurance | Regulated industry, bilingual (EN/ES) → compliance + locale signals |
| 5 | Luxury Homes Las Vegas | `luxuryhomeslasvegas.com` | Luxury real estate | Press mentions (LEI Magazine, LV Review Journal, Mansion Global) → `pressMentions` test |
| 6 | MoFlo | `moflo.ai` | AI software | The grader's own company. Only profile with `Employee Count`; leaked `var(--font-family)` |
| 7 | Night Owl Monitoring | `nightowlmonitoring.com` | IoT / water monitoring | Blog-heavy with FAQ sections and a glossary of terms → primary `contentIntelligence` test |
| 8 | Planet Orange | `planetorange.com` | Pest control | Only profile with `Revenue`; state-licensed inspectors → credentials test |

Six distinct industries, seven service SMBs plus one SaaS — good coverage of the customer
base MoFlo describes.

---

## 2. Critical caveat: the reference is a peer, not a ground truth

Two things prevent naive scoring:

**Temporal drift.** The reference PDF was generated **2026-02-10 to 2026-02-13**. We are
scraping roughly six months later. Sites will have changed — new staff, new pricing, redesigns.
A disagreement is not automatically our error. Every run records `fetchedAt`, and disagreements
on volatile fields (people, pricing, offerings, colors) get a `possible-drift` marker rather
than a failure.

**The reference has known defects.** Documented in `ROADMAP.md` §2.3: unresolved CSS variables
in `Fonts` for two profiles, and Account IT's `Art Style` describing a blank gray image because
the logo fetch failed. We deliberately diverge there. Those are logged as **intentional
divergences with a stated reason**, not misses.

So the harness reports *agreement*, and we maintain a short ledger of where we knowingly differ
and why. Claiming to have "beaten" their output requires showing the reasoning, not a score.

---

## 3. Scoring methodology

Fields are scored by class, because exact-match is meaningless for AI-generated prose.

| Class | Fields | Metric |
|---|---|---|
| **Exact** (normalized) | website, main address, year founded, legal entity type, employee count, revenue, social URLs, logo URL, brand colors (hex) | Match rate. Normalization: lowercase, strip `www.`/trailing slash/protocol, canonicalize hex |
| **Set overlap** | service locations, other locations, alt names, buyers, industry groupings, channels, funnels, CTAs, suppliers, fonts, offering names, people names | Precision / recall / F1 against the reference set. Fuzzy member matching at ≥0.85 token similarity |
| **Structured records** | offerings (name + category + pricing), people (name + title) | Record-level F1, matched on name |
| **Prose (not auto-scored)** | overview, pitch, business model, customer needs, ideal persona, founding story, writing style, art style, industry outlook | Manual spot-check against a 4-point rubric: factually grounded · on-tone · complete · non-hallucinated |
| **Net new** | everything in `proof` + `contentIntelligence` + `voiceProfile` etc. | Count and sample — no reference counterpart by definition |

**Headline metric:** per-field recall against the reference on Exact + Set + Structured classes,
plus a net-new count. Recall matters more than precision here — extracting *more* than the
reference is the goal, so precision penalties only apply to values that are actually wrong.

---

## 4. Harness design

```
tests/
  golden/
    account-it.json           hand-transcribed from the PDF (comparable fields only)
    bee-cave-drilling.json
    …                          8 files
  fixtures/
    account-it/               snapshotted HTML per crawled page + manifest.json
    …
scripts/
  snapshot.ts                 crawl a golden site → write fixtures/ (manual, rate-limited)
  validate.ts                 run pipeline over fixtures → compare to golden/ → report
```

- `npm run snapshot -- <slug>` — one-time capture, so tests never hit the network.
- `npm run validate` — scores every site, prints a per-field table plus totals.
- Vitest extractor unit tests run against the same fixtures, keeping tests deterministic and
  fast while remaining grounded in real-world HTML.

**Transcription scope:** only the auto-scorable fields go into `golden/*.json` — roughly 25
fields × 8 profiles. The prose fields are left out; they're reviewed by eye. This is a
half-day of careful data entry and it's a prerequisite for P3's acceptance criteria.

---

## 5. Scraping etiquette

These are real small businesses, not test targets. The harness must:
- honour `robots.txt` including crawl-delay,
- rate-limit to ~1 request/second per host with a descriptive User-Agent,
- snapshot once and work from fixtures thereafter — never re-crawl in tests or CI,
- stay within the ≤20-page budget,
- fetch only public marketing pages; never submit forms or touch anything behind auth.

---

## 6. What this produces for the submission

- A measured accuracy claim in the README instead of an assertion.
- Answer #1 ("what approach did you take to scraping and structuring") gains real numbers.
- Answer #5 ("most challenging part") gains concrete, specific material.
- The intentional-divergence ledger demonstrates judgment — knowing where the baseline is
  wrong is a stronger signal than matching it.
