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

**Optional — live AI enrichment.** Generated fields (overview, pitch, customer needs,
ideal persona) use a labelled mock generator by default. Set `ANTHROPIC_API_KEY` in
`.env.local` to execute the prompts in [`prompts/`](prompts/) against the real API
instead; the app degrades cleanly to mock output when the key is absent, and the UI
distinguishes `AI draft` from `AI sample` either way.

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
| [`prompts/`](prompts/) | The four AI enrichment prompts and their conventions |

## Known issues

- **`npm audit` reports 3 high-severity advisories** in transitive dependencies of
  `next@15.5.23` (`postcss`, `sharp`). The only available fix is upgrading to Next 16,
  which the assignment's Next.js 15 requirement rules out. Left unpatched deliberately;
  neither advisory is reachable from this app's code paths.
