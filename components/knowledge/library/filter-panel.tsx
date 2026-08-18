"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui";
import {
  COMPLETENESS_LABELS,
  CONTENT_LABELS,
  DATE_WINDOWS,
  REVIEW_LABELS,
  activeFilterCount,
  industryFacets,
  toggle,
  type CompletenessBand,
  type ContentFilter,
  type LibraryFilters,
  type ReviewFilter,
} from "@/lib/knowledge/library";
import type { KnowledgeBaseSummary } from "@/lib/schema";
import { cn } from "@/lib/utils/cn";

/**
 * The filter groups (docs/VIEW-PAGE.md §Search and filtering).
 *
 * Every group is multi-select and they combine, so the panel is stateless — it
 * renders the filters it is given and hands back the ones the click produces.
 * Under 768px the same markup becomes a bottom sheet: a filter panel that eats
 * the top of a phone screen pushes the results it is meant to be filtering out
 * of sight.
 */
export function FilterPanel({
  summaries,
  filters,
  onChange,
  onClose,
}: {
  /** The unfiltered set: options have to keep their counts as filters narrow. */
  summaries: KnowledgeBaseSummary[];
  filters: LibraryFilters;
  onChange: (filters: LibraryFilters) => void;
  onClose: () => void;
}) {
  const industries = industryFacets(summaries);
  const active = activeFilterCount(filters);

  return (
    <>
      {/* Mobile only: the sheet needs something to dismiss against. */}
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-canvas/70 md:hidden"
      />

      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 max-h-[75dvh] overflow-y-auto",
          "rounded-t-card border-t border-border bg-surface p-4",
          "md:static md:z-auto md:max-h-none md:rounded-card md:border",
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Filters</h2>
          <div className="flex items-center gap-2">
            {active > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange({ ...filters, ...CLEARED })}
              >
                Clear all
              </Button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="rounded-lg p-1 text-ink-subtle transition-colors hover:bg-surface-raised hover:text-ink"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Group label="Industry">
            {industries.map((facet) => (
              <Toggle
                key={facet.value}
                pressed={filters.industries.includes(facet.value)}
                onClick={() =>
                  onChange({
                    ...filters,
                    industries: toggle(filters.industries, facet.value),
                  })
                }
              >
                {facet.value}
                <span className="ml-1 text-ink-subtle tabular-nums">{facet.count}</span>
              </Toggle>
            ))}
          </Group>

          <Group label="Completeness">
            {(Object.keys(COMPLETENESS_LABELS) as CompletenessBand[]).map((band) => (
              <Toggle
                key={band}
                pressed={filters.completeness.includes(band)}
                onClick={() =>
                  onChange({
                    ...filters,
                    completeness: toggle(filters.completeness, band),
                  })
                }
              >
                {COMPLETENESS_LABELS[band]}
              </Toggle>
            ))}
          </Group>

          <Group label="Needs review">
            {(Object.keys(REVIEW_LABELS) as ReviewFilter[]).map((flag) => (
              <Toggle
                key={flag}
                pressed={filters.review.includes(flag)}
                onClick={() =>
                  onChange({ ...filters, review: toggle(filters.review, flag) })
                }
              >
                {REVIEW_LABELS[flag]}
              </Toggle>
            ))}
          </Group>

          <div className="flex flex-col gap-4">
            <Group label="Content">
              {(Object.keys(CONTENT_LABELS) as ContentFilter[]).map((flag) => (
                <Toggle
                  key={flag}
                  pressed={filters.content.includes(flag)}
                  onClick={() =>
                    onChange({ ...filters, content: toggle(filters.content, flag) })
                  }
                >
                  {CONTENT_LABELS[flag]}
                </Toggle>
              ))}
            </Group>

            <Group label="Updated within">
              {DATE_WINDOWS.map((days) => (
                <Toggle
                  key={days}
                  pressed={filters.withinDays === days}
                  onClick={() =>
                    onChange({
                      ...filters,
                      withinDays: filters.withinDays === days ? null : days,
                    })
                  }
                >
                  {days} days
                </Toggle>
              ))}
            </Group>
          </div>
        </div>
      </div>
    </>
  );
}

/** Everything except the search box, which lives in the toolbar. */
const CLEARED = {
  industries: [],
  completeness: [],
  review: [],
  content: [],
  withinDays: null,
} satisfies Omit<LibraryFilters, "search">;

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs font-medium tracking-wide text-ink-subtle uppercase">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function Toggle({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 text-sm transition-colors",
        pressed
          ? "border-primary bg-primary-soft text-link"
          : "border-border text-ink-muted hover:border-border-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
