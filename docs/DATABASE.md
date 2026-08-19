# Database design (R20, R27)

The shipped app persists to `data/knowledge-bases/{id}/v{n}.json` through
`LocalJsonAdapter`, so a reviewer can clone the repo and save a knowledge base without
credentials. This document is the production design behind the same seam:
[`supabase/schema.sql`](../supabase/schema.sql) is the DDL, applied to a live Supabase
project (PostgreSQL 17.6) and verified there — see §8.

**The bonus challenge asks for four things.** Where each is answered:

| Asked for | Answered in |
|---|---|
| Table schemas with column types | §1 and §3 — 42 tables, one per entity type in `lib/schema/` |
| Relationships between tables | §1, and every `references` clause in the DDL |
| Row Level Security policy considerations | §4 — 83 policies, and what makes them work rather than merely exist |
| Multiple companies and versioning | §2 and §5 |

42 tables, 25 enum types, 83 policies, 38 triggers, 141 indexes.

Both implement `StorageAdapter` ([`lib/storage/types.ts`](../lib/storage/types.ts)) —
five methods, `list` / `get` / `save` / `remove` / `versions`. Swapping them is one line
in `lib/storage/index.ts`; no route or component knows which one it is talking to.

---

## 1. The shape

```
organizations                       tenant root
  ├─ organization_members           (user_id, organization_id, role) — what RLS joins on
  ├─ companies                      one per client business (R27: an agency has forty)
  │    └─ knowledge_bases           stable identity; holds a pointer, not content
  │         └─ knowledge_base_versions   immutable snapshots; `document` is the whole KB
  │              │
  │              │  every category below is a PROJECTION of that document,
  │              │  keyed by version_id, rebuildable from it at any time
  │              │
  │              ├─ kb_foundation ─ addresses          1. company foundation
  │              ├─ kb_positioning                     2. positioning
  │              ├─ kb_market                          3. market & customers
  │              ├─ kb_branding, kb_writing_style,     4. branding & style
  │              │  brand_colors, media_assets
  │              ├─ social_profiles                    5. online presence
  │              ├─ people                             6. key people
  │              ├─ offerings                          7. offerings
  │              ├─ testimonials, aggregate_ratings,   8. proof & credibility
  │              │  case_studies, credentials, awards,
  │              │  press_mentions, trust_stats,
  │              │  guarantees, (media_assets)
  │              ├─ content_themes, content_items,     9. content intelligence
  │              │  kb_taxonomy, kb_cadence,
  │              │  headline_patterns, faqs,
  │              │  glossary_terms, seasonal_signals,
  │              │  content_gaps
  │              ├─ quality_category_scores,          10. quality (computed, not extracted)
  │              │  quality_conflicts ─ …_candidates,
  │              │  quality_follow_up_questions
  │              ├─ kb_scrape_metadata,                   scrape metadata
  │              │  scrape_pages, scrape_warnings
  │              └─ field_provenance                      the Sourced<T> envelope, unrolled
  └─ scrape_jobs                    one row per crawl attempt, successes and failures
```

Every one of the nine categories in the knowledge base standard has real tables with real
column types. That was not true of the first draft of this schema, which normalized four
of them and left the rest inside `document jsonb` — see §3.

---

---

## 2. Versioning

`knowledge_bases` holds no content. It holds `current_version_id`, and every save
inserts a new `knowledge_base_versions` row and moves that pointer.

This is not a generic audit-log habit. A knowledge base is a record of what a business
said about itself on a date, and three things in this app depend on the earlier answer
still existing:

- **Re-scrape with per-field accept** (`docs/VIEW-PAGE.md`). Re-scraping produces a
  candidate version and diffs it against the current one. The diff is between two rows.
- **Undo after delete**, which the library offers for a few seconds after the action.
- **"What changed?"** — the version history and diff view in the app is a query over
  `version_no`, not a reconstruction from a log of mutations.

Immutability is enforced twice, deliberately:

- A `before update or delete` trigger on `knowledge_base_versions` raises.
- No update or delete **policy** exists on that table, so the guarantee also holds
  against a client key that talks to PostgREST directly rather than through our code.

The two are not redundant: they fail differently, and the difference is visible in
`npm run db:check`. The trigger *raises*; the missing policy makes the rows invisible to
the statement, so a client's `update` reports **zero rows affected** and no error at all.

**"Append-only" has to stop at the row's own lifetime, not its parents'.** The first
version of this trigger raised on every delete, including the cascaded ones — which made
`remove(id)` impossible and, worse, made an entire organization undeletable, since the
cascade from `organizations` reaches this table too. That is a bug executing the schema
found and reading it did not. A cascade is distinguishable from a direct delete without
guessing at `pg_trigger_depth()`: PostgreSQL deletes the parent row *before* applying the
referential action, so when the trigger fires for a cascade the parent is already gone.
Both cascade paths into this table (via `knowledge_bases`, and directly via
`organizations`) are checked, so a version still cannot be deleted on its own while its
parents exist.

`next_version_no()` takes a row lock on the parent before reading `max(version_no)`, so
two people saving at once get v4 and v5 instead of a unique violation. The local adapter
has the same race and the same fix is not available to it — one more reason the seam
exists.

**Every projection table is keyed `(version_id, id)`, not `id`.** A record id is stable
*within* a knowledge base, not globally: person `account-it-0051` appears in v1 and again
in v2 of the same document. The first draft made `id` the sole primary key, which means
the second save of an edited knowledge base fails on a duplicate key — versioning broken
by the table that was supposed to support it. `npm run db:check` inserts the same record
id under two versions specifically to keep that from coming back.

Relatedly, **document ids are `text`**. The zod schema says `id: z.string()` and the
committed examples use ids like `example-account-it` and `account-it-0051`; all 289 record
ids in `examples/` are non-UUID. The first draft declared them `uuid`, which would have
rejected the project's own example corpus on contact with real data.

## 3. Why `document jsonb` *and* normalized tables

This is the one decision the rest of the schema follows from, and the first draft of this
document got the balance wrong in a way worth recording.

**The knowledge base is not a natural relational object.** It is nine categories, ~55
provenance-wrapped scalar fields, and twenty-odd entity types (`themes`, `faqs`,
`glossary`, `seasonalSignals`, `headlinePatterns`, …), each defined in zod at
[`lib/schema/`](../lib/schema/). Normalizing all of it is forty-odd tables in which every
schema change becomes a migration — and the schema's own source of truth is the zod file,
which changes whenever extraction improves.

That argument is real, and the first draft used it to justify normalizing only the four
categories with obvious cross-record queries — people, offerings, testimonials, social
profiles — and leaving foundation, positioning, market, branding, content intelligence,
quality and scrape metadata inside the jsonb.

**That was the wrong call, for a reason the cost/benefit framing hides.** The questions
that make a knowledge base worth storing relationally are not concentrated in those four
categories:

- *"Which clients have a stale blog?"* — `kb_cadence.is_stale`, a MoBlogs sales trigger.
- *"What tone do we write in for this client?"* — `kb_writing_style`, which every one of
  MoSocial, MoMail and MoBlogs reads before generating a word.
- *"Which clients' sites are JS-rendered?"* — `scrape_warnings.code`, a fleet-wide
  operational question.
- *"What CTAs do our home-services clients use?"* — `kb_market.ctas`.

Each of those is a full jsonb scan under the old design, and each is a plain index lookup
now. The categories left un-normalized were not the ones nobody queries; they were the
ones nobody had queried *yet*.

So: **`document` is the source of truth and is written once; every table in §1 is a
projection of it.** The duplication is safe because it is one-directional — truncating
every projection table and rebuilding from `knowledge_base_versions.document` is always
correct. Nothing is only in a projection, which is why `npm run db:check` asserts the
document round-trips through jsonb byte-for-byte after loading.

The migration burden is real and accepted. It is mitigated by the same one-directional
property: a schema change means altering a projection table and rebuilding it from the
documents, never a data migration with a rollback plan.

### What keeps it complete

A hand-maintained mapping is exactly the kind of thing that rots, so it is a test.
[`npm run db:parity`](../scripts/check-schema-parity.ts) walks `knowledgeBaseSchema`,
enumerates all 231 storable paths, and fails if any of them has no entry in
[`scripts/schema-map.ts`](../scripts/schema-map.ts) or maps to a column that does not
exist. Adding a field to the knowledge base now breaks the build until the database has
somewhere to put it.

It also compares every enum **value by value, through the column's own type** rather than
through a list of named exports — several of these enums are declared inline in zod
(`guarantees[].kind`, `people[].gender`, `writingStyle.formality`), and a map of exported
schemas would check the easy half and silently skip the rest.

That check is not decorative. It found `offering_category` shipping with five of its eight
values: any offering classified `consultation`, `financing` or `industry-solution` would
have been rejected at save time by a schema that had been reviewed and looked right.

### Where provenance lives

`Sourced<T>` wraps every scalar with `method`, `confidence`, `sourceUrls` and `note`.
Repeating those as four columns per field would be ~220 columns of envelope, so the
category tables in §1 hold **values**, and `field_provenance` holds the envelope — one row
per field per version, keyed by the same dot path the app uses
(`foundation.yearFounded`). A partial index mirrors `needsReview`'s exact predicate, so
the review queue is an index scan rather than a filter over every field of every version:

```sql
select path, count(*) from field_provenance
where organization_id = $1 and method in ('ai-live', 'ai-mock')
group by path order by count(*) desc;
```

Collections work the other way round. A record carries its provenance inline (`method`,
`confidence`, `source_urls`, `note` on each row), because for a collection provenance is
per record — one badge per person card, not per field of a person. The collection's *own*
envelope still gets a `field_provenance` row at its path (`proof.testimonials`), because
"a review widget was detected but its content is JS-rendered" belongs to the array rather
than to any testimonial in it.

### One thing that is genuinely a judgement call

`quality_conflict_candidates.value` is `jsonb`. A candidate value may be a string, a
number, or a whole address object — it is `z.unknown()` in the schema — so a typed column
would have to be five nullable columns and a discriminator. Here jsonb is the honest type
rather than an evasion, and it is the only knowledge base value stored that way.

## 4. Multi-tenancy and RLS (R27)

Isolation is by `organization_id`, checked on every table by one function:

```sql
create or replace function is_member(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members
    where organization_id = org and user_id = auth.uid()
  );
$$;
```

Three details in that definition are load-bearing, and getting any of them wrong
produces policies that are correct and unusable:

- **`stable`** — the planner calls it once per query instead of once per row.
- **`security definer`** — the policy on `organization_members` would otherwise recurse
  when the function reads that same table.
- **`set search_path`** — a `security definer` function without a pinned search path is
  the classic PostgreSQL privilege-escalation footgun.

**`organization_id` is denormalized onto every table**, including ones where it is
derivable by joining up to `companies`. RLS runs on every row of every query, so
carrying the tenant key locally makes each policy a single index lookup rather than a
join chain. The cost is that a row could claim the wrong tenant — invisible to its owner,
visible to someone else — so a `before insert` trigger checks each row's
`organization_id` against its parent's. A bug in the adapter is then a failed insert
rather than a cross-tenant leak.

Writes additionally check `has_role(...)`: `viewer` reads, `editor` writes content,
`admin`/`owner` manage membership. `organizations` has no insert policy at all — creating
a tenant is a service-role operation during signup, or any authenticated user could mint
one.

**The uniform policies are generated, not typed out forty times.** Tables with special
rules — `organizations`, `organization_members`, `knowledge_base_versions` — carry
hand-written policies, because their rules *are* the interesting part. Every other table
gets the same read/write pair from a `do` block that loops over the catalog looking for an
`organization_id` column.

That is a safety decision rather than a typing-effort one. A hand-written list of forty
tables is where the forty-first gets forgotten, and a forgotten table is not a missing
feature — it is either a tenant reading another tenant's rows, or, if RLS was enabled
without a policy, a table that denies everyone including its owner. The schema therefore
ends §15 with an assertion that raises at apply time if any table has RLS enabled and no
policy, and `npm run db:check` re-asserts it against the live database. The tenant-guard
trigger is attached the same way, for the same reason.

`knowledge_base_summaries` is a view, and views run as their owner by default, which
would tunnel straight through every policy above. `security_invoker = on` makes the
underlying tables' RLS apply instead. This is why the schema needs PostgreSQL 15+.

## 5. Companies and deduplication (R27)

`companies` is unique on `(organization_id, domain)`, with `domain` normalized to a
registrable domain by the same `lib/utils/url.ts` the crawler uses. Two people submitting
`https://example.com/` and `https://www.example.com/about` land on the same company
rather than creating a duplicate — the mistake that makes a multi-company library
useless by month three.

Uniqueness is scoped to the organization, not global: two agencies may both track the
same client, and neither should see the other's knowledge base.

## 6. Things left out, and why

- **No `updated_at` on versions.** They are never updated.
- **No full-text search index on `document`.** Search in the library runs over
  `KnowledgeBaseSummary.keywords`, which is already denormalized onto the version row.
  A `tsvector` over the whole document would match text no user thinks of as content
  (warning messages, CSS colors, script hosts).
- **`testimonials.published_date` is text, not `date`.** Sites publish "March 2024" and
  "2 weeks ago". Coercing those to a date invents a precision the page never had, which
  is the same rule the extractors follow (`docs/DATA-QUALITY.md` §2). The same applies to
  `press_mentions.published_date`, `credentials.valid_until` and `kb_cadence`'s
  first/last published labels.
- **`scrape_jobs.warnings` stays `jsonb`, while `scrape_warnings` is a table.** They are
  not the same data: a job exists before a version does and often instead of one, so its
  warnings are a point-in-time log line rather than knowledge base content. The warnings
  belonging to a saved knowledge base are normalized.
- **No FK on `mentions_people` / `mentions_offerings`.** They reference record ids inside
  the document, and a testimonial may name a person the people extractor never found.
  A dangling reference there is information, not corruption.
- **`scrape_jobs` keeps failures.** A failed scrape is the row you most want: it is the
  evidence for "this site blocks us", and it is what a retry consults before hitting the
  site again.

## 7. What porting the adapter takes

`LocalJsonAdapter` is ~200 lines. A `SupabaseAdapter` implementing the same interface is
roughly:

| Method | Supabase equivalent |
|---|---|
| `list()` | `select * from knowledge_base_summaries` — no document parsed |
| `get(id, version?)` | one row from `knowledge_base_versions`, `document` returned as-is |
| `save(kb)` | `next_version_no()`, insert the version, insert the projections, move `current_version_id` — one transaction |
| `remove(id)` | delete the `knowledge_bases` row; cascades handle the rest |
| `versions(id)` | `select version_no, created_at, rescraped ...` |

The app above the seam does not change, because `save` already returns the knowledge base
as stored and callers already treat the returned copy as authoritative.

The projection half of `save()` already exists, as
[`scripts/project-knowledge-base.ts`](../scripts/project-knowledge-base.ts): it maps a
`KnowledgeBase` into all forty tables and is what `npm run db:check` uses to load the
committed examples. It lives in `scripts/` rather than `lib/` deliberately — the shipped
app runs on `LocalJsonAdapter`, and half an adapter in `lib/` with no caller is a thing to
maintain for nothing. When the adapter is written, that is the file it starts from.

---

## 8. Applying it, and what running it proved

```bash
# .env.local
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

```bash
psql "$SUPABASE_DB_URL" -f supabase/schema.sql   # 42 tables, 83 policies, 25 enums
npm run db:parity                                 # does every field have a column?
npm run db:check                                  # does the database behave as described?
```

**Use the session pooler host, not the direct one.** Supabase's direct endpoint
(`db.<ref>.supabase.co`) resolves to an IPv6 address only, unless the project has the
IPv4 add-on; on an IPv4-only network it fails with `ECONNREFUSED` before it ever reaches
Postgres. The pooler on port 5432 is session mode, which is what DDL and the
transaction-per-save in `save()` need — port 6543 is transaction mode and will not hold a
session across statements.

`SUPABASE_DB_URL_DIRECT` is kept in `.env.local` for the case where the add-on is enabled
or migrations run from a machine with IPv6; nothing reads it today.

### What `npm run db:parity` is for

[`scripts/check-schema-parity.ts`](../scripts/check-schema-parity.ts) is the completeness
test described in §3: it walks the zod schema, not the SQL, so it cannot be satisfied by
editing the thing it is checking. 252 assertions — 231 field paths, 21 enum columns
compared value by value.

### What `npm run db:check` is for

[`scripts/check-db.ts`](../scripts/check-db.ts) is the database counterpart of
`npm run ai:check`: it applies no DDL, it asks whether the guarantees this document
argues for actually hold. Fixtures are written inside a transaction that is rolled back,
so a green run leaves the database exactly as it found it.

| It checks | Because |
|---|---|
| Versions cannot be updated or deleted directly | §2 — the whole versioning argument |
| Deleting a knowledge base or an organization cascades, leaving no row in any of the 41 tenant tables | §2 — `remove(id)` depends on it, and this is where the trigger was wrong |
| The same record id can appear in two versions | §2 — the composite key; without it the second save of an edit fails |
| A child row cannot claim a tenant its parent does not have, on every version-scoped table | §4 — the cost of denormalizing `organization_id` |
| Every table has RLS **and** at least one policy | §4 — enabled-with-no-policy is a silent outage |
| `next_version_no` blocks a second saver, then hands out the next number | §2 — the concurrent-save race, tested with two connections |
| A member sees only their tenant; another tenant and `anon` see nothing | §4 — the point of RLS |
| `knowledge_base_summaries` obeys RLS | §4 — a view without `security_invoker` is a hole through every policy |
| All three committed `examples/*.json` project into all 40 tables | §3 — the difference between "a column exists" and "the real data fits" |
| The document round-trips through jsonb unchanged | §3 — projections are a cache, never a second source of truth |

The last two are the ones that matter most for the bonus challenge. Structural parity says
every field *has* somewhere to live; loading three real knowledge bases — 30 people, 18
offerings, 54 provenance rows, 20 crawled pages in one of them — says the schema holds
what the scraper actually produces.

**The RLS checks run as the `authenticated` role, not as `postgres`.** The role in a
Supabase connection string has `BYPASSRLS`, so an isolation test that stays as `postgres`
passes just as happily against policies that do nothing at all. Each check switches role
and sets a simulated JWT subject, which is what the browser client actually is — that
distinction is the difference between testing RLS and testing nothing.
