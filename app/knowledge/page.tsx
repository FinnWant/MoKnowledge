import { Library } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AccountMenu } from "@/components/auth/account-menu";
import { ScrapeWorkbench } from "@/components/knowledge/scrape-workbench";

export const metadata: Metadata = {
  title: "Build a knowledge base · MoKnowledge",
  description:
    "Paste a company website and get a structured, reviewable knowledge base.",
};

/**
 * `/knowledge` — the scrape page (R1, R3, R8).
 *
 * A server component that renders one client island. Nothing here needs data at
 * request time: the whole page is driven by a scrape the user starts. `async`
 * only so the account line can read the session; it renders nothing when the
 * app is on the local store.
 */
export default async function KnowledgePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-link uppercase">
            MoKnowledge
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">
            Turn a company website into a knowledge base
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted">
            We read the site, pull out everything a marketing tool would need to
            write in the company&apos;s voice, and show you where every value
            came from.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/knowledge/view"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium text-ink transition-colors hover:border-border-strong"
          >
            <Library className="size-4" aria-hidden="true" />
            Saved knowledge bases
          </Link>
          <Link
            href="/kit"
            className="text-sm text-ink-subtle transition-colors hover:text-ink"
          >
            Design system
          </Link>
          <AccountMenu />
        </div>
      </header>

      <main>
        <ScrapeWorkbench />
      </main>
    </div>
  );
}
