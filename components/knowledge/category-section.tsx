"use client";

import { Accordion, Badge } from "@/components/ui";
import { EditableField } from "./editable-field";
import { FieldValue } from "./field-value";
import { ProvenanceBadge } from "./provenance-badge";
import {
  categorySummary,
  reviewFlag,
  sourceSummary,
  type CategoryView,
  type FieldView,
} from "@/lib/knowledge/display";
import { CATEGORY_LABELS, type CategoryId } from "@/lib/schema";

/** Anchor target for the left rail's jump links. */
export function sectionId(category: CategoryId): string {
  return `category-${category}`;
}

export function CategorySection({
  view,
  defaultOpen,
  editable = false,
}: {
  view: CategoryView;
  defaultOpen: boolean;
  /** Inside a draft provider, every field gets an editor — see docs/EDIT-UX.md §4. */
  editable?: boolean;
}) {
  return (
    <section id={sectionId(view.category)} className="scroll-mt-4">
      <Accordion
        defaultOpen={defaultOpen}
        title={CATEGORY_LABELS[view.category]}
        summary={
          <>
            {view.attentionCount > 0 ? (
              <Badge tone="warn">{view.attentionCount} to check</Badge>
            ) : null}
            <span className="tabular-nums">{categorySummary(view)}</span>
          </>
        }
      >
        {view.filled.length === 0 ? (
          <p className="text-sm text-ink-subtle">
            Nothing here came through the scrape. The list below is what we
            looked for.
          </p>
        ) : (
          <div className="flex flex-col">
            {view.filled.map((field) =>
              editable ? (
                <EditableField
                  key={field.meta.path}
                  meta={field.meta}
                  field={field.field}
                />
              ) : (
                <FieldRow key={field.meta.path} view={field} />
              ),
            )}
          </div>
        )}

        {view.missing.length > 0 ? (
          <MissingFields view={view} editable={editable} />
        ) : null}
      </Accordion>
    </section>
  );
}

function FieldRow({ view }: { view: FieldView }) {
  const { meta, field } = view;
  const flag = reviewFlag(field);
  // Where a value came from is worth a line only when we're asking the user to
  // look at it; on a confidently scraped field it's noise, and it stays in the
  // badge's tooltip.
  const sources = view.attention ? sourceSummary(field.sourceUrls) : null;

  return (
    <div className="border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
          {meta.label}
        </h4>
        <div className="flex shrink-0 items-center gap-1.5">
          {flag ? (
            <Badge tone="warn" title={flag.detail}>
              {flag.label}
            </Badge>
          ) : null}
          <ProvenanceBadge method={field.method} />
        </div>
      </div>

      <div className="mt-1.5">
        <FieldValue meta={meta} field={field} />
      </div>

      {sources ? (
        <p className="mt-1.5 text-xs text-ink-subtle">{sources}</p>
      ) : null}
    </div>
  );
}

/**
 * Gaps are shown, never hidden — docs/DATA-QUALITY.md §1. A field we looked for
 * and didn't find is information about the website, and in edit mode it is also
 * the cheapest thing on the page to improve, so each one gets an `Add`.
 */
function MissingFields({
  view,
  editable,
}: {
  view: CategoryView;
  editable: boolean;
}) {
  const count = view.missing.length;
  const heading = `We looked for ${count} more ${count === 1 ? "thing" : "things"} and couldn't find ${count === 1 ? "it" : "them"} on the site`;

  if (!editable) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-border p-3">
        <p className="text-xs text-ink-subtle">{heading}</p>
        {/* Not `Chip`: a gap is a different thing from a value, and it reads as
            one — muted, outlined, unfilled. */}
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {view.missing.map((entry) => (
            <li
              key={entry.meta.path}
              className="rounded-md border border-border px-2 py-1 text-sm text-ink-subtle"
            >
              {entry.meta.label}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <details className="group/missing mt-4 rounded-lg border border-dashed border-border">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-ink-subtle marker:content-none hover:text-ink">
        {heading} — add {count === 1 ? "it" : "them"} here
      </summary>
      <div className="flex flex-col px-3 pb-3">
        {view.missing.map((entry) => (
          <EditableField
            key={entry.meta.path}
            meta={entry.meta}
            field={entry.field}
          />
        ))}
      </div>
    </details>
  );
}
