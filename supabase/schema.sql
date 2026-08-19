-- MoKnowledge — Supabase / PostgreSQL schema (R20, R27)
--
-- The bonus challenge asks for four things. This file and docs/DATABASE.md answer
-- them in order:
--
--   1. Table schemas with column types      — §1–§11 below
--   2. Relationships between tables         — §12, and every `references` clause
--   3. RLS policy considerations            — §13
--   4. Multiple companies and versioning    — §2 (organizations → companies) and
--                                             §3 (immutable knowledge_base_versions)
--
-- Applied to a live Supabase project (PostgreSQL 17.6) and verified there by
-- `npm run db:check` (scripts/check-db.ts), which asserts behaviour, and by
-- `npm run db:parity` (scripts/check-schema-parity.ts), which walks the zod
-- schema in lib/schema/ and fails if any field lacks a column.
--
-- THE GOVERNING RULE: this schema mirrors lib/schema/ exactly.
--
--   every zod enum          -> a PostgreSQL enum type
--   every array of objects  -> a table, one row per record
--   every 1:1 object        -> a table, one row per version
--   every array of scalars  -> a typed array column
--   every scalar            -> a typed column
--
-- Nothing that the knowledge base standard names lives only inside jsonb. The
-- earlier draft of this file normalized four of the nine categories and left
-- foundation, positioning, market, branding and content intelligence inside the
-- document; that is why `npm run db:parity` exists, so the gap cannot reopen
-- silently.
--
-- `knowledge_base_versions.document` is still here, and is still the source of
-- truth. It is the byte-for-byte record of what the app produced, which is what
-- makes the normalized tables safe: they are a PROJECTION, and dropping every
-- row in them and rebuilding from `document` is always correct. Nothing is only
-- in a projection. See docs/DATABASE.md §3 for the full argument.
--
-- Requires PostgreSQL 15 or later (for `security_invoker` views) and the `auth`
-- schema Supabase provides.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- fuzzy company and record search

-- ============================================================================
-- §1  ENUM TYPES
-- ============================================================================
--
-- Mirrored one-for-one from lib/schema/. Postgres enums rather than check
-- constraints because these vocabularies are deliberately closed — the whole
-- point of offering_category is that `Service` and `Business Services` cannot
-- both exist (prompts/02-offering-normalization.md). Adding a value is
-- `alter type ... add value`, which is exactly the friction we want.
--
-- `npm run db:parity` compares every one of these against its zod enum, because
-- a missing value is silent until the day a scrape produces it and the insert
-- fails. That is not hypothetical: offering_category shipped with five of its
-- eight values, so any offering classified `consultation`, `financing` or
-- `industry-solution` would have been rejected at save time.

-- lib/schema/sourced.ts
create type extraction_method as enum (
  'scraped', 'derived', 'ai-live', 'ai-mock', 'user-edited', 'not-found'
);

-- lib/schema/knowledge-base.ts
create type company_role as enum (
  'manufacturer', 'distributor', 'retailer', 'service-provider', 'contractor',
  'agency', 'broker', 'consultancy', 'software-vendor', 'nonprofit', 'other'
);

create type business_model as enum ('b2b', 'b2c', 'b2b2c', 'b2g', 'marketplace', 'mixed');

create type category_id as enum (
  'foundation', 'positioning', 'market', 'branding', 'onlinePresence',
  'people', 'offerings', 'proof', 'contentIntelligence'
);

create type page_role as enum (
  'home', 'about', 'services', 'products', 'pricing', 'contact', 'team',
  'testimonials', 'faq', 'blog-index', 'blog-post', 'legal', 'other'
);

create type warning_code as enum (
  'js-rendered', 'widget-detected', 'robots-disallow', 'budget-exceeded',
  'fetch-failed', 'non-html', 'empty-body', 'redirect-offsite', 'bot-challenge'
);

-- lib/schema/entities.ts
create type person_role as enum ('owner', 'executive', 'manager', 'staff', 'advisor', 'unknown');

create type gender as enum ('male', 'female', 'unknown');

create type offering_category as enum (
  'product', 'service', 'package', 'subscription', 'consultation',
  'financing', 'industry-solution', 'other'
);

create type credential_kind as enum ('license', 'certification', 'membership', 'accreditation');

create type press_mention_kind as enum ('feature', 'quote', 'listing');

create type trust_stat_category as enum (
  'years-in-business', 'customers-served', 'projects-completed',
  'volume-transacted', 'team-size', 'response-time', 'other'
);

create type guarantee_kind as enum (
  'warranty', 'satisfaction', 'licensing', 'insurance', 'bonding'
);

create type headline_pattern_kind as enum (
  'how-to', 'listicle', 'question', 'comparison', 'local-service',
  'seasonal', 'announcement', 'other'
);

create type tone as enum (
  'authoritative', 'warm', 'professional', 'conversational', 'technical',
  'reassuring', 'urgent', 'aspirational', 'educational', 'direct',
  'playful', 'formal'
);

create type formality as enum ('casual', 'neutral', 'formal');

create type reader_address as enum ('second-person', 'third-person', 'mixed');

create type social_platform as enum (
  'linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok',
  'pinterest', 'yelp', 'google-business', 'other'
);

-- lib/schema/primitives.ts
create type media_kind as enum ('logo', 'client-logo', 'badge', 'photo', 'icon', 'other');

create type color_role as enum (
  'background', 'surface', 'text', 'primary', 'secondary', 'accent',
  'border', 'unknown'
);

-- Two categories hold arrays of the same record type, so the row has to record
-- which one it came from or the document cannot be rebuilt exactly.
create type media_slot as enum ('branding.logos', 'proof.clientLogos');
create type credential_slot as enum ('proof.certifications', 'proof.memberships');
create type address_kind as enum ('main', 'other');

-- Operational, not from the document.
create type scrape_status as enum ('queued', 'crawling', 'extracting', 'enriching', 'done', 'failed');
create type member_role as enum ('owner', 'admin', 'editor', 'viewer');

-- ============================================================================
-- §2  TENANCY AND MULTI-COMPANY  (bonus requirement 4, first half)
-- ============================================================================
--
-- An agency running knowledge bases for forty clients is forty `companies` rows
-- under one `organizations` row. That is the whole of multi-company support:
-- the tenant is the account, the company is the client business, and a knowledge
-- base belongs to a company.

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now()
);

-- The join RLS leans on. Kept deliberately narrow: one row per (user, org), so
-- the policy predicate is a single index lookup rather than a subquery over
-- anything that grows with the data.
create table organization_members (
  organization_id  uuid not null references organizations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             member_role not null default 'editor',
  created_at       timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_idx on organization_members (user_id);

-- `domain` is the natural key: two people submitting https://example.com/ and
-- https://www.example.com/about must land on the same company rather than
-- creating a duplicate, which is the mistake that makes a multi-company library
-- useless by month three. The app normalizes to a registrable domain before
-- insert, the same normalization lib/utils/url.ts already does.
--
-- Uniqueness is scoped to the organization, not global: two agencies may both
-- track the same client, and neither should see the other's knowledge base.
create table companies (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  name             text not null,
  domain           text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, domain)
);

create index companies_org_idx on companies (organization_id);
create index companies_name_trgm_idx on companies using gin (name gin_trgm_ops);

-- ============================================================================
-- §3  KNOWLEDGE BASES AND VERSIONING  (bonus requirement 4, second half)
-- ============================================================================
--
-- `knowledge_bases` is the stable identity a URL points at. It holds no content:
-- it holds `current_version_id`, and every save inserts a new version row and
-- moves that pointer.
--
-- `id` is TEXT, not uuid, because it is the document's own `id` (zod:
-- `id: z.string()`) and must round-trip exactly. The shipped examples use ids
-- like `example-account-it`; a uuid column would reject the project's own
-- example corpus.

create table knowledge_bases (
  id                  text primary key,
  organization_id     uuid not null references organizations (id) on delete cascade,
  company_id          uuid not null references companies (id) on delete cascade,
  source_url          text not null,
  current_version_id  uuid,          -- FK added after versions exists (circular)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index knowledge_bases_org_idx on knowledge_bases (organization_id);
create index knowledge_bases_company_idx on knowledge_bases (company_id);

-- `organization_id` is denormalized onto this table and every table below it.
-- It is derivable by joining up to companies, but RLS runs on every row of every
-- query: carrying the tenant key locally turns each policy into one index lookup
-- instead of a join chain. The trigger in §14 keeps it honest so it cannot drift
-- from the parent.

-- Immutable snapshots. `document` is the full KnowledgeBase as the app's zod
-- schema produces it — the same JSON shape as examples/*.json — and every
-- normalized table below is a projection of it.
create table knowledge_base_versions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  knowledge_base_id  text not null references knowledge_bases (id) on delete cascade,
  version_no         integer not null check (version_no >= 1),
  document           jsonb not null,

  -- KnowledgeBase scalars that are not part of a category.
  company_name       text,            -- companyName.value; provenance in field_provenance
  source_url         text not null,
  document_created_at timestamptz,    -- the document's own createdAt/updatedAt,
  document_updated_at timestamptz,    -- distinct from this row's created_at

  -- quality.overallScore and quality.missingFields. The rest of the quality
  -- category is normalized in §10.
  completeness       numeric(4, 3) check (completeness between 0 and 1),
  missing_fields     text[] not null default '{}',

  -- Denormalized counters, because the library grid sorts and filters on them
  -- and must not deserialize 90KB per card to render a list.
  attention_count    integer not null default 0,
  conflict_count     integer not null default 0,
  -- KnowledgeBaseSummary.keywords: alt names, areas served, and the first dozen
  -- offering and people names. This is what library search matches.
  keywords           text[] not null default '{}',

  -- True when this version came from re-scraping rather than a human edit.
  rescraped          boolean not null default false,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (knowledge_base_id, version_no)
);

create index kb_versions_kb_idx on knowledge_base_versions (knowledge_base_id, version_no desc);
create index kb_versions_org_idx on knowledge_base_versions (organization_id);
create index kb_versions_keywords_idx on knowledge_base_versions using gin (keywords);
-- Ad-hoc questions against the document without a schema change:
--   where document -> 'foundation' -> 'yearFounded' ->> 'value' is null
create index kb_versions_document_idx on knowledge_base_versions using gin (document jsonb_path_ops);

alter table knowledge_bases
  add constraint knowledge_bases_current_version_fk
  foreign key (current_version_id) references knowledge_base_versions (id) on delete set null;

-- No update or delete policy is ever granted on this table (see §13).
-- A version is a record of what a business said about itself on a date; the way
-- to change it is to write the next one.
--
-- "Append-only" means a version cannot be rewritten or removed on its own. It
-- does not mean the row outlives its parents: deleting a knowledge base, a
-- company or a whole organization has to take its versions with it, or the
-- adapter's `remove(id)` — which relies on `on delete cascade` — can never
-- succeed, and the tenant's rows become undeletable.
--
-- A cascade is distinguishable from a direct delete without any trigger-depth
-- guesswork: PostgreSQL deletes the parent row first and then applies the
-- referential action, so by the time this fires for a cascade, the parent is
-- already gone. Both cascade paths reach this table (via knowledge_bases and
-- directly via organizations), so both parents are checked.
create or replace function forbid_version_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE'
     and (not exists (select 1 from knowledge_bases where id = old.knowledge_base_id)
          or not exists (select 1 from organizations where id = old.organization_id))
  then
    return old;   -- the parent is being deleted; this row goes with it
  end if;

  raise exception 'knowledge_base_versions is append-only (attempted % on %)', tg_op, old.id;
end;
$$;

create trigger kb_versions_immutable
  before update or delete on knowledge_base_versions
  for each row execute function forbid_version_mutation();

-- Allocates the next version number under a lock, so two people saving the same
-- knowledge base at once get v4 and v5 rather than a unique-violation race.
create or replace function next_version_no(kb text) returns integer
language plpgsql as $$
declare
  next_no integer;
begin
  perform 1 from knowledge_bases where id = kb for update;
  select coalesce(max(version_no), 0) + 1 into next_no
    from knowledge_base_versions where knowledge_base_id = kb;
  return next_no;
end;
$$;

-- ============================================================================
-- §4  THE PROJECTION CONVENTION
-- ============================================================================
--
-- Everything from here to §11 is written from `document` when a version is
-- inserted, in the same transaction, by the adapter. These tables are a cache
-- with a one-directional dependency: truncating all of them and rebuilding from
-- `knowledge_base_versions.document` is always correct.
--
-- They are scoped to `version_id`, never to `knowledge_base_id`, so "who was on
-- the team in v3" stays answerable and a re-scrape appends rather than
-- overwrites.
--
-- Two shapes recur:
--
--   A 1:1 CATEGORY TABLE holds the scalar fields of one category, keyed by
--   version_id. The `Sourced<T>` envelope around each scalar (method,
--   confidence, sourceUrls, note) is NOT repeated here as four columns per
--   field — it lives in `field_provenance` (§11), one row per field, keyed by
--   the same dot path the app uses. Fifty-five fields would otherwise mean two
--   hundred and twenty columns of envelope.
--
--   A RECORD TABLE holds one row per item of a `Sourced<T[]>` collection and
--   carries `RecordProvenance` inline (lib/schema/primitives.ts), because for
--   collections provenance is per record, not per field. Every one of them has:
--
--     id           text     the record's own id from the document
--     version_id   uuid     the version it belongs to
--     method/confidence/source_urls/note    the RecordProvenance envelope
--     position     integer  preserves document order
--     primary key (version_id, id)
--
--   The primary key is COMPOSITE for a reason: a record id is stable within a
--   knowledge base, not globally. Person `account-it-0051` appears in v1 and
--   again in v2 of the same document, so `id` alone as a primary key makes the
--   second save of an edited knowledge base fail on a duplicate key — which
--   would break versioning, the thing this schema exists to support.
--
--   `id` is text, not uuid, for the same reason as knowledge_bases.id: the
--   document says `id: z.string()` and the shipped examples are not uuids.
--
-- The collection-level envelope (`Sourced<T[]>`'s own method/confidence/note,
-- which carries states like "a review widget was detected but its content is
-- JS-rendered") is a field_provenance row at the collection's path, e.g.
-- `proof.testimonials`. It is not lost just because the records are rows.

-- ============================================================================
-- §5  CATEGORY 1 — COMPANY FOUNDATION
-- ============================================================================

create table kb_foundation (
  version_id         uuid primary key references knowledge_base_versions (id) on delete cascade,
  organization_id    uuid not null references organizations (id) on delete cascade,
  overview           text,
  website            text,
  industry           text,
  business_model     business_model,
  company_role       company_role,
  year_founded       integer check (year_founded between 1600 and 2100),
  legal_entity_type  text,
  employee_count     integer check (employee_count >= 0),
  -- Verbatim as published ("$5M–$10M"); never estimated, so never numeric.
  revenue            text,
  phone              text,
  email              text,
  -- Arrays of scalars stay arrays: these are `Sourced<string[]>` in zod, and a
  -- child table would invent an identity and an order the document never had.
  service_locations  text[] not null default '{}',
  alt_names          text[] not null default '{}'
);

create index kb_foundation_org_idx on kb_foundation (organization_id);
create index kb_foundation_industry_idx on kb_foundation (organization_id, industry);
create index kb_foundation_alt_names_idx on kb_foundation using gin (alt_names);

-- `mainAddress` and `otherLocations[]` are the same shape, so they are one table
-- discriminated by `kind` rather than a one-row table plus a many-row table.
-- `formatted` is the line a human reads and edits; the parts are populated when
-- JSON-LD PostalAddress supplies them and stay null when the address came from a
-- footer regex (lib/schema/primitives.ts).
create table addresses (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  kind             address_kind not null,
  formatted        text not null,
  street           text,
  city             text,
  region           text,
  postal_code      text,
  country          text,
  position         integer not null,
  -- One main address per version; the others are ordered.
  unique (version_id, kind, position)
);

create index addresses_version_idx on addresses (version_id);
create index addresses_org_idx on addresses (organization_id);
create index addresses_city_idx on addresses (organization_id, region, city);

-- ============================================================================
-- §6  CATEGORY 2 — POSITIONING
-- ============================================================================

create table kb_positioning (
  version_id       uuid primary key references knowledge_base_versions (id) on delete cascade,
  organization_id  uuid not null references organizations (id) on delete cascade,
  -- One-paragraph elevator pitch in the company's own voice. Usually AI-written,
  -- which is why its field_provenance row matters more than most.
  pitch            text,
  founding_story   text
);

create index kb_positioning_org_idx on kb_positioning (organization_id);

-- ============================================================================
-- §7  CATEGORY 3 — MARKET & CUSTOMERS
-- ============================================================================

create table kb_market (
  version_id          uuid primary key references knowledge_base_versions (id) on delete cascade,
  organization_id     uuid not null references organizations (id) on delete cascade,
  buyers              text[] not null default '{}',
  customer_needs      text,
  ideal_persona       text,
  industry_groupings  text[] not null default '{}',
  industry_outlook    text,
  -- Where they reach customers: organic search, referral, trade shows…
  channels            text[] not null default '{}',
  -- Conversion paths present on the site: quote form, phone, booking widget…
  funnels             text[] not null default '{}',
  -- Call-to-action copy found on the site, verbatim. MoMail and MoSocial both
  -- condition on this, so it is indexed rather than buried.
  ctas                text[] not null default '{}',
  -- Third-party vendors fingerprinted from script/iframe hosts.
  suppliers_partners  text[] not null default '{}'
);

create index kb_market_org_idx on kb_market (organization_id);
create index kb_market_groupings_idx on kb_market using gin (industry_groupings);
create index kb_market_buyers_idx on kb_market using gin (buyers);

-- ============================================================================
-- §8  CATEGORY 4 — BRANDING & STYLE
-- ============================================================================

create table kb_branding (
  version_id       uuid primary key references knowledge_base_versions (id) on delete cascade,
  organization_id  uuid not null references organizations (id) on delete cascade,
  art_style        text,
  fonts            text[] not null default '{}'
);

create index kb_branding_org_idx on kb_branding (organization_id);

-- Its own table rather than columns on kb_branding: this is the record every
-- generation app reads before writing a word, and it is structured rather than
-- prose precisely so MoSocial/MoMail/MoBlogs can condition on it
-- programmatically (prompts/03-writing-style.md).
create table kb_writing_style (
  version_id       uuid primary key references knowledge_base_versions (id) on delete cascade,
  organization_id  uuid not null references organizations (id) on delete cascade,
  description      text,
  tone             tone[] not null default '{}',
  formality        formality,
  reader_address   reader_address,
  preferred_terms  text[] not null default '{}',
  avoid_terms      text[] not null default '{}',
  cta_style        text
);

create index kb_writing_style_org_idx on kb_writing_style (organization_id);
create index kb_writing_style_tone_idx on kb_writing_style using gin (tone);

-- A colour with the role it plays, rather than a bare hex list: a content
-- generator needs to know which one is the background and which is the accent.
create table brand_colors (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  hex              text not null check (hex ~ '^#[0-9a-f]{6}$'),
  role             color_role not null,
  -- Weighted occurrence count across the crawled CSS and inline styles.
  frequency        integer not null check (frequency >= 0),
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index brand_colors_version_idx on brand_colors (version_id);
create index brand_colors_org_idx on brand_colors (organization_id);

-- `branding.logos` and `proof.clientLogos` are both MediaRef[]. One table, with
-- `slot` recording which array the row came from so the document rebuilds
-- exactly. `kind` is the media's own classification and is not redundant with
-- `slot`: a client logo row is slot='proof.clientLogos', kind='client-logo',
-- but a badge can appear in either.
create table media_assets (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  slot             media_slot not null,
  url              text not null,
  alt              text,
  kind             media_kind not null,
  width            integer check (width > 0),
  height           integer check (height > 0),
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index media_assets_version_idx on media_assets (version_id, slot);
create index media_assets_org_idx on media_assets (organization_id);

-- ============================================================================
-- §9  CATEGORY 5 — ONLINE PRESENCE, 6 — KEY PEOPLE, 7 — OFFERINGS
-- ============================================================================

create table social_profiles (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  platform         social_platform not null,
  url              text not null,
  handle           text,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index social_profiles_version_idx on social_profiles (version_id);
create index social_profiles_org_idx on social_profiles (organization_id);
create index social_profiles_platform_idx on social_profiles (organization_id, platform);

create table people (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  name             text not null,
  title            text,
  role             person_role,
  -- Always an inference from name and pronouns, never a claim: it ships at low
  -- confidence and lands in the review tier so a human confirms it.
  gender           gender,
  bio              text,
  email            text,
  phone            text,
  image_url        text,
  profile_url      text,
  linkedin         text,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index people_version_idx on people (version_id);
create index people_org_idx on people (organization_id);
create index people_name_trgm_idx on people using gin (name gin_trgm_ops);
create index people_role_idx on people (organization_id, role);

create table offerings (
  id                        text not null,
  organization_id           uuid not null references organizations (id) on delete cascade,
  version_id                uuid not null references knowledge_base_versions (id) on delete cascade,
  name                      text not null,
  category                  offering_category,
  description               text,
  features                  text[] not null default '{}',
  -- Verbatim as published ("starting at $250"), never parsed into a number:
  -- the qualifier is the part a salesperson needs.
  pricing                   text,
  url                       text,
  -- Indexes into the extractor's candidate list that were merged to produce this
  -- offering, so a consolidation stays auditable ("merged from 4 mentions").
  source_candidate_indexes  integer[] not null default '{}',
  method                    extraction_method not null,
  confidence                numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls               text[] not null default '{}',
  note                      text,
  position                  integer not null,
  primary key (version_id, id)
);

create index offerings_version_idx on offerings (version_id);
create index offerings_org_idx on offerings (organization_id);
-- "Which of our clients offer emergency service" — the cross-tenant question the
-- projections exist for.
create index offerings_category_idx on offerings (organization_id, category);
create index offerings_name_trgm_idx on offerings using gin (name gin_trgm_ops);
create index offerings_features_idx on offerings using gin (features);

-- ============================================================================
-- §10  CATEGORY 8 — PROOF & CREDIBILITY
-- ============================================================================

create table testimonials (
  id                  text not null,
  organization_id     uuid not null references organizations (id) on delete cascade,
  version_id          uuid not null references knowledge_base_versions (id) on delete cascade,
  quote               text not null,
  author_name         text,
  author_role         text,
  author_company      text,
  author_location     text,
  rating              numeric(2, 1) check (rating between 0 and 5),
  -- Text, not date: sites publish "March 2024" and "2 weeks ago", and coercing
  -- those to a date would invent a precision the page never had.
  published_date      text,
  platform            text,
  media_url           text,
  topics              text[] not null default '{}',
  -- Same-version record references. No FK: these are ids inside the document,
  -- and a testimonial may name a person the people extractor never found.
  -- A dangling reference here is information, not corruption.
  mentions_people     text[] not null default '{}',
  mentions_offerings  text[] not null default '{}',
  method              extraction_method not null,
  confidence          numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls         text[] not null default '{}',
  note                text,
  position            integer not null,
  primary key (version_id, id)
);

create index testimonials_version_idx on testimonials (version_id);
create index testimonials_org_idx on testimonials (organization_id);
create index testimonials_topics_idx on testimonials using gin (topics);

create table aggregate_ratings (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  platform         text not null,
  rating_value     numeric not null,
  best_rating      numeric,
  review_count     integer check (review_count >= 0),
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index aggregate_ratings_version_idx on aggregate_ratings (version_id);
create index aggregate_ratings_org_idx on aggregate_ratings (organization_id);

create table case_studies (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  title            text not null,
  client           text,
  problem          text,
  solution         text,
  results          text[] not null default '{}',
  metrics          text[] not null default '{}',
  url              text,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index case_studies_version_idx on case_studies (version_id);
create index case_studies_org_idx on case_studies (organization_id);

-- `proof.certifications` and `proof.memberships` are both Credential[]; `slot`
-- records which array the row belongs to, `kind` is the credential's own type.
-- They disagree more often than you would expect — a trade body membership is
-- routinely listed under certifications on a site — so collapsing them into one
-- column would lose what the page actually claimed.
create table credentials (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  slot             credential_slot not null,
  name             text not null,
  issuer           text,
  identifier       text,
  valid_until      text,
  verify_url       text,
  kind             credential_kind not null,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index credentials_version_idx on credentials (version_id, slot);
create index credentials_org_idx on credentials (organization_id);

create table awards (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  name             text not null,
  issuer           text,
  year             integer,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index awards_version_idx on awards (version_id);
create index awards_org_idx on awards (organization_id);

create table press_mentions (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  outlet           text not null,
  title            text,
  url              text,
  published_date   text,
  kind             press_mention_kind not null,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index press_mentions_version_idx on press_mentions (version_id);
create index press_mentions_org_idx on press_mentions (organization_id);

-- The claim as written ("over 40 years", "$8.5B in sales") plus the parsed parts,
-- because the copy is what a generator quotes and the number is what it sorts on.
create table trust_stats (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  claim            text not null,
  value            numeric,
  unit             text,
  category         trust_stat_category not null,
  as_of_date       text,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index trust_stats_version_idx on trust_stats (version_id);
create index trust_stats_org_idx on trust_stats (organization_id, category);

create table guarantees (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  body             text not null,     -- zod: `text`, renamed to avoid the type name
  kind             guarantee_kind not null,
  terms            text,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index guarantees_version_idx on guarantees (version_id);
create index guarantees_org_idx on guarantees (organization_id);

-- ============================================================================
-- §11  CATEGORY 9 — CONTENT INTELLIGENCE
-- ============================================================================
--
-- This category is the one that most directly answers "Think Bigger" in the
-- assignment: it is what MoBlogs reads to decide what to write about, what
-- MoSocial reads to stay on theme, and what MoMail reads for cadence.

create table content_themes (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  label            text not null,
  -- 0–1, relative prominence across the crawled corpus.
  weight           numeric(4, 3) not null check (weight between 0 and 1),
  terms            text[] not null default '{}',
  example_urls     text[] not null default '{}',
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index content_themes_version_idx on content_themes (version_id);
create index content_themes_org_idx on content_themes (organization_id);
create index content_themes_terms_idx on content_themes using gin (terms);

create table content_items (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  title            text not null,
  url              text not null,
  published_at     text,
  author           text,
  category         text,
  excerpt          text,
  word_count       integer check (word_count >= 0),
  headings         text[] not null default '{}',
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index content_items_version_idx on content_items (version_id);
create index content_items_org_idx on content_items (organization_id);

create table kb_taxonomy (
  version_id       uuid primary key references knowledge_base_versions (id) on delete cascade,
  organization_id  uuid not null references organizations (id) on delete cascade,
  categories       text[] not null default '{}',
  tags             text[] not null default '{}'
);

create index kb_taxonomy_org_idx on kb_taxonomy (organization_id);
create index kb_taxonomy_tags_idx on kb_taxonomy using gin (tags);

create table kb_cadence (
  version_id        uuid primary key references knowledge_base_versions (id) on delete cascade,
  organization_id   uuid not null references organizations (id) on delete cascade,
  posts_per_month   numeric check (posts_per_month >= 0),
  first_published   text,
  last_published    text,
  days_since_last   integer check (days_since_last >= 0),
  -- >90 days since the last post. A direct MoBlogs sales trigger, which is why
  -- it is a stored boolean and indexed rather than recomputed per query.
  is_stale          boolean not null default false
);

create index kb_cadence_org_idx on kb_cadence (organization_id);
create index kb_cadence_stale_idx on kb_cadence (organization_id) where is_stale;

create table headline_patterns (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  pattern          headline_pattern_kind not null,
  count            integer not null check (count >= 0),
  examples         text[] not null default '{}',
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index headline_patterns_version_idx on headline_patterns (version_id);
create index headline_patterns_org_idx on headline_patterns (organization_id);

create table faqs (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  question         text not null,
  answer           text not null,
  topic            text,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index faqs_version_idx on faqs (version_id);
create index faqs_org_idx on faqs (organization_id);
create index faqs_question_trgm_idx on faqs using gin (question gin_trgm_ops);

create table glossary_terms (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  term             text not null,
  definition       text not null,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index glossary_terms_version_idx on glossary_terms (version_id);
create index glossary_terms_org_idx on glossary_terms (organization_id);

create table seasonal_signals (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  label            text not null,
  period           text,
  body             text,             -- zod: `text`, renamed to avoid the type name
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null,
  primary key (version_id, id)
);

create index seasonal_signals_version_idx on seasonal_signals (version_id);
create index seasonal_signals_org_idx on seasonal_signals (organization_id);

create table content_gaps (
  id                text not null,
  organization_id   uuid not null references organizations (id) on delete cascade,
  version_id        uuid not null references knowledge_base_versions (id) on delete cascade,
  topic             text not null,
  reason            text not null,
  -- `offerings[].id` within the same version. No FK, same reasoning as
  -- testimonials.mentions_*: the reference may point at a record that a later
  -- extraction no longer produces.
  related_offering  text,
  method            extraction_method not null,
  confidence        numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls       text[] not null default '{}',
  note              text,
  position          integer not null,
  primary key (version_id, id)
);

create index content_gaps_version_idx on content_gaps (version_id);
create index content_gaps_org_idx on content_gaps (organization_id);

-- ============================================================================
-- §12  QUALITY AND SCRAPE METADATA
-- ============================================================================
--
-- The quality category is computed ABOUT the knowledge base rather than
-- extracted from the website, so it carries no `Sourced<T>` envelope and has no
-- field_provenance rows. `overallScore` and `missingFields` live on the version
-- row (§3) because the library grid reads them; the rest is here.

create table quality_category_scores (
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  organization_id  uuid not null references organizations (id) on delete cascade,
  category         category_id not null,
  score            numeric(4, 3) not null check (score between 0 and 1),
  filled_fields    integer not null check (filled_fields >= 0),
  total_fields     integer not null check (total_fields >= 0),
  needs_attention  integer not null check (needs_attention >= 0),
  primary key (version_id, category)
);

create index quality_category_scores_org_idx on quality_category_scores (organization_id, category);

-- A conflict has no `id` in the document — it is identified by the field it is
-- about, and there is at most one conflict per field. `path` is therefore the
-- natural key, and inventing a surrogate id would be a column the document
-- cannot round-trip.
create table quality_conflicts (
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  -- The dot path of the contested field, e.g. `foundation.phone`.
  path             text not null,
  label            text not null,
  resolved         boolean not null default false,
  position         integer not null,
  primary key (version_id, path)
);

create index quality_conflicts_version_idx on quality_conflicts (version_id);
-- The library's conflict filter, and the only query that runs across tenants.
create index quality_conflicts_open_idx on quality_conflicts (organization_id)
  where not resolved;

-- Candidates are a child of a conflict rather than a jsonb array on it, because
-- "which source won, and what did we reject" is the audit question conflict
-- resolution exists to answer.
create table quality_conflict_candidates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  conflict_path    text not null,
  -- `z.unknown()` in the schema: a candidate value may be a string, a number, or
  -- an address object, so jsonb is the honest column type rather than a dodge.
  value            jsonb,
  source_url       text not null,
  -- Plain-language origin for the radio label: "on the Contact page".
  source_label     text not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  -- Highest-precedence candidate first; the UI pre-selects position 0.
  position         integer not null,
  foreign key (version_id, conflict_path)
    references quality_conflicts (version_id, path) on delete cascade
);

create index quality_conflict_candidates_conflict_idx
  on quality_conflict_candidates (version_id, conflict_path, position);
create index quality_conflict_candidates_org_idx on quality_conflict_candidates (organization_id);

create table quality_follow_up_questions (
  id               text not null,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  -- Plain language, never the field name: "What year did you start?"
  question         text not null,
  example          text,
  -- Field paths this answer fills. More than one when questions are grouped.
  fills            text[] not null default '{}',
  -- (impact × substitutabilityPenalty) / answerCost — docs/DATA-QUALITY.md §6.
  priority         numeric not null,
  answered         boolean not null default false,
  position         integer not null,
  primary key (version_id, id)
);

create index quality_follow_up_questions_version_idx on quality_follow_up_questions (version_id);
create index quality_follow_up_questions_org_idx on quality_follow_up_questions (organization_id);

-- The document's own `scrape` block: what the crawl did, stored with the version
-- it produced. Distinct from `scrape_jobs` (§13), which is operational telemetry
-- about attempts, including the ones that produced no version at all.
create table kb_scrape_metadata (
  version_id        uuid primary key references knowledge_base_versions (id) on delete cascade,
  organization_id   uuid not null references organizations (id) on delete cascade,
  started_at        timestamptz not null,
  finished_at       timestamptz not null,
  duration_ms       integer not null check (duration_ms >= 0),
  pages_discovered  integer not null check (pages_discovered >= 0),
  robots_respected  boolean not null,
  -- Bumped when extraction logic changes, so old saves stay interpretable.
  scraper_version   text not null
);

create index kb_scrape_metadata_org_idx on kb_scrape_metadata (organization_id);

create table scrape_pages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  url              text not null,
  role             page_role not null,
  status           integer not null,
  bytes            integer not null check (bytes >= 0),
  fetched_at       timestamptz not null,
  position         integer not null,
  unique (version_id, position)
);

create index scrape_pages_version_idx on scrape_pages (version_id);
create index scrape_pages_org_idx on scrape_pages (organization_id);
create index scrape_pages_role_idx on scrape_pages (organization_id, role);

create table scrape_warnings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  code             warning_code not null,
  -- Already written for the user; the UI renders it verbatim.
  message          text not null,
  url              text,
  position         integer not null,
  unique (version_id, position)
);

create index scrape_warnings_version_idx on scrape_warnings (version_id);
-- "Which of our clients' sites are JS-rendered" — a fleet-wide question that a
-- jsonb array could not answer without scanning every document.
create index scrape_warnings_code_idx on scrape_warnings (organization_id, code);

-- ============================================================================
-- §13  OPERATIONAL: SCRAPE JOBS
-- ============================================================================
--
-- One row per crawl attempt, including the ones that produced nothing. A failed
-- scrape is the row you most want to keep: it is the evidence for "this site
-- blocks us" and it is what a retry checks before hammering the site again.
--
-- Deliberately NOT a projection of the document: a job exists before a version
-- does, and often instead of one. `warnings` stays jsonb here for that reason —
-- it is a point-in-time log line, not knowledge base content. The warnings that
-- belong to a saved knowledge base are normalized in `scrape_warnings` above.

create table scrape_jobs (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  knowledge_base_id  text references knowledge_bases (id) on delete cascade,
  version_id         uuid references knowledge_base_versions (id) on delete set null,
  source_url         text not null,
  status             scrape_status not null default 'queued',
  pages_discovered   integer not null default 0,
  pages_fetched      integer not null default 0,
  robots_respected   boolean not null default true,
  warnings           jsonb not null default '[]'::jsonb,
  scraper_version    text not null,
  error              text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  duration_ms        integer
);

create index scrape_jobs_kb_idx on scrape_jobs (knowledge_base_id, started_at desc);
create index scrape_jobs_org_idx on scrape_jobs (organization_id, started_at desc);

-- ============================================================================
-- §14  FIELD PROVENANCE
-- ============================================================================
--
-- The `Sourced<T>` envelope, unrolled into rows — one per field per version,
-- keyed by the same dot path the app uses (`foundation.yearFounded`).
--
-- This is what keeps the 1:1 category tables in §5–§8 from needing four
-- provenance columns per field. It is also the table that makes provenance a
-- cross-tenant question rather than a per-document one: "every field an AI wrote
-- that nobody has confirmed" is the query that drives the review queue, and
-- against jsonb alone it is a full scan.
--
-- Collection paths appear here too (`proof.testimonials`), carrying the
-- collection-level envelope that the record rows cannot: "a review widget was
-- detected but its content is JS-rendered" belongs to the array, not to any
-- testimonial in it.

create table field_provenance (
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  organization_id  uuid not null references organizations (id) on delete cascade,
  path             text not null,      -- 'foundation.yearFounded'
  category         category_id not null,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  is_filled        boolean not null,   -- value is not null
  source_urls      text[] not null default '{}',
  note             text,
  primary key (version_id, path)
);

create index field_provenance_method_idx on field_provenance (organization_id, method);
create index field_provenance_path_idx on field_provenance (organization_id, path);
-- The attention tier from lib/schema/sourced.ts `needsReview`, as an index.
create index field_provenance_attention_idx on field_provenance (organization_id, version_id)
  where method in ('ai-live', 'ai-mock') or note is not null or confidence < 0.5;

-- ============================================================================
-- §15  ROW LEVEL SECURITY  (bonus requirement 3)
-- ============================================================================
--
-- Tenant isolation on every table, via one membership lookup.
--
-- `is_member` is STABLE and SECURITY DEFINER: stable so the planner calls it once
-- per query rather than once per row, security definer so the policy on
-- organization_members itself does not recurse when the function reads that
-- table. `set search_path` is pinned because a security definer function without
-- one is the classic PostgreSQL privilege-escalation footgun. All three matter —
-- without any of them, the policies are correct and unusable.

create or replace function is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = org and user_id = auth.uid()
  );
$$;

create or replace function has_role(org uuid, roles member_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = org and user_id = auth.uid() and role = any (roles)
  );
$$;

-- RLS on every table in the schema, without a list to keep in sync. A table
-- added later and forgotten here is the failure this loop exists to prevent:
-- it is not a missing feature, it is a tenant reading another tenant's data.
do $$
declare t record;
begin
  for t in (select tablename from pg_tables where schemaname = 'public') loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------- the roles
--
--   viewer            reads
--   editor            reads and writes knowledge base content
--   admin / owner     the above, plus membership management

-- Read-only to client keys. Creating an organization and seeding its first
-- member is a service-role operation during signup: a policy that let a client
-- insert here would let any authenticated user mint tenants.
create policy organizations_read on organizations
  for select using (is_member(id));

create policy organization_members_read on organization_members
  for select using (is_member(organization_id));

create policy organization_members_write on organization_members
  for all using (has_role(organization_id, array['owner', 'admin']::member_role[]))
  with check (has_role(organization_id, array['owner', 'admin']::member_role[]));

-- Select and insert only. There is deliberately no update or delete policy on
-- knowledge_base_versions, so the append-only guarantee holds against a
-- compromised client key and not only against the trigger in §3. The two fail
-- differently: the trigger raises, while the absent policy makes the row
-- invisible to the statement, so a client's update reports zero rows.
create policy kb_versions_read on knowledge_base_versions
  for select using (is_member(organization_id));
create policy kb_versions_insert on knowledge_base_versions
  for insert with check (
    has_role(organization_id, array['owner', 'admin', 'editor']::member_role[])
  );

-- Every remaining table is the same shape, which is the payoff for denormalizing
-- organization_id onto all of them: one predicate, one index lookup, no joins.
--
-- Generated rather than typed out forty times. A hand-written list is where the
-- next table gets forgotten, and a forgotten table with RLS enabled and no
-- policy is not a leak but a silent outage — it denies its owner too. The
-- assertion at the end of this section is what turns that from a convention
-- into a guarantee.
do $$
declare
  t record;
  writer_roles constant text := 'array[''owner'', ''admin'', ''editor'']::member_role[]';
begin
  for t in (
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'organization_id'
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attnum > 0
      -- These carry their own policies above, for the reasons given there.
      and c.relname not in ('organizations', 'organization_members',
                            'knowledge_base_versions')
    order by c.relname
  ) loop
    execute format(
      'create policy %I on public.%I for select using (is_member(organization_id))',
      t.tablename || '_read', t.tablename);
    execute format(
      'create policy %I on public.%I for all using (has_role(organization_id, %s))
         with check (has_role(organization_id, %s))',
      t.tablename || '_write', t.tablename, writer_roles, writer_roles);
  end loop;
end $$;

-- A table with RLS enabled and no policy denies everyone, including its owner.
-- Failing at apply time is the only good moment to find that out.
do $$
declare missing text;
begin
  select string_agg(t.tablename, ', ')
    into missing
  from pg_tables t
  where t.schemaname = 'public'
    and not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = t.tablename
    );

  if missing is not null then
    raise exception 'tables with RLS enabled but no policy: %', missing;
  end if;
end $$;

-- ============================================================================
-- §16  INTEGRITY: THE TENANT GUARD
-- ============================================================================
--
-- organization_id is denormalized for RLS performance, so it needs a guard: a
-- row whose tenant key disagrees with its parent's would be invisible to its
-- owner and visible to someone else. Checking it in a trigger means a bug in the
-- adapter is a failed insert rather than a cross-tenant leak.

create or replace function inherit_organization() returns trigger
language plpgsql as $$
declare
  parent_org uuid;
begin
  if tg_table_name = 'knowledge_base_versions' then
    select organization_id into parent_org from knowledge_bases where id = new.knowledge_base_id;
  else
    select organization_id into parent_org from knowledge_base_versions where id = new.version_id;
  end if;

  if parent_org is null then
    raise exception '% row references a parent that does not exist', tg_table_name;
  end if;
  if new.organization_id is distinct from parent_org then
    raise exception '% row claims organization % but its parent belongs to %',
      tg_table_name, new.organization_id, parent_org;
  end if;
  return new;
end;
$$;

-- Attached to every table that hangs off a version, by the same reasoning as the
-- policy loop: the guard is worthless if a new table can be added without it.
--
-- `scrape_jobs` is excluded deliberately — a job exists before its version does
-- and often instead of one, so `version_id` is nullable there and there is no
-- parent to inherit from.
do $$
declare t record;
begin
  for t in (
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'version_id'
    where n.nspname = 'public'
      and c.relkind = 'r'
      and a.attnum > 0
      and a.attnotnull                       -- excludes scrape_jobs
    order by c.relname
  ) loop
    execute format(
      'create trigger %I before insert on public.%I
         for each row execute function inherit_organization()',
      t.tablename || '_inherit_org', t.tablename);
  end loop;
end $$;

create trigger kb_versions_inherit_org before insert on knowledge_base_versions
  for each row execute function inherit_organization();

-- ============================================================================
-- §17  VIEWS
-- ============================================================================

-- The library grid, without touching a single `document`. This is the query
-- KnowledgeBaseSummary exists for (lib/schema/knowledge-base.ts) and the reason
-- the counters are denormalized onto the version row.
create view knowledge_base_summaries as
  select
    kb.id,
    kb.organization_id,
    kb.company_id,
    c.name        as company_name,
    c.domain,
    kb.source_url,
    v.version_no,
    f.industry,
    v.completeness,
    v.attention_count,
    v.conflict_count,
    v.keywords,
    (select count(*) from people p       where p.version_id = v.id) as people_count,
    (select count(*) from offerings o    where o.version_id = v.id) as offerings_count,
    (select count(*) from testimonials t where t.version_id = v.id) as testimonials_count,
    kb.created_at,
    kb.updated_at
  from knowledge_bases kb
  join companies c on c.id = kb.company_id
  left join knowledge_base_versions v on v.id = kb.current_version_id
  left join kb_foundation f on f.version_id = v.id;

-- Views run with the invoker's permissions, so the underlying tables' RLS
-- applies rather than the view owner's. Without this the view would be a hole
-- straight through every policy in §15.
alter view knowledge_base_summaries set (security_invoker = on);

-- The review queue: every field an AI wrote or the reconciler flagged, across
-- every company in the tenant. This is the query field_provenance exists for,
-- and the partial index in §14 mirrors its predicate exactly.
create view attention_fields as
  select
    fp.organization_id,
    fp.version_id,
    kb.id           as knowledge_base_id,
    c.name          as company_name,
    fp.path,
    fp.category,
    fp.method,
    fp.confidence,
    fp.note
  from field_provenance fp
  join knowledge_base_versions v on v.id = fp.version_id
  join knowledge_bases kb on kb.id = v.knowledge_base_id
  join companies c on c.id = kb.company_id
  where kb.current_version_id = fp.version_id
    and (fp.method in ('ai-live', 'ai-mock') or fp.note is not null or fp.confidence < 0.5);

alter view attention_fields set (security_invoker = on);
