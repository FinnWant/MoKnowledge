# MoKnowledge

A web app that scrapes a company website and turns it into a structured, reviewable,
editable knowledge base saved as JSON — built for the MoFlo SMB Knowledge assignment.

> **Status: in development.** Design is complete and the project is scaffolded. The
> scraper, UI, and storage layers are being built against [`ROADMAP.md`](ROADMAP.md).
> This README is expanded into the full submission write-up at phase P9.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

No API keys or external services are required to run the app.

| Script | Purpose |
|---|---|
| `npm run dev` | Development server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run ai:check` | One live enrichment call, to verify an API key works |
| `npm run examples` | Rebuild [`examples/`](examples/) from the committed fixtures (`-- --check` to verify they are current) |

**Optional — live AI enrichment.** Generated fields (overview, pitch, customer needs,
ideal persona) use a labelled mock generator by default. Set `ANTHROPIC_API_KEY` in
`.env.local` to execute the prompts in [`prompts/`](prompts/) against a real model
instead; the app degrades cleanly to mock output when the key is absent or the call
fails, and the UI distinguishes `AI draft` from `AI sample` either way.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables live enrichment. A standard API key from [console.anthropic.com](https://console.anthropic.com) |
| `ANTHROPIC_MODEL` | `claude-opus-5` | Any model on the account. Ids with a date suffix (`claude-haiku-4-5-20251001`) are fine |
| `ANTHROPIC_MAX_TOKENS` | `16000` | Raise if the enrichment report says `truncated` |
| `ANTHROPIC_TIMEOUT_MS` | `30000` | Per-call ceiling. Four prompts at one retry each fit inside the scrape route's 300s budget; raise it for a slower model and watch that arithmetic |

The request adapts to the model: adaptive thinking and `output_config.effort` are sent
only on 4.6-generation models and later, because earlier ones reject both with a 400
(`supportsReasoningControls` in [`lib/ai/client.ts`](lib/ai/client.ts)). Structured
output is used on every model.

Run `npm run ai:check` to make one live call and print the result. Enrichment fails
silently by design — a broken key still yields a knowledge base, with mock text clearly
badged — so this is the way to confirm it is actually on.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind CSS v4 · React 19 · zod · cheerio · Vitest

## Documentation

| Document | Contents |
|---|---|
| [`ROADMAP.md`](ROADMAP.md) | Requirements traceability, architecture, schema, phase plan |
| [`docs/SCHEMA-EXTENSIONS.md`](docs/SCHEMA-EXTENSIONS.md) | The beyond-baseline categories and why they exist |
| [`docs/DATA-QUALITY.md`](docs/DATA-QUALITY.md) | Handling incomplete data; turning gaps into questions |
| [`docs/EDIT-UX.md`](docs/EDIT-UX.md) | The review-and-edit flow |
| [`docs/VIEW-PAGE.md`](docs/VIEW-PAGE.md) | The library and detail views |
| [`docs/VALIDATION.md`](docs/VALIDATION.md) | Golden-set cross-reference methodology |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Production Postgres design — versioning, projections, RLS |
| [`docs/ENRICHMENT.md`](docs/ENRICHMENT.md) | Where the knowledge gaps are, and how we would close them |
| [`prompts/`](prompts/) | The four AI enrichment prompts and their conventions |
| [`examples/`](examples/) | Three complete knowledge bases, exactly as the app produces them |
| [`supabase/schema.sql`](supabase/schema.sql) | The DDL behind `docs/DATABASE.md` |

## Known issues

- **`npm audit` reports 3 high-severity advisories** in transitive dependencies of
  `next@15.5.23` (`postcss`, `sharp`). The only available fix is upgrading to Next 16,
  which the assignment's Next.js 15 requirement rules out. Left unpatched deliberately;
  neither advisory is reachable from this app's code paths.
