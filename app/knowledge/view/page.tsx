import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Library } from "@/components/knowledge/library/library";

export const metadata: Metadata = {
  title: "Saved knowledge bases · MoKnowledge",
  description: "Browse, search, edit and export every knowledge base you've saved.",
};

/**
 * `/knowledge/view` — the library (R10–R14).
 *
 * A server component around one client island, the same shape as the scrape
 * page: the records are fetched in the browser because everything on this page —
 * search, filters, sorting, the held delete — is client state, and rendering the
 * first page on the server would only move the same fetch earlier by a few
 * milliseconds.
 */
export default function ViewPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-link uppercase">
            MoKnowledge
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">
            Saved knowledge bases
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            Everything you&apos;ve reviewed and saved. Search across companies,
            services and people, or sort by completeness to see what still needs
            work.
          </p>
        </div>
        <Link
          href="/knowledge"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
        >
          <Plus className="size-4" aria-hidden="true" />
          New scrape
        </Link>
      </header>

      <main>
        <Library />
      </main>
    </div>
  );
}
