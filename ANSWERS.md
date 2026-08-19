## 1. What approach did you take to scraping and structuring the knowledge base data?

Extractors don't write final answers. Each one proposes evidence, and a separate reconciler decides what actually gets kept.

I tried the more obvious approach first, one function per field, reading a page and returning a value, and it fell apart quickly. The home page and the contact page often disagree about something as basic as a phone number, and whichever extractor happened to run last would just overwrite the other's answer with no record that they'd conflicted at all.

So I changed the model. None of the eleven extractors write to a field directly. Each one returns a list of evidence: a claim, the field it belongs to, how it was found (structured data, Open Graph tags, meta tags, the raw DOM, a heuristic, or a computed value), and which page it came from. Every extractor runs against every page. A reconciler then works through all of that evidence, sorting first by source reliability, then by the type of page it came from (a phone number on the contact page outranks the same number showing up in a blog footer), then by how often the same value repeats across pages. When two answers genuinely disagree, that isn't hidden. It gets recorded as a conflict, with both candidates and where each came from, so the review screen can ask a person instead of guessing.

Every value also carries its own history. A single field is stored as an object with the value itself, the method used to find it, a confidence score, the source URLs, and an optional note. Lists work the same way, except each item in the list carries its own record of where it came from, since something like a person's profile gets accepted or rejected as a whole card rather than field by field. That one design decision ends up covering a lot of ground on its own. It's what lets the review screen show where a value came from, prioritize low-confidence records for review, let a user revert a single field, and be honest about which text was written by a model.

A missing value counts as a real answer, not a failure. Roughly half of what a typical scrape produces gets marked "not found" with zero confidence. Across the eight reference companies we tested against, "year founded" only showed up for three of them, and "revenue" for just one. A system that can't handle that gracefully either looks broken or starts making things up. Extractors return null instead of an empty string, and the review screen just says "Not found" plainly.

The crawler is deliberately conservative. It respects robots.txt, reads the sitemap first since that's the site telling you what it thinks matters, sorts pages by type, and stops after 20 pages. Normalizing URLs turned out to matter more than I expected. Without it, that 20-page budget gets burned on duplicate versions of the same page: with or without a trailing slash, different capitalization, tracking parameters tacked on. One site we tested was appending a blank query parameter to every archive link, which alone used up three of the twenty pages before we started stripping empty parameters.

The structure of the data lives in a single schema file, and every TypeScript type is generated from it, so the runtime checks and the compile-time types can't drift apart from each other. A second file sits alongside it and tracks things the schema itself doesn't need to know: how important each field is on a 1 to 5 scale, whether a typical customer would even know the answer, and what plain-language question to ask if the field comes back empty. That second file is what makes the schema useful as a product feature. It drives the completeness score and decides which follow-up questions get asked first.

None of this is just asserted to work. It's checked. A validation script scores the extraction against reference data pulled from the original PDF and transcribed into a golden JSON file, running entirely against saved HTML so results are repeatable. Current recall by field: website 100%, socials 86%, main address 80%, people 68%, year founded 67%, offerings 24%, and 26% overall across the seven test sites. That number needs a caveat. It measures agreement with someone else's reference answers, not correctness. In most categories we're actually pulling in more information than the reference did (102 offerings versus their 84, 58 people versus 31, 63 social profiles versus 14), and none of that extra, accurate information raises the score, since the metric only rewards matching what's already there. Some of the reference values are also just wrong, and we disagree with them on purpose. So this is a regression check, not a grade.

---

## 2. What information beyond our current baseline did you choose to include, and why?

I added three new categories:

Proof covers testimonials (with the author, platform, and links back to the people or services they mention), aggregate ratings, case studies, certifications, memberships, awards, press mentions, stats, guarantees, and client logos. The goal is a bounded, verified set of claims, so when content gets generated later it can cite "40+ years in business" because a page actually said that, and it can never invent a credential from nothing. This is enforced in code, not just by convention. Every quote that gets extracted has to be a verbatim match to the source text, or it gets dropped.

Content intelligence covers themes, posts, categories, how often the company publishes and whether it's gone quiet, common headline patterns, FAQ pairs, a glossary of terms specific to that business, seasonal patterns, and gaps in what's been written about. A blog-writing tool that doesn't know what a company has already covered is just going to repeat itself.

Quality covers completeness by category, a list of what's missing, unresolved conflicts, and up to six ranked follow-up questions. This one probably lines up best with what MoFlo is trying to do for its customers. Instead of showing an empty box labeled "year founded," the product can just ask "What year did you start?" and rank that question against every other gap using impact, how likely the customer is to actually know the answer, and how much effort it takes to answer. That last part matters. A question the customer skips isn't worth anything, no matter how important the field is.

I capped it at three new categories on purpose. Voice profile, messaging, a conversion kit, compliance, SEO, competitors, and media assets were all designed but cut, so I could put more time into scraping depth and polishing the review interface instead. Those are the backlog items in question 4.

---

## 3. How would your knowledge base design improve the outputs of MoSocial, MoMail, and MoBlogs specifically?

MoSocial. Social copy tends to fail by sounding generic, like it could have been written for any company. The writing-style field is grounded in metrics calculated directly from the text itself (sentence length, reading level, how often passive voice shows up, how often the company refers to itself as "we"), so any description of the brand's tone has to match what's actually on the page rather than being guessed by a model. The proof category gives quotable, attributed testimonials instead of vague paraphrasing. Headline patterns and calls-to-action pulled from the company's own content give it something closer to its real voice instead of stock marketing language, and seasonal signals tell the tool when to post about what.

MoMail. Email tends to fail by talking to the wrong person about the wrong problem. Buyer segments, ideal customer profiles, and customer needs are exactly what an outbound sequence needs to get that right. Pricing is stored exactly as published, "starting at $250," qualifier and all, because that qualifier is often the part a salesperson actually needs, and a cleaned-up number would lose it. Guarantees and trust stats give the email something to lean on, and FAQs double as pre-written objection handling in the company's own words.

MoBlogs. Long-form content tends to fail in two ways: repeating what the company has already published, and using the wrong vocabulary for the industry. Themes, posts, and categories show what's already been covered; content gaps show what hasn't. Publishing cadence shows how often (or rarely) the company writes, and the glossary captures the specific terms the business actually uses, the difference between "water well maintenance" and whatever term this particular company uses for it. Case studies and testimonials linked back to specific services turn a generic article into one that actually has evidence behind it.

---

## 4. What would you improve or change about MoKnowledge if you had more time?

The single biggest gap is that the scraper can't handle JavaScript-rendered sites. It's built on cheerio reading fetched HTML, so a site built in React that renders on the client side gives back almost nothing but metadata. The tool detects this and reports it honestly rather than failing silently, but adding a headless browser for the subset of sites that need it would improve extraction more than any other single change I could make.

Second, the seven categories I designed but didn't build: a proper voice profile (treating the measured writing metrics as a real field instead of just an input to a prompt), messaging, a conversion kit, compliance, SEO, competitors, and media assets. Competitors is probably the most valuable of these and also the trickiest, since it requires pulling in information from outside the company's own site, and every piece of that needs to be clearly labeled as coming from somewhere else.

Third, there's a feature I started but didn't finish: letting a user regenerate a single AI-written field with an optional nudge, like "make this warmer" or "make this shorter." Adding new records and answering the follow-up questions both already work end to end. Regenerating a field doesn't yet, mainly because it needs its own small enrichment endpoint that didn't fit into the phase it belonged to. Now that live enrichment is working elsewhere in the system, this would be a relatively small addition with a solid payoff.

Finally, the evaluation approach itself should change. Right now the score just measures agreement with someone else's reference data. What it should measure is whether the knowledge base actually leads to better content: generate a blog post from a knowledge base with the proof category included and without it, and score the difference. That's closer to the thing the product is actually trying to optimize for.

---

## 5. What was the most challenging part of this assignment?

The hard part wasn't the scraping itself. It was figuring out what to do when the evidence contradicts itself, and then realizing how much of that judgment call stays invisible until you actually run the system and watch it work.

The reconciler is the piece I rewrote the most, and one company in particular is what forced that rewrite. Their site had four different "since [year]" phrases scattered across it: 1980 on the contact page, 2011 and 2012 on the team page, 2016 on the reviews page. Only the first one is actually the founding year; the rest are how long staff members had worked there, or dates on customer reviews. No amount of pattern-matching can reliably tell those apart. So instead of trying to be clever about it, the extractor just returns all four candidates, lowers its own confidence to reflect the uncertainty, and lets the disagreement show up as something the user resolves with one tap, seeing exactly which page each candidate came from. That turned out to work better than any heuristic I tried, and it fits how MoFlo's customers actually work. They'd rather tap once than type an explanation.

Running the model against the live API turned up two dead code paths that had never actually been executed. The client was sending two parameters that the configured model rejects outright, which would have silently failed every request and fallen back to a mock response without any error showing up. Separately, a nullable field in the schema broke one of the API calls entirely, in a way that wasn't obvious from the schema definition itself. It took an actual failed request to find it.

None of those problems would fail a type check or a unit test. That's exactly why the later phases of this project were mostly about running the thing repeatedly, through a validation script, a live check, and a generator that produces consistent example output, rather than just reading through the code and assuming it worked.
