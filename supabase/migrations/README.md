# Migrations

`supabase/schema.sql` is migration **0001_baseline**. It is the whole schema as
first applied, and from here it is frozen: `npm run db:migrate` records a
checksum of every migration it applies and refuses to run if an applied one has
changed. An applied migration is history.

Changes after the baseline go in this directory:

```
supabase/migrations/0002_add_competitor_signals.sql
supabase/migrations/0003_widen_offering_pricing.sql
```

Numbered, sorted lexically, applied in that order, each in its own transaction.
Run with:

```bash
npm run db:migrate --dry-run   # what would run
npm run db:migrate             # run it
```

The directory is empty right now because the baseline has not shipped anywhere
with data in it. While that is still true, correcting the schema means editing
`schema.sql` and re-applying — which is why the extension relocation and the
composite-key fix are in the baseline rather than in migrations behind it.

## Changing a projection table

Most changes here will be to the projection tables (§5–§12 of the schema), and
those are the cheap ones, because a projection is a cache of
`knowledge_base_versions.document` rather than a second source of truth. The
shape of such a migration is:

```sql
alter table offerings add column lead_time text;
```

…and then a replay, which needs no data migration at all:

```bash
npm run db:rebuild -- --all
```

`rebuildProjections()` deletes a version's projection rows and re-runs
`projectKnowledgeBase` against the stored document, so the new column populates
from data that was already there. Nothing is lost because nothing was ever
*only* in a projection — see `docs/DATABASE.md` §3.

Two kinds of change do **not** get that treatment, and both are worth
recognising before writing the migration:

- **`knowledge_base_versions`** is append-only and holds `document`. A change
  there is a real migration with a real backfill.
- **An enum** needs `alter type … add value`, which cannot run inside a
  transaction block in PostgreSQL before 12 and cannot be rolled back. Put it in
  a migration of its own. `npm run db:parity` will tell you the moment a zod
  enum has a value the database does not.
