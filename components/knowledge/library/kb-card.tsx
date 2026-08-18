"use client";

import { AlertTriangle, GitCompareArrows } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import { Card } from "@/components/ui";
import { CompletenessRing } from "./completeness-ring";
import { RecordMenu, type RecordActions } from "./record-menu";
import { displayName, relativeTime } from "@/lib/knowledge/library";
import type { KnowledgeBaseSummary } from "@/lib/schema";

/**
 * Card view — "which one is it?" (docs/VIEW-PAGE.md).
 *
 * The completeness ring carries the primary signal and the counts convey depth,
 * so a library of a dozen records can be scanned without reading. Cards with
 * unreviewed fields carry the warning line, which is what makes the library
 * double as a work queue.
 */
export const KbCard = memo(function KbCard({
  summary,
  actions,
  now,
}: {
  summary: KnowledgeBaseSummary;
  actions: RecordActions;
  /** Passed in so every row on a render agrees about what "2h ago" means. */
  now: Date;
}) {
  const name = displayName(summary);

  return (
    <Card className="relative flex flex-col gap-3 p-4 transition-colors hover:border-border-strong">
      <div className="flex items-start gap-3">
        <CompletenessRing value={summary.completeness} />

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-ink">
            {/* Stretched link: the whole card is clickable, but there is still
                exactly one link in the accessibility tree rather than one per
                line of text. */}
            <Link
              href={`/knowledge/view/${summary.id}`}
              className="after:absolute after:inset-0 hover:text-link"
            >
              {name}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-xs text-ink-subtle">
            {summary.industry ?? "Industry not found"}
          </p>
        </div>

        {/* Above the stretched link, or the menu would be unclickable. */}
        <div className="relative z-10 shrink-0">
          <RecordMenu summary={summary} actions={actions} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Logo url={summary.logoUrl} name={name} />
        <p className="min-w-0 flex-1 truncate text-sm text-ink-muted">
          {summary.location ?? "Location not found"}
        </p>
      </div>

      <div className="flex flex-col gap-1 text-xs text-ink-muted">
        <p>
          {count(summary.offeringsCount, "offering")} ·{" "}
          {count(summary.peopleCount, "person", "people")}
        </p>
        <p>
          {summary.testimonialsCount === 0
            ? "No testimonials"
            : count(summary.testimonialsCount, "testimonial")}
        </p>
      </div>

      {summary.attentionCount > 0 || summary.conflictCount > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-warn">
          {summary.attentionCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {count(summary.attentionCount, "field")} to review
            </span>
          ) : null}
          {summary.conflictCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <GitCompareArrows className="size-3.5" aria-hidden="true" />
              {count(summary.conflictCount, "conflict")}
            </span>
          ) : null}
        </div>
      ) : null}

      <p className="mt-auto border-t border-border pt-3 text-xs text-ink-subtle">
        Updated {relativeTime(summary.updatedAt, now)} · v{summary.version}
      </p>
    </Card>
  );
});

function count(value: number, singular: string, plural?: string): string {
  return `${value} ${value === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/**
 * The logo is a scraped URL on somebody else's domain, so `next/image` is out —
 * it would need every customer's host in `next.config.ts`. A broken or missing
 * logo hides itself rather than leaving a torn image icon on the card.
 */
function Logo({ url, name }: { url: string | null; name: string }) {
  if (!url) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`${name} logo`}
      loading="lazy"
      className="size-6 shrink-0 rounded object-contain"
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  );
}
