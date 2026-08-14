# View / Manage Page Design

`/knowledge/view` and `/knowledge/view/[id]`. Satisfies R10–R14.
Companion to [`EDIT-UX.md`](EDIT-UX.md), which covers the build page.

---

## The problem

The library holds knowledge bases of very uneven size — a thin professional-services site
with 12 filled fields sits next to Bee Cave Drilling with 14 offerings, 8 people, and a
testimonial list. A single layout can't serve both browsing ("which one was the drilling
company?") and inspection ("what pricing did we capture for well maintenance?").

Hence three view modes, each answering a different question.

---

## View modes

| Mode | Answers | Shows |
|---|---|---|
| **Card** (default) | "Which one is it?" | Visual scan — logo, name, industry, completeness ring, counts |
| **Table** | "Which ones need attention?" | Dense, sortable comparison across all records |
| **Detail** | "What exactly do we have?" | One knowledge base in full |

Mode persists in `localStorage` and is reflected in the URL (`?view=table`) so a view can
be linked.

### Card view

```
┌─────────────────────────────┐  ┌─────────────────────────────┐
│ ◐ 78%          Bee Cave …   │  │ ◑ 54%          Account IT   │
│ [logo]  Water Well Drilling │  │ [logo]  Accounting & Tax    │
│                             │  │                             │
│ Dripping Springs, TX        │  │ Boynton Beach, FL           │
│ 14 offerings · 8 people     │  │ 8 offerings · 1 person      │
│ 12 testimonials             │  │ No testimonials             │
│                             │  │ ⚠ 3 fields need review      │
│ Updated 2 hours ago      ⋮  │  │ Updated yesterday        ⋮  │
└─────────────────────────────┘  └─────────────────────────────┘
```

The completeness ring is the primary visual signal; counts convey depth at a glance.
Cards with unreviewed fields carry the ⚠ line, so the library doubles as a work queue.

### Table view

| ▢ | Company ▲ | Industry | Location | Complete | Offerings | People | Proof | Updated | |
|---|---|---|---|---|---|---|---|---|---|
| ▢ | Bee Cave Drilling | Water Well Drilling | Dripping Springs, TX | ▓▓▓▓░ 78% | 14 | 8 | 12 | 2h ago | ⋮ |
| ▢ | Account IT | Accounting & Tax | Boynton Beach, FL | ▓▓▓░░ 54% | 8 | 1 | 0 | 1d ago | ⋮ |

Sortable on every column. Sorting by completeness ascending is the "what needs work"
view; by updated descending is the "what did I just do" view. Checkboxes enable the bulk
actions below.

### Detail view — `/knowledge/view/[id]`

Reuses the build page's category accordion **exactly**, in read-only mode. One mental
model for both pages: the same section order, the same provenance badges, the same
"Not found" chips. Additions specific to detail view:

- Header: company name, website link, completeness ring, `Edit` / `Export` / `Delete`
- Version history rail — every save is a version; select two to diff
- `Re-scrape` — refetches the site and shows a field-level diff before applying

---

## Search and filtering

**Search** is a single input matching across company name, industry, alternative names,
locations, offering names, and people names — the things someone would actually recall.
Client-side over the loaded set; debounced 150ms.

**Filters** as chips, all multi-select and combinable:

| Filter | Options |
|---|---|
| Industry | Derived from the loaded set, not a fixed list |
| Completeness | Under 40% · 40–70% · Over 70% |
| Needs review | Has unreviewed fields · Has conflicts |
| Content | Has testimonials · Has offerings · Has people |
| Date | Created / updated within 7 / 30 / 90 days |

Active filters render as removable chips above the results with a "Clear all". The empty
state distinguishes *no records* ("Scrape your first site") from *no matches* ("No results
for 'plumbing' — clear filters").

---

## Actions

**Per record** (⋮ menu, and inline in detail view):

`Open` · `Edit` · `Duplicate as template` · `Export JSON` · `Re-scrape` · `Delete`

**Delete** uses the same reversible pattern as the build page: a 10-second undo toast, not
a confirmation dialog. Genuinely destructive because it removes version history, so the
toast is the only guard — but it's an unambiguous one.

**Bulk** (with rows checked in table view): `Export selected` · `Delete selected`.

### Utilities beyond the requirement (R14)

- **Export all** — one JSON file containing every knowledge base, for the submission
  artifact and as the migration path off the local store.
- **Duplicate as template** — clone a record with company-specific fields cleared, keeping
  structure and industry defaults. Useful for franchises and multi-location businesses,
  which the reference set shows are a real MoFlo segment.
- **Version history + diff** — every save writes an immutable version; the detail view
  diffs any two, field by field. This is what makes the Supabase versioning design (R27)
  a real feature rather than a schema drawing.
- **Re-scrape with diff** — the honest answer to the six-month drift problem
  ([`VALIDATION.md`](VALIDATION.md) §2): show what changed and let the user accept
  per-field rather than silently overwriting reviewed data.

---

## Responsive

| Breakpoint | Behaviour |
|---|---|
| ≥1280px | Cards 3-up; table shows all columns |
| 768–1279px | Cards 2-up; table drops Location and Proof |
| <768px | Cards 1-up; **table mode becomes a compact list** — a horizontally scrolling table is unusable on a phone, so the column set collapses to name + completeness + chevron |

Filters collapse into a bottom sheet under 768px, with the active count on the trigger.

---

## Data loading

The local JSON store means the full set can be loaded and filtered client-side, which
keeps search instant. That is a scale assumption, and it's stated in the README as a known
limitation: past a few hundred records this needs server-side pagination, which is the
point at which the Supabase adapter earns its place.

`GET /api/knowledge-bases` returns summaries only — the fields the card and table modes
need — rather than full knowledge bases. Detail view fetches the complete record by id.
Loading 14 offerings per record to render a count would be wasteful, and the split keeps
the list payload small enough that the client-side approach holds longer.
