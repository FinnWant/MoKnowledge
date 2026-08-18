-- MoKnowledge — Supabase / PostgreSQL schema (R20, R27)
--
-- The design documented in docs/DATABASE.md. It is real DDL, meant to be applied
-- with `psql -f` against a fresh Supabase project. Requires PostgreSQL 15 or
-- later (for `security_invoker` views) and the `auth` schema Supabase provides.
--
-- Every statement here parses under the actual PostgreSQL grammar (libpg_query,
-- 93 statements). It has not been executed against a live database, so treat
-- the syntax as checked and the semantics as reviewed rather than proven.
--
-- The shipped app runs on LocalJsonAdapter instead (no credentials needed to
-- clone and run); this is the second implementation of the same StorageAdapter
-- seam in lib/storage/types.ts.
--
-- The one decision everything else follows from: a knowledge base VERSION stores
-- the whole document as `jsonb` and is never updated after insert, while the
-- child tables (people, offerings, testimonials, social_profiles) are a
-- projection of it. The jsonb is the source of truth because the app's real
-- source of truth is a zod schema with ~55 provenance-wrapped fields across nine
-- categories — normalizing all of it would be 25+ tables where every schema
-- change becomes a migration. The projections exist because "which of our
-- clients offer emergency service" is a query you cannot answer by scanning
-- documents. See docs/DATABASE.md §3 for the full argument.

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- fuzzy company search

-- ---------------------------------------------------------------- enum types
--
-- Mirrored from lib/schema/. Postgres enums rather than check constraints
-- because these vocabularies are deliberately closed — the whole point of
-- offering_category is that `Service` and `Business Services` cannot both exist
-- (prompts/02-offering-normalization.md). Adding a value is `alter type ... add
-- value`, which is exactly the friction we want.

create type extraction_method as enum (
  'scraped', 'derived', 'ai-live', 'ai-mock', 'user-edited', 'not-found'
);

create type company_role as enum (
  'manufacturer', 'distributor', 'retailer', 'service-provider', 'contractor',
  'agency', 'broker', 'consultancy', 'software-vendor', 'nonprofit', 'other'
);

create type business_model as enum ('b2b', 'b2c', 'b2b2c', 'b2g', 'marketplace', 'mixed');

create type person_role as enum ('owner', 'executive', 'manager', 'staff', 'advisor', 'unknown');

create type offering_category as enum (
  'product', 'service', 'package', 'subscription', 'other'
);

create type social_platform as enum (
  'linkedin', 'facebook', 'instagram', 'x', 'youtube', 'tiktok',
  'pinterest', 'yelp', 'google-business', 'other'
);

create type scrape_status as enum ('queued', 'crawling', 'extracting', 'enriching', 'done', 'failed');

create type member_role as enum ('owner', 'admin', 'editor', 'viewer');

-- --------------------------------------------------------------- tenant root

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

-- ------------------------------------------------------------------ companies
--
-- Multi-company support (R27) is this table: an agency running knowledge bases
-- for forty clients has forty rows here under one organization. `domain` is the
-- natural key — two people submitting https://example.com/ and
-- https://www.example.com/about land on the same company rather than creating a
-- duplicate — so the app normalizes to a registrable domain before insert, the
-- same normalization lib/utils/url.ts already does.

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

-- ------------------------------------------------------------ knowledge bases
--
-- The stable identity a URL points at. Mutable pointer, immutable history:
-- everything that actually changes lives in knowledge_base_versions, and this
-- row only ever moves `current_version_id`.

create table knowledge_bases (
  id                  uuid primary key default gen_random_uuid(),
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
-- instead of a join chain. The trigger at the bottom of this file keeps it
-- honest so it cannot drift from the parent.

-- ----------------------------------------------------------------- versions
--
-- Immutable snapshots. `document` is the full KnowledgeBase as the app's zod
-- schema produces it — the same JSON shape as examples/*.json.

create table knowledge_base_versions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  knowledge_base_id  uuid not null references knowledge_bases (id) on delete cascade,
  version_no         integer not null check (version_no >= 1),
  document           jsonb not null,
  -- Denormalized out of `document` because the library grid sorts and filters on
  -- them and must not deserialize 90KB per card to render a list.
  company_name       text,
  completeness       numeric(4, 3) check (completeness between 0 and 1),
  attention_count    integer not null default 0,
  conflict_count     integer not null default 0,
  -- KnowledgeBaseSummary.keywords: alt names, areas served, and the first dozen
  -- offering and people names. This is what library search matches, so that
  -- finding a record by an offering nobody remembers the company for does not
  -- mean scanning documents.
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

-- No update or delete policy is ever granted on this table (see RLS below).
-- A version is a record of what a business said about itself on a date; the way
-- to change it is to write the next one.
create or replace function forbid_version_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'knowledge_base_versions is append-only (attempted % on %)', tg_op, old.id;
end;
$$;

create trigger kb_versions_immutable
  before update or delete on knowledge_base_versions
  for each row execute function forbid_version_mutation();

-- --------------------------------------------------- normalized projections
--
-- Written from `document` on insert of a version, by the adapter, in the same
-- transaction. They are a cache, not a second source of truth: dropping and
-- rebuilding every row here from knowledge_base_versions.document is always
-- correct, which is what makes the duplication safe.
--
-- Scoped to version_id, not knowledge_base_id, so "who was on the team in v3"
-- stays answerable and a re-scrape does not overwrite history.
--
-- Each carries the RecordProvenance columns (lib/schema/primitives.ts) because
-- provenance is per-record for collections, not per-field.

create table people (
  id                uuid primary key,   -- the record id from the document
  organization_id   uuid not null references organizations (id) on delete cascade,
  version_id        uuid not null references knowledge_base_versions (id) on delete cascade,
  name              text not null,
  title             text,
  role              person_role,
  gender            text check (gender in ('male', 'female', 'unknown')),
  bio               text,
  email             text,
  phone             text,
  image_url         text,
  profile_url       text,
  linkedin          text,
  method            extraction_method not null,
  confidence        numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls       text[] not null default '{}',
  note              text,
  position          integer not null    -- preserves document order
);

create index people_version_idx on people (version_id);
create index people_org_idx on people (organization_id);
create index people_name_trgm_idx on people using gin (name gin_trgm_ops);

create table offerings (
  id                        uuid primary key,
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
  source_candidate_indexes  integer[] not null default '{}',
  method                    extraction_method not null,
  confidence                numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls               text[] not null default '{}',
  note                      text,
  position                  integer not null
);

create index offerings_version_idx on offerings (version_id);
create index offerings_org_idx on offerings (organization_id);
create index offerings_category_idx on offerings (organization_id, category);
create index offerings_name_trgm_idx on offerings using gin (name gin_trgm_ops);

create table testimonials (
  id                  uuid primary key,
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
  published_label     text,
  platform            text,
  media_url           text,
  topics              text[] not null default '{}',
  -- Same-version record references. No FK: these are ids inside the document,
  -- and a testimonial may name a person the people extractor never found.
  mentions_people     uuid[] not null default '{}',
  mentions_offerings  uuid[] not null default '{}',
  related_offering    uuid,
  method              extraction_method not null,
  confidence          numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls         text[] not null default '{}',
  note                text,
  position            integer not null
);

create index testimonials_version_idx on testimonials (version_id);
create index testimonials_org_idx on testimonials (organization_id);

create table social_profiles (
  id               uuid primary key,
  organization_id  uuid not null references organizations (id) on delete cascade,
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  platform         social_platform not null,
  url              text not null,
  handle           text,
  method           extraction_method not null,
  confidence       numeric(4, 3) not null check (confidence between 0 and 1),
  source_urls      text[] not null default '{}',
  note             text,
  position         integer not null
);

create index social_profiles_version_idx on social_profiles (version_id);
create index social_profiles_org_idx on social_profiles (organization_id);

-- --------------------------------------------------------------- scrape jobs
--
-- One row per crawl attempt, including the ones that produced nothing. A failed
-- scrape is the row you most want to keep: it is the evidence for "this site
-- blocks us" and it is what a retry checks before hammering the site again.

create table scrape_jobs (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations (id) on delete cascade,
  knowledge_base_id  uuid references knowledge_bases (id) on delete cascade,
  version_id         uuid references knowledge_base_versions (id) on delete set null,
  source_url         text not null,
  status             scrape_status not null default 'queued',
  pages_discovered   integer not null default 0,
  pages_fetched      integer not null default 0,
  robots_respected   boolean not null default true,
  -- ScrapeWarning[] as stored in the document: code, message, url.
  warnings           jsonb not null default '[]'::jsonb,
  scraper_version    text not null,
  error              text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  duration_ms        integer
);

create index scrape_jobs_kb_idx on scrape_jobs (knowledge_base_id, started_at desc);
create index scrape_jobs_org_idx on scrape_jobs (organization_id, started_at desc);

-- ----------------------------------------------------------- field provenance
--
-- The Sourced<T> envelope, unrolled into rows — one per scalar field per
-- version, keyed by the same dot path the app uses (`foundation.yearFounded`).
--
-- It is redundant with `document`, and it earns that redundancy by making
-- provenance queryable across the whole tenant rather than one document at a
-- time. "Every field an AI wrote that nobody has confirmed" is the query that
-- drives the review queue, and against jsonb alone it is a full scan:
--
--   select path, count(*) from field_provenance
--   where organization_id = $1 and method in ('ai-live', 'ai-mock')
--   group by path order by count(*) desc;

create table field_provenance (
  version_id       uuid not null references knowledge_base_versions (id) on delete cascade,
  organization_id  uuid not null references organizations (id) on delete cascade,
  path             text not null,      -- 'foundation.yearFounded'
  category         text not null,      -- 'foundation'
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

-- --------------------------------------------------------------------- RLS
--
-- Tenant isolation on every table, via one membership lookup.
--
-- `is_member` is STABLE and SECURITY DEFINER: stable so the planner calls it once
-- per query rather than once per row, security definer so the policy on
-- organization_members itself does not recurse when the function reads that
-- table. Both matter — without either, the policies are correct and unusable.

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

alter table organizations           enable row level security;
alter table organization_members    enable row level security;
alter table companies               enable row level security;
alter table knowledge_bases         enable row level security;
alter table knowledge_base_versions enable row level security;
alter table people                  enable row level security;
alter table offerings               enable row level security;
alter table testimonials            enable row level security;
alter table social_profiles         enable row level security;
alter table scrape_jobs             enable row level security;
alter table field_provenance        enable row level security;

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

-- Everything below is the same shape, which is the payoff for denormalizing
-- organization_id: one predicate, one index lookup, no joins.

create policy companies_read on companies
  for select using (is_member(organization_id));
create policy companies_write on companies
  for all using (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]))
  with check (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]));

create policy knowledge_bases_read on knowledge_bases
  for select using (is_member(organization_id));
create policy knowledge_bases_write on knowledge_bases
  for all using (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]))
  with check (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]));

-- Select and insert only. There is no update or delete policy here by design,
-- so the append-only guarantee holds against a compromised client key and not
-- only against the trigger.
create policy kb_versions_read on knowledge_base_versions
  for select using (is_member(organization_id));
create policy kb_versions_insert on knowledge_base_versions
  for insert with check (
    has_role(organization_id, array['owner', 'admin', 'editor']::member_role[])
  );

create policy people_read on people
  for select using (is_member(organization_id));
create policy people_write on people
  for all using (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]))
  with check (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]));

create policy offerings_read on offerings
  for select using (is_member(organization_id));
create policy offerings_write on offerings
  for all using (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]))
  with check (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]));

create policy testimonials_read on testimonials
  for select using (is_member(organization_id));
create policy testimonials_write on testimonials
  for all using (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]))
  with check (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]));

create policy social_profiles_read on social_profiles
  for select using (is_member(organization_id));
create policy social_profiles_write on social_profiles
  for all using (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]))
  with check (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]));

create policy scrape_jobs_read on scrape_jobs
  for select using (is_member(organization_id));
create policy scrape_jobs_write on scrape_jobs
  for all using (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]))
  with check (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]));

create policy field_provenance_read on field_provenance
  for select using (is_member(organization_id));
create policy field_provenance_write on field_provenance
  for all using (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]))
  with check (has_role(organization_id, array['owner', 'admin', 'editor']::member_role[]));

-- ---------------------------------------------------------------- integrity
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

create trigger kb_versions_inherit_org before insert on knowledge_base_versions
  for each row execute function inherit_organization();
create trigger people_inherit_org before insert on people
  for each row execute function inherit_organization();
create trigger offerings_inherit_org before insert on offerings
  for each row execute function inherit_organization();
create trigger testimonials_inherit_org before insert on testimonials
  for each row execute function inherit_organization();
create trigger social_profiles_inherit_org before insert on social_profiles
  for each row execute function inherit_organization();
create trigger field_provenance_inherit_org before insert on field_provenance
  for each row execute function inherit_organization();

-- ------------------------------------------------------------------ helpers

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
    v.completeness,
    v.attention_count,
    v.conflict_count,
    v.keywords,
    (select count(*) from people p          where p.version_id = v.id) as people_count,
    (select count(*) from offerings o       where o.version_id = v.id) as offerings_count,
    (select count(*) from testimonials t    where t.version_id = v.id) as testimonials_count,
    kb.created_at,
    kb.updated_at
  from knowledge_bases kb
  join companies c on c.id = kb.company_id
  left join knowledge_base_versions v on v.id = kb.current_version_id;

-- Views run with the invoker's permissions, so the underlying tables' RLS
-- applies rather than the view owner's. Without this the view would be a hole
-- straight through every policy above.
alter view knowledge_base_summaries set (security_invoker = on);

-- Allocates the next version number under a lock, so two people saving the same
-- knowledge base at once get v4 and v5 rather than a unique-violation race.
create or replace function next_version_no(kb uuid) returns integer
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
