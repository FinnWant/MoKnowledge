/**
 * The contract between `lib/schema/` and `supabase/schema.sql`.
 *
 * Every storable path in the zod knowledge base maps to somewhere in the
 * database. `npm run db:parity` walks the zod schema, looks each path up here,
 * and fails on anything unmapped — so adding a field to the knowledge base
 * breaks the build until the database has somewhere to put it.
 *
 * That is the point. The previous schema normalized four of the nine categories
 * and left the rest inside `document jsonb`; nothing failed, because nothing was
 * checking. A mapping that must be updated by hand is the smallest mechanism
 * that turns "we normalized everything" from a claim into a test.
 *
 * `PROVENANCE_COLUMNS` are the `RecordProvenance` fields every record table
 * carries inline, so the map below only lists a collection's own fields.
 */

/** Where one document path lives. */
export type Placement =
  /** A column on a table, `table.column`. */
  | { kind: "column"; table: string; column: string }
  /** One row per item in a record table; provenance columns are implied. */
  | { kind: "record"; table: string; column: string }
  /**
   * Deliberately not a column of its own. `reason` is required and is checked
   * by a human, not by the tool — the escape hatch has to cost something.
   */
  | { kind: "elsewhere"; reason: string };

export const PROVENANCE_COLUMNS = ["id", "method", "confidence", "sourceUrls", "note"] as const;

const col = (table: string, column: string): Placement => ({ kind: "column", table, column });
const rec = (table: string, column: string): Placement => ({ kind: "record", table, column });
const elsewhere = (reason: string): Placement => ({ kind: "elsewhere", reason });

export const SCHEMA_MAP: Record<string, Placement> = {
  // ------------------------------------------------------ knowledge base root
  id: col("knowledge_bases", "id"),
  version: col("knowledge_base_versions", "version_no"),
  companyName: col("knowledge_base_versions", "company_name"),
  sourceUrl: col("knowledge_base_versions", "source_url"),
  createdAt: col("knowledge_base_versions", "document_created_at"),
  updatedAt: col("knowledge_base_versions", "document_updated_at"),

  // ------------------------------------------------------------ scrape block
  "scrape.startedAt": col("kb_scrape_metadata", "started_at"),
  "scrape.finishedAt": col("kb_scrape_metadata", "finished_at"),
  "scrape.durationMs": col("kb_scrape_metadata", "duration_ms"),
  "scrape.pagesDiscovered": col("kb_scrape_metadata", "pages_discovered"),
  "scrape.robotsRespected": col("kb_scrape_metadata", "robots_respected"),
  "scrape.scraperVersion": col("kb_scrape_metadata", "scraper_version"),
  "scrape.pages": elsewhere("the scrape_pages table"),
  "scrape.pages[].url": rec("scrape_pages", "url"),
  "scrape.pages[].role": rec("scrape_pages", "role"),
  "scrape.pages[].status": rec("scrape_pages", "status"),
  "scrape.pages[].bytes": rec("scrape_pages", "bytes"),
  "scrape.pages[].fetchedAt": rec("scrape_pages", "fetched_at"),
  "scrape.warnings": elsewhere("the scrape_warnings table"),
  "scrape.warnings[].code": rec("scrape_warnings", "code"),
  "scrape.warnings[].message": rec("scrape_warnings", "message"),
  "scrape.warnings[].url": rec("scrape_warnings", "url"),

  // ------------------------------------------------- 1. company foundation
  "foundation.overview": col("kb_foundation", "overview"),
  "foundation.website": col("kb_foundation", "website"),
  "foundation.industry": col("kb_foundation", "industry"),
  "foundation.businessModel": col("kb_foundation", "business_model"),
  "foundation.companyRole": col("kb_foundation", "company_role"),
  "foundation.yearFounded": col("kb_foundation", "year_founded"),
  "foundation.legalEntityType": col("kb_foundation", "legal_entity_type"),
  "foundation.employeeCount": col("kb_foundation", "employee_count"),
  "foundation.revenue": col("kb_foundation", "revenue"),
  "foundation.phone": col("kb_foundation", "phone"),
  "foundation.email": col("kb_foundation", "email"),
  "foundation.serviceLocations": col("kb_foundation", "service_locations"),
  "foundation.altNames": col("kb_foundation", "alt_names"),
  "foundation.mainAddress.formatted": col("addresses", "formatted"),
  "foundation.mainAddress.street": col("addresses", "street"),
  "foundation.mainAddress.city": col("addresses", "city"),
  "foundation.mainAddress.region": col("addresses", "region"),
  "foundation.mainAddress.postalCode": col("addresses", "postal_code"),
  "foundation.mainAddress.country": col("addresses", "country"),
  "foundation.otherLocations": elsewhere("the addresses table, kind = 'other'"),
  "foundation.otherLocations[].formatted": col("addresses", "formatted"),
  "foundation.otherLocations[].street": col("addresses", "street"),
  "foundation.otherLocations[].city": col("addresses", "city"),
  "foundation.otherLocations[].region": col("addresses", "region"),
  "foundation.otherLocations[].postalCode": col("addresses", "postal_code"),
  "foundation.otherLocations[].country": col("addresses", "country"),

  // ------------------------------------------------------- 2. positioning
  "positioning.pitch": col("kb_positioning", "pitch"),
  "positioning.foundingStory": col("kb_positioning", "founding_story"),

  // ------------------------------------------------------------ 3. market
  "market.buyers": col("kb_market", "buyers"),
  "market.customerNeeds": col("kb_market", "customer_needs"),
  "market.idealPersona": col("kb_market", "ideal_persona"),
  "market.industryGroupings": col("kb_market", "industry_groupings"),
  "market.industryOutlook": col("kb_market", "industry_outlook"),
  "market.channels": col("kb_market", "channels"),
  "market.funnels": col("kb_market", "funnels"),
  "market.ctas": col("kb_market", "ctas"),
  "market.suppliersPartners": col("kb_market", "suppliers_partners"),

  // ---------------------------------------------------------- 4. branding
  "branding.artStyle": col("kb_branding", "art_style"),
  "branding.fonts": col("kb_branding", "fonts"),
  "branding.writingStyle.description": col("kb_writing_style", "description"),
  "branding.writingStyle.tone": col("kb_writing_style", "tone"),
  "branding.writingStyle.formality": col("kb_writing_style", "formality"),
  "branding.writingStyle.readerAddress": col("kb_writing_style", "reader_address"),
  "branding.writingStyle.preferredTerms": col("kb_writing_style", "preferred_terms"),
  "branding.writingStyle.avoidTerms": col("kb_writing_style", "avoid_terms"),
  "branding.writingStyle.ctaStyle": col("kb_writing_style", "cta_style"),
  "branding.colors": elsewhere("the brand_colors table"),
  "branding.colors[].hex": rec("brand_colors", "hex"),
  "branding.colors[].role": rec("brand_colors", "role"),
  "branding.colors[].frequency": rec("brand_colors", "frequency"),
  "branding.logos": elsewhere("media_assets, slot = 'branding.logos'"),
  "branding.logos[].url": rec("media_assets", "url"),
  "branding.logos[].alt": rec("media_assets", "alt"),
  "branding.logos[].kind": rec("media_assets", "kind"),
  "branding.logos[].width": rec("media_assets", "width"),
  "branding.logos[].height": rec("media_assets", "height"),

  // --------------------------------------------------- 5. online presence
  "onlinePresence.profiles": elsewhere("the social_profiles table"),
  "onlinePresence.profiles[].platform": rec("social_profiles", "platform"),
  "onlinePresence.profiles[].url": rec("social_profiles", "url"),
  "onlinePresence.profiles[].handle": rec("social_profiles", "handle"),

  // -------------------------------------------------------- 6. key people
  people: elsewhere("the people table"),
  "people[].name": rec("people", "name"),
  "people[].title": rec("people", "title"),
  "people[].role": rec("people", "role"),
  "people[].gender": rec("people", "gender"),
  "people[].bio": rec("people", "bio"),
  "people[].email": rec("people", "email"),
  "people[].phone": rec("people", "phone"),
  "people[].imageUrl": rec("people", "image_url"),
  "people[].profileUrl": rec("people", "profile_url"),
  "people[].linkedin": rec("people", "linkedin"),

  // --------------------------------------------------------- 7. offerings
  offerings: elsewhere("the offerings table"),
  "offerings[].name": rec("offerings", "name"),
  "offerings[].category": rec("offerings", "category"),
  "offerings[].description": rec("offerings", "description"),
  "offerings[].features": rec("offerings", "features"),
  "offerings[].pricing": rec("offerings", "pricing"),
  "offerings[].url": rec("offerings", "url"),
  "offerings[].sourceCandidateIndexes": rec("offerings", "source_candidate_indexes"),

  // ------------------------------------------------------------- 8. proof
  "proof.testimonials": elsewhere("the testimonials table"),
  "proof.testimonials[].quote": rec("testimonials", "quote"),
  "proof.testimonials[].authorName": rec("testimonials", "author_name"),
  "proof.testimonials[].authorRole": rec("testimonials", "author_role"),
  "proof.testimonials[].authorCompany": rec("testimonials", "author_company"),
  "proof.testimonials[].authorLocation": rec("testimonials", "author_location"),
  "proof.testimonials[].rating": rec("testimonials", "rating"),
  "proof.testimonials[].date": rec("testimonials", "published_date"),
  "proof.testimonials[].platform": rec("testimonials", "platform"),
  "proof.testimonials[].mediaUrl": rec("testimonials", "media_url"),
  "proof.testimonials[].topics": rec("testimonials", "topics"),
  "proof.testimonials[].mentionsPeople": rec("testimonials", "mentions_people"),
  "proof.testimonials[].mentionsOfferings": rec("testimonials", "mentions_offerings"),

  "proof.aggregateRatings": elsewhere("the aggregate_ratings table"),
  "proof.aggregateRatings[].platform": rec("aggregate_ratings", "platform"),
  "proof.aggregateRatings[].ratingValue": rec("aggregate_ratings", "rating_value"),
  "proof.aggregateRatings[].bestRating": rec("aggregate_ratings", "best_rating"),
  "proof.aggregateRatings[].reviewCount": rec("aggregate_ratings", "review_count"),

  "proof.caseStudies": elsewhere("the case_studies table"),
  "proof.caseStudies[].title": rec("case_studies", "title"),
  "proof.caseStudies[].client": rec("case_studies", "client"),
  "proof.caseStudies[].problem": rec("case_studies", "problem"),
  "proof.caseStudies[].solution": rec("case_studies", "solution"),
  "proof.caseStudies[].results": rec("case_studies", "results"),
  "proof.caseStudies[].metrics": rec("case_studies", "metrics"),
  "proof.caseStudies[].url": rec("case_studies", "url"),

  "proof.certifications": elsewhere("credentials, slot = 'proof.certifications'"),
  "proof.certifications[].name": rec("credentials", "name"),
  "proof.certifications[].issuer": rec("credentials", "issuer"),
  "proof.certifications[].identifier": rec("credentials", "identifier"),
  "proof.certifications[].validUntil": rec("credentials", "valid_until"),
  "proof.certifications[].verifyUrl": rec("credentials", "verify_url"),
  "proof.certifications[].kind": rec("credentials", "kind"),
  "proof.memberships": elsewhere("credentials, slot = 'proof.memberships'"),
  "proof.memberships[].name": rec("credentials", "name"),
  "proof.memberships[].issuer": rec("credentials", "issuer"),
  "proof.memberships[].identifier": rec("credentials", "identifier"),
  "proof.memberships[].validUntil": rec("credentials", "valid_until"),
  "proof.memberships[].verifyUrl": rec("credentials", "verify_url"),
  "proof.memberships[].kind": rec("credentials", "kind"),

  "proof.awards": elsewhere("the awards table"),
  "proof.awards[].name": rec("awards", "name"),
  "proof.awards[].issuer": rec("awards", "issuer"),
  "proof.awards[].year": rec("awards", "year"),

  "proof.pressMentions": elsewhere("the press_mentions table"),
  "proof.pressMentions[].outlet": rec("press_mentions", "outlet"),
  "proof.pressMentions[].title": rec("press_mentions", "title"),
  "proof.pressMentions[].url": rec("press_mentions", "url"),
  "proof.pressMentions[].date": rec("press_mentions", "published_date"),
  "proof.pressMentions[].kind": rec("press_mentions", "kind"),

  "proof.trustStats": elsewhere("the trust_stats table"),
  "proof.trustStats[].claim": rec("trust_stats", "claim"),
  "proof.trustStats[].value": rec("trust_stats", "value"),
  "proof.trustStats[].unit": rec("trust_stats", "unit"),
  "proof.trustStats[].category": rec("trust_stats", "category"),
  "proof.trustStats[].asOfDate": rec("trust_stats", "as_of_date"),

  "proof.guarantees": elsewhere("the guarantees table"),
  "proof.guarantees[].text": rec("guarantees", "body"),
  "proof.guarantees[].kind": rec("guarantees", "kind"),
  "proof.guarantees[].terms": rec("guarantees", "terms"),

  "proof.clientLogos": elsewhere("media_assets, slot = 'proof.clientLogos'"),
  "proof.clientLogos[].url": rec("media_assets", "url"),
  "proof.clientLogos[].alt": rec("media_assets", "alt"),
  "proof.clientLogos[].kind": rec("media_assets", "kind"),
  "proof.clientLogos[].width": rec("media_assets", "width"),
  "proof.clientLogos[].height": rec("media_assets", "height"),

  // ------------------------------------------- 9. content intelligence
  "contentIntelligence.themes": elsewhere("the content_themes table"),
  "contentIntelligence.themes[].label": rec("content_themes", "label"),
  "contentIntelligence.themes[].weight": rec("content_themes", "weight"),
  "contentIntelligence.themes[].terms": rec("content_themes", "terms"),
  "contentIntelligence.themes[].exampleUrls": rec("content_themes", "example_urls"),

  "contentIntelligence.posts": elsewhere("the content_items table"),
  "contentIntelligence.posts[].title": rec("content_items", "title"),
  "contentIntelligence.posts[].url": rec("content_items", "url"),
  "contentIntelligence.posts[].publishedAt": rec("content_items", "published_at"),
  "contentIntelligence.posts[].author": rec("content_items", "author"),
  "contentIntelligence.posts[].category": rec("content_items", "category"),
  "contentIntelligence.posts[].excerpt": rec("content_items", "excerpt"),
  "contentIntelligence.posts[].wordCount": rec("content_items", "word_count"),
  "contentIntelligence.posts[].headings": rec("content_items", "headings"),

  "contentIntelligence.taxonomy.categories": col("kb_taxonomy", "categories"),
  "contentIntelligence.taxonomy.tags": col("kb_taxonomy", "tags"),

  "contentIntelligence.cadence.postsPerMonth": col("kb_cadence", "posts_per_month"),
  "contentIntelligence.cadence.firstPublished": col("kb_cadence", "first_published"),
  "contentIntelligence.cadence.lastPublished": col("kb_cadence", "last_published"),
  "contentIntelligence.cadence.daysSinceLast": col("kb_cadence", "days_since_last"),
  "contentIntelligence.cadence.isStale": col("kb_cadence", "is_stale"),

  "contentIntelligence.headlinePatterns": elsewhere("the headline_patterns table"),
  "contentIntelligence.headlinePatterns[].pattern": rec("headline_patterns", "pattern"),
  "contentIntelligence.headlinePatterns[].count": rec("headline_patterns", "count"),
  "contentIntelligence.headlinePatterns[].examples": rec("headline_patterns", "examples"),

  "contentIntelligence.faqs": elsewhere("the faqs table"),
  "contentIntelligence.faqs[].question": rec("faqs", "question"),
  "contentIntelligence.faqs[].answer": rec("faqs", "answer"),
  "contentIntelligence.faqs[].topic": rec("faqs", "topic"),

  "contentIntelligence.glossary": elsewhere("the glossary_terms table"),
  "contentIntelligence.glossary[].term": rec("glossary_terms", "term"),
  "contentIntelligence.glossary[].definition": rec("glossary_terms", "definition"),

  "contentIntelligence.seasonalSignals": elsewhere("the seasonal_signals table"),
  "contentIntelligence.seasonalSignals[].label": rec("seasonal_signals", "label"),
  "contentIntelligence.seasonalSignals[].period": rec("seasonal_signals", "period"),
  "contentIntelligence.seasonalSignals[].text": rec("seasonal_signals", "body"),

  "contentIntelligence.contentGaps": elsewhere("the content_gaps table"),
  "contentIntelligence.contentGaps[].topic": rec("content_gaps", "topic"),
  "contentIntelligence.contentGaps[].reason": rec("content_gaps", "reason"),
  "contentIntelligence.contentGaps[].relatedOffering": rec("content_gaps", "related_offering"),

  // ---------------------------------------------------------- 10. quality
  //
  // Computed about the knowledge base rather than extracted from the site, so
  // no Sourced<T> envelope and no field_provenance rows.
  "quality.overallScore": col("knowledge_base_versions", "completeness"),
  "quality.missingFields": col("knowledge_base_versions", "missing_fields"),

  "quality.categoryScores": elsewhere("the quality_category_scores table"),
  "quality.categoryScores[].category": col("quality_category_scores", "category"),
  "quality.categoryScores[].score": col("quality_category_scores", "score"),
  "quality.categoryScores[].filledFields": col("quality_category_scores", "filled_fields"),
  "quality.categoryScores[].totalFields": col("quality_category_scores", "total_fields"),
  "quality.categoryScores[].needsAttention": col("quality_category_scores", "needs_attention"),

  "quality.conflicts": elsewhere("the quality_conflicts table"),
  "quality.conflicts[].path": col("quality_conflicts", "path"),
  "quality.conflicts[].label": col("quality_conflicts", "label"),
  "quality.conflicts[].resolved": col("quality_conflicts", "resolved"),
  "quality.conflicts[].candidates": elsewhere("the quality_conflict_candidates table"),
  "quality.conflicts[].candidates[].value": col("quality_conflict_candidates", "value"),
  "quality.conflicts[].candidates[].sourceUrl": col("quality_conflict_candidates", "source_url"),
  "quality.conflicts[].candidates[].sourceLabel": col("quality_conflict_candidates", "source_label"),
  "quality.conflicts[].candidates[].confidence": col("quality_conflict_candidates", "confidence"),

  "quality.followUpQuestions": elsewhere("the quality_follow_up_questions table"),
  "quality.followUpQuestions[].id": col("quality_follow_up_questions", "id"),
  "quality.followUpQuestions[].question": col("quality_follow_up_questions", "question"),
  "quality.followUpQuestions[].example": col("quality_follow_up_questions", "example"),
  "quality.followUpQuestions[].fills": col("quality_follow_up_questions", "fills"),
  "quality.followUpQuestions[].priority": col("quality_follow_up_questions", "priority"),
  "quality.followUpQuestions[].answered": col("quality_follow_up_questions", "answered"),
};
