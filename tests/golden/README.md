# Golden set

One file per company profiled in `Knowledge Outputs 2.13.26.pdf`, holding the
auto-scorable subset of what MoFlo's own system produced for that site. Methodology,
scoring classes, and caveats are in [`../../docs/VALIDATION.md`](../../docs/VALIDATION.md).

## What's in a file

| Key | Contents |
|---|---|
| `exact` | Fields compared by normalized equality: website, industry, company role, year founded, legal entity, employee count, revenue, main address, logo URL, social URLs |
| `sets` | Fields compared by precision/recall against the reference set: service and other locations, alt names, buyers, industry groupings, channels, funnels, CTAs, suppliers, fonts, colors |
| `records` | Structured records matched on name: `people` (name, title, gender), `offerings` (name, category, pricing) |
| `knownReferenceDefects` | Places the reference output is wrong, where a disagreement is a **win**, not a miss |

Prose fields — overview, pitch, business model, customer needs, ideal persona, founding
story, writing style, art style, industry outlook — are deliberately **not** here. Exact
match is meaningless for generated text; those are reviewed by eye against the rubric in
`VALIDATION.md` §3.

## How these were transcribed

`pdftotext -layout` over the reference PDF, then a parser keyed on the document's own
labels, then a manual check of every count and a fix for each defect it exposed. The
transcription is deterministic and re-runnable, which matters more than it sounds: three
things had to be resolved by hand, and each is a judgment call worth stating.

1. **Line-wrapping split long URLs.** Two logo URLs arrived with a space in the middle
   (`…h54 jfw2F1w6`). Whitespace is stripped inside URL values.
2. **The reference encodes lists as comma-separated prose,** so items containing commas
   are ambiguous. `Alt Company Names: Account-it Consulting Services, LLC` is one name,
   not two; a trailing legal suffix (`LLC`, `Inc`, `Ltd`, `Corp`, …) is rejoined to the
   name before it. Commas inside parentheses — `Promotional Offers (e.g., Fall Water Well
   Savings)` — do not split either.
3. **`Service Locations: Florida, Boynton Beach, Florida, South Florida`** is genuinely
   ambiguous: "Boynton Beach, Florida" is probably one location, and the source gives us
   no way to know. Duplicates are collapsed and the rest kept verbatim. This is why set
   fields are scored with fuzzy member matching at ≥0.85 rather than exact equality.

Blank lines separate `Key People` entries reliably, so those are grouped that way.
`Offerings` are not — the reference omits the blank line between some entries — so an
offering heading is detected by its `Name (Category)` shape instead. Both rules were
chosen after a count mismatch proved the simpler one wrong.

## What the counts look like

| Site | Year | Entity | Employees | Revenue | People | Offerings | Socials |
|---|---|---|---|---|---|---|---|
| Account IT | 2003 | LLC | — | — | 1 | 8 | 2 |
| Bee Cave Drilling | 1980 | Inc | — | — | 8 | 13 | 2 |
| Elevation Group AZ | — | — | — | — | 3 | 14 | 0 |
| JD Ins Associates | — | LLC | — | — | 0 | 11 | 2 |
| Luxury Homes Las Vegas | — | — | — | $1B+ | 2 | 10 | 3 |
| MoFlo | 2025 | — | 10 | — | 9 | 15 | 3 |
| Night Owl Monitoring | — | — | — | — | 8 | 10 | 4 |
| Planet Orange | — | — | — | — | 0 | 14 | 3 |

Year founded appears 3 times out of 8, legal entity 3, employee count once, revenue once.
That sparsity is the single most important fact about this data set, and it is why the
schema is nullable-by-default and why completeness is impact-weighted rather than a raw
fill rate.

## `jd-insurance` has no fixtures

Its domain now serves a Wix *ConnectYourDomain Error* page and 404s at every path,
including `/robots.txt`. The reference profile was generated 2026-02-13; the snapshot was
attempted 2026-08-15. The golden file is kept — the reference data is still real — but
there is nothing to score it against, so it is reference-only. This is precisely the
temporal drift `VALIDATION.md` §2 anticipated, and substituting another site would
quietly weaken the comparison it exists to support.
