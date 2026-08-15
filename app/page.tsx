import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Placeholder landing page. At P4 this becomes a redirect to `/knowledge`, once
 * that route exists — redirecting to a 404 in the meantime would be worse than
 * saying plainly what is and isn't built.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div>
        <p className="text-xs font-medium tracking-wide text-link uppercase">
          MoKnowledge
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">
          Turn a company website into a knowledge base.
        </h1>
        <p className="mt-3 text-ink-muted">
          Paste a URL, get a structured profile you can review, correct, and
          save as JSON — with every value labelled by where it came from.
        </p>
      </div>

      <div className="rounded-card border border-border bg-surface p-4">
        <p className="text-sm font-medium text-ink">In development</p>
        <p className="mt-1 text-sm text-ink-muted">
          The schema and design system are built. The scrape page{" "}
          <code className="font-mono text-xs text-ink-subtle">/knowledge</code>{" "}
          and the library at{" "}
          <code className="font-mono text-xs text-ink-subtle">
            /knowledge/view
          </code>{" "}
          land in phases P4–P6 of{" "}
          <span className="font-mono text-xs text-ink-subtle">ROADMAP.md</span>.
        </p>
      </div>

      <Link
        href="/kit"
        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-link hover:text-ink"
      >
        View the design system
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </main>
  );
}
