# Edit UX Design

How a user reviews, edits, and enhances a scraped knowledge base before saving (R4).
Companion to [`../ROADMAP.md`](../ROADMAP.md) phases P4–P5.

---

## 1. The governing constraint

From the assignment brief:

> All of our customers are small businesses that are **very much non-technical and are not
> great with complex interfaces** or learning new technologies. We aim to **do as much for them
> as possible** rather than making them do everything within our platform.

This is a design instruction, not background colour, and it rules out the obvious solution.
A Bee Cave Drilling scrape produces ~60 scalar fields, 14 offerings, 8 people, a testimonial
list, and a FAQ set. Rendered as one long form, that is exactly the interface these customers
cannot use.

**The reframe: this is a draft to approve, not a form to fill.**

Everything arrives pre-filled and pre-accepted. The user's job is to skim, correct the few
things that are wrong, and hit save. A user who reads nothing and clicks `Save` must still get
a good knowledge base — the interface earns its keep by making the *exceptions* easy to find,
not by demanding attention on all 60 fields.

Three principles follow:

1. **Triage over enumeration.** Surface what needs attention; collapse what doesn't.
2. **One tap to accept, one tap to fix.** Never make someone type what they could confirm.
3. **Plain language.** No "provenance", no "confidence: 0.73", no "reconciliation conflict".

---

## 2. Information architecture

One page, priority-ordered — not a wizard, not tabs. A wizard would force a non-technical user
through categories they have no reason to visit; tabs hide the completeness picture.

```
┌────────────────────────────────────────────────────────────────────┐
│ MoKnowledge        beecavedrilling.com          [Preview JSON]     │
├──────────────┬─────────────────────────────────────────────────────┤
│ Completeness │  ⚠ Needs your attention (6)      [Accept all safe]  │
│  ▓▓▓▓▓▓░░ 72%│  ┌───────────────────────────────────────────────┐ │
│              │  │ Year founded                   Not fully sure │ │
│ ✓ Foundation │  │ 1980                                          │ │
│ ⚠ Positioning│  │ Found "since 1980" on the About page          │ │
│ ✓ Market     │  │           [Looks right]  [Edit]  [Remove]     │ │
│ ⚠ Branding   │  └───────────────────────────────────────────────┘ │
│ ✓ Online     │  ┌───────────────────────────────────────────────┐ │
│ ⚠ People  8  │  │ Phone number         We found 2 different ones│ │
│ ✓ Offerings14│  │  ◉ 512-273-7389        on the Contact page    │ │
│ ⚠ Proof      │  │  ○ 512-894-0055        in the footer          │ │
│ ✓ Content    │  │  ○ Something else…                            │ │
│              │  └───────────────────────────────────────────────┘ │
│              │                                                     │
│              │  ▸ Company Foundation        13 fields    ✓ ready   │
│              │  ▾ Key People                     8 people          │
│              │     ⠿ Jim Blair — no title         From website  ⋮  │
│              │     ⠿ Ethan — Technician           From website  ⋮  │
│              │     ⠿ Melanie — no title           From website  ⋮  │
│              │                              [+ Add a person]       │
│              │                                                     │
│              │  ▸ Missing information (9)   [Answer 6 questions]   │
├──────────────┴─────────────────────────────────────────────────────┤
│ 72% complete · 6 need review · 3 edits       [Preview]  [Save ▸]   │
└────────────────────────────────────────────────────────────────────┘
```

### The three tiers

| Tier | Contents | Default state |
|---|---|---|
| **Needs your attention** | Low confidence (<0.5), reconciler conflicts, AI-generated prose | Expanded, pinned to top |
| **Everything else** | High-confidence scraped values, grouped by category | Collapsed, with a per-category ✓ and count |
| **Missing information** | `not-found` fields, grouped, with the `quality` follow-up questions | Collapsed at the bottom |

The left rail is a jump nav plus status glance — ✓ ready, ⚠ needs attention, count of records.
On mobile it becomes a horizontally scrolling chip row under the header.

### `Accept all safe`

One button clears every attention item that is low-confidence-but-uncontested, leaving only
genuine conflicts and AI drafts. This is the single most important control on the page for the
target user: it takes the common case from "review 6 things" to "review 2 things."

---

## 3. Draft state model

```ts
type DraftState = {
  original: KnowledgeBase;              // scraper output, never mutated
  draft: KnowledgeBase;                 // what will be saved
  reviewed: Set<FieldPath>;             // explicitly accepted by the user
  dirty: Set<FieldPath>;                // changed from original
  removed: Map<FieldPath, unknown>;     // supports undo on delete
};
```

Keeping `original` intact is what makes per-field **Revert** possible, and it's also how we
know to flip `method` to `user-edited` only for fields that genuinely changed.

### Reducer actions

| Action | Effect |
|---|---|
| `SET_FIELD(path, value)` | Writes value; sets `method: 'user-edited'`, `confidence: 1` |
| `ACCEPT_FIELD(path)` | Marks reviewed without changing the value or its provenance |
| `RESOLVE_CONFLICT(path, choice)` | Picks a candidate; records the rejected ones in `note` |
| `REVERT_FIELD(path)` | Restores from `original` |
| `ADD_ITEM(path, item)` | Appends a record with `method: 'user-edited'` |
| `UPDATE_ITEM(path, id, patch)` | Patches one record's sub-fields |
| `REMOVE_ITEM(path, id)` | Removes, stashing into `removed` for undo |
| `REORDER(path, from, to)` | Moves a record |
| `ACCEPT_CATEGORY(category)` | Bulk-accepts every attention item in a category |
| `REGENERATE(path)` | Re-runs enrichment for one prose field |

Fields are addressed by typed path (`['people', 3, 'title']`), which keeps the reducer generic
across ~10 categories without a per-field case.

### Performance note

React Context re-renders every consumer on any state change, and Bee Cave's draft has 14
offerings each with a nested `features[]` array. Mitigations, decided now because they shape
the component API:

- **Split context** — `DraftStateContext` and `DraftDispatchContext` separately, so components
  that only dispatch never re-render on state changes.
- **Local-then-commit** — text inputs hold their own local state while focused and dispatch on
  blur or `Cmd/Ctrl+Enter`, so keystrokes never touch global state.
- **Memoized record cards** — each `RecordCard` receives only its own slice and is wrapped in
  `React.memo`.

---

## 4. Field editor taxonomy

Eight editors cover the entire schema. Deciding this up front is what stops the UI from
growing a bespoke component per field.

| Editor | Fields | Interaction |
|---|---|---|
| `TextField` | website, industry, yearFounded, legalEntityType, employeeCount, mainAddress | Click-to-edit inline; Enter commits, Esc cancels |
| `ProseField` | overview, pitch, businessModel, customerNeeds, idealPersona, foundingStory, writingStyle, artStyle | Auto-growing textarea + `Regenerate` action |
| `ChipListField` | serviceLocations, altNames, buyers, industryGroupings, channels, funnels, ctas, suppliers, fonts, themes | Chips with ×; type + Enter to add; **paste splits on commas** |
| `ColorField` | brand colors | Swatch + hex input + role label; add/remove |
| `LinkField` | socials, logos, press URLs | URL input with validation, favicon preview, open-in-new |
| `EnumField` | companyRole, offering category, credential kind | Select with free-text fallback |
| `NumberField` | employeeCount, revenue, ratingValue, reviewCount | Formatted, with unit |
| `RecordListField` | people, offerings, testimonials, faqs, posts, certifications, pressMentions | Collapsible cards — see below |

Paste-splitting on `ChipListField` matters more than it looks: the reference data shows
`Suppliers` with 13 entries and `CTAs` with 9. Nobody is typing those one at a time.

### `RecordListField` — the hard case

Collapsed rows show identity only; expand to edit.

```
┌──────────────────────────────────────────────────────┐
│ ⠿ Ethan — Technician                From website  ⋮ │
├──────────────────────────────────────────────────────┤
│ Name    [Ethan                                    ]  │
│ Title   [Technician                               ]  │
│ Gender  [Male ▾]                        Guessed  ⓘ  │
│ Bio     [An assigned technician praised by        ]  │
│         [customers for his expertise…             ]  │
│                                                      │
│ Related proof                                        │
│   "Ethan and his team solved our pump problem…"      │
│   — Testimonial from /reviews                        │
│                                                      │
│                            [Revert]      [Remove]    │
└──────────────────────────────────────────────────────┘
```

Decisions:
- **Reorder via ⠿ handle with keyboard up/down as the primary path.** Drag-and-drop is a
  usability trap on mobile and for non-technical users; the handle is a progressive enhancement.
- **Delete with an undo toast, not a confirm dialog.** Reversible beats interruptive, and it's
  one fewer decision for someone reviewing 14 offerings.
- **Related proof is displayed, not editable, here.** It shows the link between a person and the
  testimonial that produced them — the connection MoFlo's own output discarded (see
  [`SCHEMA-EXTENSIONS.md`](SCHEMA-EXTENSIONS.md)). Editing happens in the `proof` section.

---

## 5. Provenance and confidence, in plain language

Internal values map to human labels. The user never sees the schema's vocabulary.

| `method` | Badge | Popover detail |
|---|---|---|
| `scraped` | **From website** | "Found on the About page" + link |
| `derived` | **Calculated** | "Worked out from the site's styling" |
| `ai-live` | **AI draft** | "Written by AI from what we found. Please check it." |
| `ai-mock` | **AI sample** ⚠ | "Placeholder example — not real AI output." |
| `user-edited` | **You edited** | "Changed by you" + `Revert` |
| `not-found` | **Not found** | "We couldn't find this" + follow-up question |

Confidence is **never shown as a number**. It maps to presence in the attention tier and, at
most, a subtle dot. A non-technical user cannot act on `0.73`.

`ai-mock` gets a distinctly stronger visual treatment (amber, warning glyph) than `ai-live`.
The assignment requires mock outputs be "clearly labeled" — making the two visually
interchangeable would fail that requirement even though both are AI.

---

## 6. Conflict resolution

When the reconciler finds competing values, we ask instead of guessing — the choice is one tap,
and the alternative (silently picking one) discards information the user could have confirmed
in a second.

```
Phone number                          We found 2 different ones
  ◉ 512-273-7389      on the Contact page
  ○ 512-894-0055      in the footer
  ○ Something else…   [                    ]
```

The highest-precedence candidate is pre-selected, so accepting the default is a no-op. The
rejected values are preserved in the saved field's `note` rather than thrown away.

---

## 7. "Enhance" — the third verb in R4

The requirement is *review, **edit**, and **enhance***. Editing is correction; enhancement is
addition. Three affordances cover it:

1. **Add records** — `+ Add a person`, `+ Add an offering`, `+ Add a testimonial` on every
   `RecordListField`.
2. **Answer the gaps** — the `Missing information` section turns `quality.followUpQuestions`
   into a short guided form: *"We couldn't find your founding year. What year did you start?"*
   Answering writes straight into the field. This is the clearest expression of "do as much for
   them as possible" — the app tells the customer exactly what it needs instead of presenting
   an empty field labelled `yearFounded`.
3. **Regenerate prose** — on any AI field, with an optional steer ("make it warmer", "shorter").
   Uses the same prompt templates from `/prompts`, so it exercises the graded artifacts.

---

## 8. Save flow

- **Draft autosaves to `localStorage`** keyed by URL, so a refresh or accidental navigation
  never loses work. The explicit `Save` button remains, as required.
- **Sticky footer** persists: completeness meter · "N need review" · `Preview` · `Save`.
- **Preview JSON** opens a drawer with the exact object that will be written — this is what
  makes "converts the final knowledge base into a JSON structure" visible rather than implied,
  and it's a good screenshot for the submission.
- **Unsaved-changes guard** on route change and `beforeunload`.
- **Save is never blocked** by incomplete fields. A partial knowledge base is valuable, and
  hard-gating would punish exactly the sparse-site case that §2 of the roadmap says is normal.
  If items remain unreviewed, the button reads `Save anyway` with a quiet count.
- **Success state** offers: view in library · export JSON · scrape another site.

---

## 9. Responsive behaviour

| Breakpoint | Layout |
|---|---|
| ≥1024px | Two columns: sticky left rail (nav + completeness), content right; sticky footer bar |
| 768–1023px | Single column; rail collapses to a horizontal chip row under the header |
| <768px | Single column; attention tier first; record cards stack full-width; inline edit becomes full-width; footer bar stays pinned with `Save` and the count only |

At 375px the tightest element is the expanded `RecordCard` — sub-field labels move above their
inputs rather than beside them.

---

## 10. Accessibility

- Every editor is a real labelled control; click-to-edit is reachable via Enter and never
  keyboard-trapped (Esc always exits).
- Reorder works from the keyboard without touching the drag handle.
- Delete announces to a live region and moves focus to the undo toast.
- Attention items are a real list with a heading, so screen-reader users get the same triage
  the visual design provides.
- The `ai-mock` warning is conveyed by text, not colour alone.
- Contrast checked against the dark MoFlo palette — `#2663eb` on near-black needs verification
  at small text sizes and may need lightening for body copy.

---

## 11. Open questions, answered by building it (P5)

1. **Should `Regenerate` be available without an API key?** Not settled, because the control
   is not built. Two of the three "enhance" affordances ship — adding records, and answering
   the gap questions — and re-running one prompt for one field needs an enrichment endpoint
   that P5's deliverable list doesn't include. It stays on the list for a later phase.
2. **Undo depth.** As planned: per-field `Undo` restores from `original`, and a delete drops an
   undo toast for eight seconds. No global `Cmd+Z` stack.
3. **Does the attention tier re-sort live as items are accepted?** It compacts: an accepted item
   leaves the list immediately, the heading count updates, and a visually-hidden live region
   announces the new count. The planned collapse-in-place was cut — a confirmation that lingers
   in a list you are working down is a second thing to dismiss, and the count already says what
   happened. Conflicts sort above uncertain values, then by field impact.

### What building it changed

| Found | Fix |
|---|---|
| **`Accept all safe` had nothing to accept on a real scrape.** "Uncontested" was implemented as "no note", but the reconciler writes notes for two different things: a genuine disagreement, which always comes with a conflict record, and a caveat about one value ("social sharing image; may not be the logo") | Safe means *no unresolved conflict*. Bee Cave's three attention items go from zero acceptable to two |
| **`Add a products & service`, `Add a award`, `Add to press coverage`.** Turning a plural field label into a singular noun mechanically produces labels no customer should read | Each collection names itself: `Add a product or service`, `Add an award`, `Add a press mention` |
| **A gap could be seen but not filled.** The category view returned missing fields as metadata only, which is all a read-only page needs and half of what an editor needs | Missing fields carry their `Sourced` envelope too, so every gap is an `Add` in place, right under the category it belongs to |
| **The App Router has no route-change hook to guard.** `beforeunload` covers the tab closing and nothing else | A capturing click listener on links that leave the page, ignoring jump links and new-tab clicks — a guard that fired on the completeness rail would be worse than no guard |
