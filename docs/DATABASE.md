# Database design (R20, R27)

The shipped app persists to `data/knowledge-bases/{id}/v{n}.json` through
`LocalJsonAdapter`, so a reviewer can clone the repo and save a knowledge base without
credentials. This document is the production design behind the same seam:
[`supabase/schema.sql`](../supabase/schema.sql) is the DDL, and every statement in it
parses under the real PostgreSQL grammar.

Both implement `StorageAdapter` ([`lib/storage/types.ts`](../lib/storage/types.ts)) —
five methods, `list` / `get` / `save` / `remove` / `versions`. Swapping them is one line
in `lib/storage/index.ts`; no route or component knows which one it is talking to.

---

## 1. The shape

```
organizations                     tenant root
  └─ organization_members         (user_id, organization_id, role) — what RLS joins on
  └─ companies                    one per client business (R27: an agency has forty)
       └─ knowledge_bases         stable identity; holds a pointer, not content
            └─ knowledge_base_versions    immutable snapshots, the whole document
                 ├─ people                 ┐
                 ├─ offerings              │ normalized projections of the
                 ├─ testimonials           │ current document, for querying
                 ├─ social_profiles        ┘
                 └─ field_provenance       the Sourced<T> envelope, unrolled
  └─ scrape_jobs                  one row per crawl attempt, successes and failures
```

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

`next_version_no()` takes a row lock on the parent before reading `max(version_no)`, so
two people saving at once get v4 and v5 instead of a unique violation. The local adapter
has the same race and the same fix is not available to it — one more reason the seam
exists.

## 3. Why `document jsonb` *and* normalized tables

This is the one decision the rest of the schema follows from, and it is a genuine
trade-off rather than an obvious win.

**The knowledge base is not a natural relational object.** It is nine categories, ~55
provenance-wrapped scalar fields, and twenty-odd entity types (`themes`, `faqs`,
`glossary`, `seasonalSignals`, `headlinePatterns`, …), each defined in zod at
[`lib/schema/`](../lib/schema/). Fully normalizing it is 25+ tables in which every
schema change becomes a migration — and the schema's own source of truth is the zod
file, which changes whenever extraction improves.

**But documents alone cannot answer the questions the product exists to answer.** "Which
of our clients offer emergency service", "every AI-written field nobody has confirmed",
"who is on the team at all forty companies" — each is a full scan over jsonb.

So: `document` is the source of truth and is written once; the child tables are a
**projection** written from it in the same transaction. The duplication is safe because
it is one-directional — dropping every row in `people`, `offerings`, `testimonials`,
`social_profiles`, and `field_provenance` and rebuilding them from
`knowledge_base_versions.document` is always correct. Nothing is only in a projection.

The projections are keyed by `version_id`, not `knowledge_base_id`, so "who was on the
team in v3" stays answerable and a re-scrape appends rather than overwrites.

`field_provenance` is the projection that earns its keep least obviously. It unrolls the
`Sourced<T>` envelope into one row per field per version, keyed by the same dot path the
app uses (`foundation.yearFounded`). It exists because the review queue — the attention
tier from `needsReview` in [`lib/schema/sourced.ts`](../lib/schema/sourced.ts) — is a
cross-document question:

```sql
select path, count(*) from field_provenance
where organization_id = $1 and method in ('ai-live', 'ai-mock')
group by path order by count(*) desc;
```

A partial index mirrors `needsReview`'s exact predicate, so the attention tier is an
index scan rather than a filter over every field of every version.

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
- **`testimonials.published_label` is text, not `date`.** Sites publish "March 2024" and
  "2 weeks ago". Coercing those to a date invents a precision the page never had, which
  is the same rule the extractors follow (`docs/DATA-QUALITY.md` §2).
- **No FK on `mentions_people` / `mentions_offerings`.** They reference record ids inside
  the document, and a testimonial may name a person the people extractor never found.
  A dangling reference there is information, not corruption.
- **`scrape_jobs` keeps failures.** A failed scrape is the row you most want: it is the
  evidence for "this site blocks us", and it is what a retry consults before hitting the
  site again.

## 7. What porting the adapter would take

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
