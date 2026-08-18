# Screenshots

Captured from a production build (`npm run build && npx next start`) with headless Chromium at
2× device pixel ratio, against the knowledge bases in the local store.

| File | What it shows |
|---|---|
| [`01-scrape-page.png`](01-scrape-page.png) | `/knowledge` — the URL form and entry point |
| [`02-library-cards.png`](02-library-cards.png) | `/knowledge/view` — card mode, with completeness rings and review counts |
| [`03-library-table.png`](03-library-table.png) | Table mode — sortable on every column, bulk selection |
| [`04-library-filters.png`](04-library-filters.png) | The filter panel |
| [`05-detail.png`](05-detail.png) | Detail view — completeness rail, version history, categories |
| [`06-detail-full.png`](06-detail-full.png) | The same page, full height |
| [`07-editor.png`](07-editor.png) | **The review flow** — attention tier, conflicts with the page each candidate came from, and the save bar |
| [`08-editor-full.png`](08-editor-full.png) | The editor, full height |
| [`09-version-diff.png`](09-version-diff.png) | Comparing v1 with v2, field by field |
| [`10-mobile-library.png`](10-mobile-library.png) | The library at 375px |
| [`11-mobile-detail.png`](11-mobile-detail.png) | The detail view at 375px |

`07-editor.png` is the one to look at if you only look at one: the attention tier, the
four-candidate `yearFounded` conflict with each source page named, the completeness meter, and
a save button that reads `Save anyway (3 unchecked)` rather than blocking.

The scrape-in-progress state is not shown. The committed HTML fixtures are captured once and
never re-fetched (`docs/VALIDATION.md` §5) — these are eight real small businesses, and
re-crawling one for a screenshot isn't a good enough reason.
