import type { ClientBase } from "pg";

import { FIELD_META, type KnowledgeBase, type Sourced } from "@/lib/schema";
import { getPath } from "@/lib/utils/path";

/**
 * Projects one KnowledgeBase document into the normalized tables.
 *
 * The write half of `SupabaseAdapter.save()`, kept separate from it because it
 * has a second caller: `rebuildProjections()` replays it from a stored
 * document. That is not a convenience — it is what makes the claim in
 * docs/DATABASE.md §3 true. Projections are a cache precisely because this
 * function can be re-run against `knowledge_base_versions.document` to
 * reproduce every row, which is what turns a projection schema change into an
 * ALTER plus a replay rather than a data migration.
 *
 * `npm run db:check` also runs it over the committed examples, so the schema is
 * tested against knowledge bases the scraper really produced rather than
 * fixtures shaped to fit it.
 */

export type ProjectionContext = { client: ClientBase; org: string; versionId: string };

type Ctx = ProjectionContext;

/** `Sourced<T>` value, or null. */
function val<T>(field: { value: T | null } | undefined): T | null {
  return field?.value ?? null;
}

/** The four RecordProvenance columns every record table carries. */
function prov(r: { method: string; confidence: number; sourceUrls: string[]; note?: string }) {
  return [r.method, r.confidence, r.sourceUrls, r.note ?? null];
}

/**
 * Inserts one row per item of a collection.
 *
 * `columns` are the record's own columns; the provenance envelope, id, tenant,
 * version and position are appended here so each caller stays a one-liner.
 */
async function insertRecords<T extends { id: string }>(
  ctx: Ctx,
  table: string,
  items: T[] | null,
  columns: string[],
  values: (item: T) => unknown[],
): Promise<void> {
  if (!items) return;
  const all = [...columns, "method", "confidence", "source_urls", "note"];
  const placeholders = all.map((_, i) => `$${i + 5}`).join(", ");
  const sql =
    `insert into ${table} (id, organization_id, version_id, position, ${all.join(", ")}) ` +
    `values ($1, $2, $3, $4, ${placeholders})`;
  for (const [index, item] of items.entries()) {
    await ctx.client.query(sql, [
      item.id,
      ctx.org,
      ctx.versionId,
      index,
      ...values(item),
      ...prov(item as never),
    ]);
  }
}

export async function projectKnowledgeBase(ctx: Ctx, kb: KnowledgeBase): Promise<void> {
  const { client, org, versionId } = ctx;

  /* ------------------------------------------------- 1. foundation */
  const f = kb.foundation;
  await client.query(
    `insert into kb_foundation (version_id, organization_id, overview, website, industry,
       business_model, company_role, year_founded, legal_entity_type, employee_count,
       revenue, phone, email, service_locations, alt_names)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      versionId, org, val(f.overview), val(f.website), val(f.industry),
      val(f.businessModel), val(f.companyRole), val(f.yearFounded),
      val(f.legalEntityType), val(f.employeeCount), val(f.revenue),
      val(f.phone), val(f.email), val(f.serviceLocations) ?? [], val(f.altNames) ?? [],
    ],
  );

  const addresses = [
    ...(val(f.mainAddress) ? [{ address: val(f.mainAddress)!, kind: "main" }] : []),
    ...(val(f.otherLocations) ?? []).map((address) => ({ address, kind: "other" })),
  ];
  for (const [index, { address, kind }] of addresses.entries()) {
    await client.query(
      `insert into addresses (organization_id, version_id, kind, formatted, street, city,
         region, postal_code, country, position)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [org, versionId, kind, address.formatted, address.street, address.city,
       address.region, address.postalCode, address.country, kind === "main" ? 0 : index],
    );
  }

  /* ------------------------------------------------ 2. positioning */
  await client.query(
    `insert into kb_positioning (version_id, organization_id, pitch, founding_story)
     values ($1,$2,$3,$4)`,
    [versionId, org, val(kb.positioning.pitch), val(kb.positioning.foundingStory)],
  );

  /* ----------------------------------------------------- 3. market */
  const m = kb.market;
  await client.query(
    `insert into kb_market (version_id, organization_id, buyers, customer_needs, ideal_persona,
       industry_groupings, industry_outlook, channels, funnels, ctas, suppliers_partners)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [versionId, org, val(m.buyers) ?? [], val(m.customerNeeds), val(m.idealPersona),
     val(m.industryGroupings) ?? [], val(m.industryOutlook), val(m.channels) ?? [],
     val(m.funnels) ?? [], val(m.ctas) ?? [], val(m.suppliersPartners) ?? []],
  );

  /* --------------------------------------------------- 4. branding */
  const b = kb.branding;
  await client.query(
    `insert into kb_branding (version_id, organization_id, art_style, fonts) values ($1,$2,$3,$4)`,
    [versionId, org, val(b.artStyle), val(b.fonts) ?? []],
  );
  const ws = val(b.writingStyle);
  if (ws) {
    await client.query(
      `insert into kb_writing_style (version_id, organization_id, description, tone, formality,
         reader_address, preferred_terms, avoid_terms, cta_style)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [versionId, org, ws.description, ws.tone, ws.formality, ws.readerAddress,
       ws.preferredTerms, ws.avoidTerms, ws.ctaStyle],
    );
  }
  await insertRecords(ctx, "brand_colors", val(b.colors), ["hex", "role", "frequency"],
    (c) => [c.hex, c.role, c.frequency]);
  await insertRecords(ctx, "media_assets", val(b.logos),
    ["slot", "url", "alt", "kind", "width", "height"],
    (l) => ["branding.logos", l.url, l.alt, l.kind, l.width, l.height]);

  /* -------------------------------- 5–7. presence, people, offerings */
  await insertRecords(ctx, "social_profiles", val(kb.onlinePresence.profiles),
    ["platform", "url", "handle"], (p) => [p.platform, p.url, p.handle]);
  await insertRecords(ctx, "people", val(kb.people),
    ["name", "title", "role", "gender", "bio", "email", "phone", "image_url", "profile_url", "linkedin"],
    (p) => [p.name, p.title, p.role, p.gender, p.bio, p.email, p.phone, p.imageUrl, p.profileUrl, p.linkedin]);
  await insertRecords(ctx, "offerings", val(kb.offerings),
    ["name", "category", "description", "features", "pricing", "url", "source_candidate_indexes"],
    (o) => [o.name, o.category, o.description, o.features, o.pricing, o.url, o.sourceCandidateIndexes]);

  /* ------------------------------------------------------ 8. proof */
  const p = kb.proof;
  await insertRecords(ctx, "testimonials", val(p.testimonials),
    ["quote", "author_name", "author_role", "author_company", "author_location", "rating",
     "published_date", "platform", "media_url", "topics", "mentions_people", "mentions_offerings"],
    (t) => [t.quote, t.authorName, t.authorRole, t.authorCompany, t.authorLocation, t.rating,
            t.date, t.platform, t.mediaUrl, t.topics, t.mentionsPeople, t.mentionsOfferings]);
  await insertRecords(ctx, "aggregate_ratings", val(p.aggregateRatings),
    ["platform", "rating_value", "best_rating", "review_count"],
    (r) => [r.platform, r.ratingValue, r.bestRating, r.reviewCount]);
  await insertRecords(ctx, "case_studies", val(p.caseStudies),
    ["title", "client", "problem", "solution", "results", "metrics", "url"],
    (c) => [c.title, c.client, c.problem, c.solution, c.results, c.metrics, c.url]);
  await insertRecords(ctx, "credentials", val(p.certifications),
    ["slot", "name", "issuer", "identifier", "valid_until", "verify_url", "kind"],
    (c) => ["proof.certifications", c.name, c.issuer, c.identifier, c.validUntil, c.verifyUrl, c.kind]);
  await insertRecords(ctx, "credentials", val(p.memberships),
    ["slot", "name", "issuer", "identifier", "valid_until", "verify_url", "kind"],
    (c) => ["proof.memberships", c.name, c.issuer, c.identifier, c.validUntil, c.verifyUrl, c.kind]);
  await insertRecords(ctx, "awards", val(p.awards), ["name", "issuer", "year"],
    (a) => [a.name, a.issuer, a.year]);
  await insertRecords(ctx, "press_mentions", val(p.pressMentions),
    ["outlet", "title", "url", "published_date", "kind"],
    (x) => [x.outlet, x.title, x.url, x.date, x.kind]);
  await insertRecords(ctx, "trust_stats", val(p.trustStats),
    ["claim", "value", "unit", "category", "as_of_date"],
    (t) => [t.claim, t.value, t.unit, t.category, t.asOfDate]);
  await insertRecords(ctx, "guarantees", val(p.guarantees), ["body", "kind", "terms"],
    (g) => [g.text, g.kind, g.terms]);
  await insertRecords(ctx, "media_assets", val(p.clientLogos),
    ["slot", "url", "alt", "kind", "width", "height"],
    (l) => ["proof.clientLogos", l.url, l.alt, l.kind, l.width, l.height]);

  /* --------------------------------------- 9. content intelligence */
  const ci = kb.contentIntelligence;
  await insertRecords(ctx, "content_themes", val(ci.themes),
    ["label", "weight", "terms", "example_urls"],
    (t) => [t.label, t.weight, t.terms, t.exampleUrls]);
  await insertRecords(ctx, "content_items", val(ci.posts),
    ["title", "url", "published_at", "author", "category", "excerpt", "word_count", "headings"],
    (i) => [i.title, i.url, i.publishedAt, i.author, i.category, i.excerpt, i.wordCount, i.headings]);
  const tax = val(ci.taxonomy);
  if (tax) {
    await client.query(
      `insert into kb_taxonomy (version_id, organization_id, categories, tags) values ($1,$2,$3,$4)`,
      [versionId, org, tax.categories, tax.tags],
    );
  }
  const cad = val(ci.cadence);
  if (cad) {
    await client.query(
      `insert into kb_cadence (version_id, organization_id, posts_per_month, first_published,
         last_published, days_since_last, is_stale) values ($1,$2,$3,$4,$5,$6,$7)`,
      [versionId, org, cad.postsPerMonth, cad.firstPublished, cad.lastPublished,
       cad.daysSinceLast, cad.isStale],
    );
  }
  await insertRecords(ctx, "headline_patterns", val(ci.headlinePatterns),
    ["pattern", "count", "examples"], (h) => [h.pattern, h.count, h.examples]);
  await insertRecords(ctx, "faqs", val(ci.faqs), ["question", "answer", "topic"],
    (q) => [q.question, q.answer, q.topic]);
  await insertRecords(ctx, "glossary_terms", val(ci.glossary), ["term", "definition"],
    (g) => [g.term, g.definition]);
  await insertRecords(ctx, "seasonal_signals", val(ci.seasonalSignals), ["label", "period", "body"],
    (x) => [x.label, x.period, x.text]);
  await insertRecords(ctx, "content_gaps", val(ci.contentGaps), ["topic", "reason", "related_offering"],
    (g) => [g.topic, g.reason, g.relatedOffering]);

  /* ---------------------------------------------------- 10. quality */
  for (const cs of kb.quality.categoryScores) {
    await client.query(
      `insert into quality_category_scores (version_id, organization_id, category, score,
         filled_fields, total_fields, needs_attention) values ($1,$2,$3,$4,$5,$6,$7)`,
      [versionId, org, cs.category, cs.score, cs.filledFields, cs.totalFields, cs.needsAttention],
    );
  }
  for (const [index, conflict] of kb.quality.conflicts.entries()) {
    await client.query(
      `insert into quality_conflicts (organization_id, version_id, path, label, resolved, position)
       values ($1,$2,$3,$4,$5,$6)`,
      [org, versionId, conflict.path, conflict.label, conflict.resolved, index],
    );
    for (const [ci2, candidate] of conflict.candidates.entries()) {
      await client.query(
        `insert into quality_conflict_candidates (organization_id, version_id, conflict_path,
           value, source_url, source_label, confidence, position) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [org, versionId, conflict.path, JSON.stringify(candidate.value ?? null),
         candidate.sourceUrl, candidate.sourceLabel, candidate.confidence, ci2],
      );
    }
  }
  for (const [index, q] of kb.quality.followUpQuestions.entries()) {
    await client.query(
      `insert into quality_follow_up_questions (id, organization_id, version_id, question,
         example, fills, priority, answered, position) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [q.id, org, versionId, q.question, q.example, q.fills, q.priority, q.answered, index],
    );
  }

  /* ------------------------------------------- scrape metadata */
  const sc = kb.scrape;
  await client.query(
    `insert into kb_scrape_metadata (version_id, organization_id, started_at, finished_at,
       duration_ms, pages_discovered, robots_respected, scraper_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [versionId, org, sc.startedAt, sc.finishedAt, sc.durationMs, sc.pagesDiscovered,
     sc.robotsRespected, sc.scraperVersion],
  );
  for (const [index, page] of sc.pages.entries()) {
    await client.query(
      `insert into scrape_pages (organization_id, version_id, url, role, status, bytes,
         fetched_at, position) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [org, versionId, page.url, page.role, page.status, page.bytes, page.fetchedAt, index],
    );
  }
  for (const [index, w] of sc.warnings.entries()) {
    await client.query(
      `insert into scrape_warnings (organization_id, version_id, code, message, url, position)
       values ($1,$2,$3,$4,$5,$6)`,
      [org, versionId, w.code, w.message, w.url, index],
    );
  }

  /* ------------------------------------------------ field provenance */
  //
  // The `Sourced<T>` envelope for every scalar, unrolled. FIELD_META is the same
  // list the review UI walks, so the rows here are exactly the fields the app
  // considers reviewable — which is what makes the attention-tier index in the
  // schema mirror `needsReview` rather than approximate it.
  for (const meta of FIELD_META) {
    const field = getPath(kb, meta.path) as Sourced<unknown> | undefined;
    if (!field) continue;
    await client.query(
      `insert into field_provenance (version_id, organization_id, path, category, method,
         confidence, is_filled, source_urls, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (version_id, path) do nothing`,
      [versionId, org, meta.path, meta.category, field.method, field.confidence,
       field.value !== null, field.sourceUrls, field.note ?? null],
    );
  }
}
