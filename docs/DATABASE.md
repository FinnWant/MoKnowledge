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

43 tables, 25 enum types, 85 policies, 40 triggers, 144 indexes.

Both implement `StorageAdapter` ([`lib/storage/types.ts`](../lib/storage/types.ts)) —
five methods, `list` / `get` / `save` / `remove` / `versions`. Swapping them is one line
in `lib/storage/index.ts`; no route or component knows which one it is talking to.

---

## 1. The shape

```
organizations                       tenant root
  ├─ organization_members           (user_id, organization_id, role) — what RLS joins on
  ├─ organization_invitations       how a second person joins; matched on verified email
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

### Signup, invitations, and the two escalation paths

Because `organizations` is closed to client keys, becoming a tenant has to happen above
RLS. That is `handle_new_user()`, a `security definer` trigger on `auth.users` — the one
moment when "this person exists and has no tenant" is true. It does one of two things:

- **Invited** — joins the inviting organization at the invited role, and marks the
  invitation accepted so it cannot be reused.
- **Not invited** — creates a new organization with this user as its `owner`.

**Invitations are a table, not a field in user metadata, and that is the whole point.**
`raw_user_meta_data` is whatever the client passed to `signUp()`. A trigger that read an
`organization_id` from there would let anyone join any tenant by typing its uuid into a
signup form. The invitation has to be a row an admin created, matched on the address the
user actually verified. `npm run db:check` signs up an attacker with exactly that forged
metadata and asserts they land in their own tenant instead.

The organization name *is* read from client metadata, which is safe in a way the id is
not: it labels a tenant the user is about to own, and grants nothing.

Two escalation paths run through membership, and both are closed:

- `organization_invitations` is excluded from the generated policy loop. With the standard
  editor-writes policy, any editor could invite their own second address as `owner`.
  Invitations get the membership rules instead — admin/owner only, for reads too, since a
  pending invitation is somebody's email address.
- An admin manages membership, so an admin can write invitations — but
  `guard_owner_grant()` raises if anyone who is not already an `owner` grants the `owner`
  role, on either table. `auth.uid()` is null for the service role, which is the signup
  path creating the first owner of a new tenant, and that case is allowed through
  deliberately.

Slugs are derived from the address and collide (`founder@a.com` and `founder@b.com` both
want `founder`), so `unique_org_slug()` suffixes, and the insert retries around the unique
constraint rather than trusting the lookup — two signups in the same second would
otherwise race between checking and inserting.

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

`resolve_company(org, domain, name)` is the find-or-create `save()` needs. It is one
`insert … on conflict … do update … returning` rather than a select-then-insert, because
the naive version has two scrapes of the same site starting together both find nothing,
both insert, and one take a unique violation — and two people pasting the same URL at the
same moment is what a multi-company library is *for*. `db:check` drives that race across
two connections and asserts the second caller receives the first caller's company.

The conflict path deliberately does **not** overwrite `name`. A company is named once,
when first seen; a re-scrape that reads a different `<title>` should not rename the client
in the directory behind the user's back.

Normalization to a registrable domain stays in TypeScript (`registrableDomain()` in
`lib/utils/url.ts`, the same function the crawler uses) rather than being reimplemented in
plpgsql, because two copies of public-suffix rules is how the two drift.

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

## 7. The adapter

`SupabaseAdapter` ([`lib/storage/supabase/adapter.ts`](../lib/storage/supabase/adapter.ts))
implements the same five methods as `LocalJsonAdapter`, and the app above the seam does not
know which one it has.

| Method | What it does |
|---|---|
| `list()` | `select … from knowledge_base_summaries` — all 16 summary fields, no document parsed |
| `get(id, version?)` | one row, `document` returned as-is |
| `save(kb)` | `resolve_company()`, `next_version_no()`, insert the version, project it, move `current_version_id` — one transaction |
| `remove(id)` | delete the `knowledge_bases` row; cascades handle the rest |
| `versions(id)` | `version_no`, `document_updated_at`, `rescraped` |

It is about 300 lines, and the reason it is not larger is §3: because `document` is the
source of truth, `get()` has nothing to reassemble. There is no mapping from forty tables
back into a `KnowledgeBase` anywhere in this codebase, and there does not need to be.

**Which adapter runs is decided in one place**
([`lib/storage/index.ts`](../lib/storage/index.ts)) by whether the database URL and the auth
keys are all present. Together, deliberately: the keys say a person can sign in, the URL
says there is somewhere for their data to go, and one without the other is a
misconfiguration rather than a mode. Half-configured falls back to local and says why.

### Three things worth knowing about `save()`

**The order is chosen so a crash is a no-op.** The version row and all its projections land
before `current_version_id` moves. An interrupted save leaves an unreferenced version,
which is invisible and harmless; the reverse would leave the library pointing at a
half-written one.

**`rescraped` is derived, not declared.** Editing keeps the crawl a knowledge base was
built from, so a version whose `scrape.startedAt` differs from its predecessor's is exactly
a re-scraped one — the same rule `LocalJsonAdapter.versions()` applies at read time.
Computing it at write time makes it a column the library can filter on.

**Reads are transactions too.** That is what makes `set local role authenticated` safe:
the role and JWT claim unwind on commit, so a pooled connection is never handed to the next
caller still wearing the last caller's identity.

### Where the tenant comes from

`SUPABASE_ORG_ID` is gone from the app. It named one organization for the whole
deployment, which was the only thing possible without a login and the wrong thing the
moment there is one — the tenant is a property of who is asking.

[`sessionTenant()`](../lib/auth/tenant.ts) reads the session, then the user's membership.
That membership lookup deliberately runs with the pool's own role rather than under RLS:
`is_member()` answers "is this user in that org", and the question here is "which org is
this user in", asked about a user just authenticated. Answering it under a policy that
needs the answer first is circular.

One membership per user today. When someone can belong to two — an agency contractor across
accounts — this is the single place that changes, and the `order by created_at` keeps that
day deterministic rather than arbitrary.

### RLS, and why the adapter does not rely on it

The connection string is the `postgres` role, which has `BYPASSRLS`. Connect with it and all
85 policies stop applying. `withTenant`
([`lib/storage/supabase/tenant.ts`](../lib/storage/supabase/tenant.ts)) therefore drops to
`authenticated` with the user's id as the JWT subject whenever a session exists — and every
query in the adapter *also* carries an explicit `where organization_id = $1`.

Both belts are worn on purpose. Before there is a login there is no uid to assume, so the
explicit scoping is the only thing standing between tenants; after there is one, RLS
catches anything a future query forgets. `npm run db:check` runs a second adapter pointed at
a different tenant and asserts it can neither read nor delete the first one's knowledge
base.

### Rebuilding the projections

[`rebuildProjections()`](../lib/storage/supabase/rebuild.ts) deletes a version's projection
rows and replays `projectKnowledgeBase` against the stored document. This is what makes §3's
claim an operation rather than an assertion, and it is what a projection schema change
costs:

```bash
npm run db:rebuild -- --all          # or --kb <id>, or --version <uuid>
```

Add a column to `offerings`, replay, and it populates from data that was already stored.
Nothing is lost because nothing was ever *only* in a projection.

### `scrape_jobs`, which the adapter does not write

One row per crawl attempt, written by the scrape route rather than by `save()`, because a
job exists before a version does and frequently instead of one — a blocked or empty crawl
produces no knowledge base at all, and that row is the evidence for "this site blocks us".

Every function in [`jobs.ts`](../lib/storage/supabase/jobs.ts) is a no-op when Supabase is
not configured, and none of them can fail a scrape: telemetry that takes down the thing it
observes is worse than no telemetry. `knowledge_base_id` and `version_id` are left null —
filling them would mean threading a job id from the scrape stream through the draft the
user edits into the save request, which is a change to the API contract for a link nothing
currently asks for.

---

---

## 8. Applying it, and what running it proved

```bash
# .env.local
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

```bash
npm run db:migrate                # apply the schema, then everything since
npm run db:parity                 # does every field have a column?        (252 checks)
npm run db:check                  # does it behave as described?            (68 checks)
npm run db:perf                   # are the indexes applicable?              (9 checks)
```

`db:migrate` is the entry point rather than `psql -f`. `supabase/schema.sql` is migration
**0001_baseline**, and from that point it is frozen: the runner records a checksum and
refuses to run if an applied migration has changed. Changes after the baseline are new
files in [`supabase/migrations/`](../supabase/migrations/README.md), each applied in its own
transaction under an advisory lock so two deploys landing together cannot both apply the
same one.

The ledger lives in a `migrations` schema rather than `public` — found by the schema
asserting on itself, since `public` is where the RLS loop enables row security on
everything it finds and then fails on any table without a policy. It is also where
PostgREST looks, and a migration ledger is not something a client key should enumerate.

**Use the session pooler host, not the direct one.** Supabase's direct endpoint
(`db.<ref>.supabase.co`) resolves to an IPv6 address only, unless the project has the
IPv4 add-on; on an IPv4-only network it fails with `ECONNREFUSED` before it ever reaches
Postgres.

**Either pooler port works for the app.** An earlier version of this document claimed the
transaction pooler on 6543 could not hold `next_version_no`'s row lock across statements.
That is wrong, and testing it says so: transaction mode pins a server connection for the
duration of a transaction, so `set local`, `select … for update` and named prepared
statements all behave. Every adapter operation is wrapped in a single transaction
(`withTenant`), which is exactly the shape transaction mode is built for — two connections
through 6543 serialise on the lock and receive v2 then v3, the same as through 5432.

Prefer **6543 for the deployed app** (many short-lived serverless connections) and **5432
for migrations and `psql`**, where session-level state and DDL are more comfortable.

`SUPABASE_DB_URL_DIRECT` is kept in `.env.local` for the case where the add-on is enabled
or migrations run from a machine with IPv6; nothing reads it today.

### What `npm run db:perf` is for

The other checks run against three documents, where PostgreSQL sequentially scans
everything regardless because the tables fit in a page. That says nothing about the shape of
the plan, which is the whole reason the projection tables exist.

[`scripts/check-db-performance.ts`](../scripts/check-db-performance.ts) seeds the R27 case —
forty companies, three versions each, across two tenants — and asserts on plans rather than
timings. Timings on a shared pooler tell you about the neighbours.

It asserts that each design-critical query has an **applicable** index, by disabling
`enable_seqscan` and requiring the expected index by name. It deliberately does *not* assert
that the planner picks it unaided: at any size a test can seed, a sequential scan is often
the right plan, and asserting otherwise just asserts that the fixture is large. Whether the
index was chosen naturally is reported alongside, as context.

Writing it turned up nothing wrong with the schema and two things wrong with the fixture,
which is its own kind of finding: every example classifies its offerings as `service`, and
every seeded row shared a keyword, so neither predicate was selective enough for the
composite and GIN indexes to be reachable. A fixture that cannot distinguish a good index
from a bad one cannot test either.

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
| Signup creates a tenant; an invitation joins one; a forged `organization_id` does neither | §4 — the trigger runs above RLS on partly client-supplied data |
| An admin cannot mint an owner, an owner can | §4 — the escalation path through membership |
| `resolve_company` under two concurrent callers yields one company | §5 — the save-time race |
| The summaries view supplies all 16 `KnowledgeBaseSummary` fields | §7 — otherwise `list()` costs a document fetch per card |
| A real example survives `save()` → `get()` unchanged, twice, keeping `createdAt` | §7 — the adapter's contract with the app |
| A second tenant's adapter can neither read nor delete the first's knowledge base | §7 — the isolation the explicit scoping exists for |
| `rebuildProjections` reproduces exactly the rows it deleted | §3 — projections are a cache, demonstrated rather than argued |

The last two are the ones that matter most for the bonus challenge. Structural parity says
every field *has* somewhere to live; loading three real knowledge bases — 30 people, 18
offerings, 54 provenance rows, 20 crawled pages in one of them — says the schema holds
what the scraper actually produces.

**The RLS checks run as the `authenticated` role, not as `postgres`.** The role in a
Supabase connection string has `BYPASSRLS`, so an isolation test that stays as `postgres`
passes just as happily against policies that do nothing at all. Each check switches role
and sets a simulated JWT subject, which is what the browser client actually is — that
distinction is the difference between testing RLS and testing nothing.
