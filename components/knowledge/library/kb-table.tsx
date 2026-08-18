"use client";

import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import Link from "next/link";
import { Meter } from "@/components/ui";
import { RecordMenu, type RecordActions } from "./record-menu";
import {
  displayName,
  nextSort,
  relativeTime,
  type Sort,
  type SortKey,
} from "@/lib/knowledge/library";
import type { KnowledgeBaseSummary } from "@/lib/schema";
import { cn } from "@/lib/utils/cn";

/**
 * Table view — "which ones need attention?" (docs/VIEW-PAGE.md).
 *
 * Sortable on every column: ascending by completeness is the "what needs work"
 * view, descending by updated is "what did I just do". Below 768px it stops
 * being a table altogether — a horizontally scrolling table is unusable on a
 * phone, so the column set collapses to name, completeness and a chevron.
 */

type Column = {
  key: SortKey;
  label: string;
  /** Numeric columns right-align and sort descending on first click. */
  numeric?: boolean;
  /** Dropped between 768 and 1279px, where the table has to give up something. */
  wide?: boolean;
};

const COLUMNS: Column[] = [
  { key: "name", label: "Company" },
  { key: "completeness", label: "Complete" },
  { key: "offerings", label: "Offerings", numeric: true },
  { key: "people", label: "People", numeric: true },
  { key: "proof", label: "Proof", numeric: true, wide: true },
  { key: "updated", label: "Updated" },
];

export function KbTable({
  summaries,
  actions,
  sort,
  onSortChange,
  selected,
  onSelectedChange,
  now,
}: {
  summaries: KnowledgeBaseSummary[];
  actions: RecordActions;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
  selected: Set<string>;
  onSelectedChange: (selected: Set<string>) => void;
  now: Date;
}) {
  const allSelected = summaries.length > 0 && summaries.every((row) => selected.has(row.id));
  const someSelected = summaries.some((row) => selected.has(row.id));

  function toggleAll() {
    onSelectedChange(allSelected ? new Set() : new Set(summaries.map((row) => row.id)));
  }

  function toggleRow(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  }

  return (
    <>
      <div className="hidden overflow-hidden rounded-card border border-border md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Saved knowledge bases, sortable by every column
          </caption>
          <thead>
            <tr className="border-b border-border bg-surface">
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(node) => {
                    // Indeterminate is a property, not an attribute: a partial
                    // selection has to say so, or "select all" looks like "none".
                    if (node) node.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={toggleAll}
                  aria-label="Select all knowledge bases"
                  className="size-4 accent-primary"
                />
              </th>
              <th scope="col" className="hidden px-3 py-2 text-left font-medium text-ink-muted lg:table-cell">
                Version
              </th>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort(sort, column.key)}
                  className={cn(
                    "px-3 py-2 font-medium text-ink-muted",
                    column.numeric ? "text-right" : "text-left",
                    column.wide && "hidden xl:table-cell",
                  )}
                >
                  <SortButton column={column} sort={sort} onSortChange={onSortChange} />
                </th>
              ))}
              <th scope="col" className="hidden px-3 py-2 text-left xl:table-cell">
                <span className="font-medium text-ink-muted">Location</span>
              </th>
              <th scope="col" className="w-12 px-2 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((summary) => (
              <tr
                key={summary.id}
                className={cn(
                  "border-b border-border last:border-b-0 transition-colors hover:bg-surface",
                  selected.has(summary.id) && "bg-primary-soft/40",
                )}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(summary.id)}
                    onChange={() => toggleRow(summary.id)}
                    aria-label={`Select ${displayName(summary)}`}
                    className="size-4 accent-primary"
                  />
                </td>
                <td className="hidden px-3 py-2 lg:table-cell">
                  <span className="text-xs text-ink-subtle">v{summary.version}</span>
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/knowledge/view/${summary.id}`}
                    className="font-medium text-ink hover:text-link"
                  >
                    {displayName(summary)}
                  </Link>
                  <span className="block truncate text-xs text-ink-subtle">
                    {summary.industry ?? "Industry not found"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Meter
                    value={summary.completeness}
                    compact
                    className="w-24"
                    label={`${Math.round(summary.completeness * 100)}%`}
                  />
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  {summary.offeringsCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                  {summary.peopleCount}
                </td>
                <td className="hidden px-3 py-2 text-right tabular-nums text-ink-muted xl:table-cell">
                  {summary.testimonialsCount}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-subtle">
                  {relativeTime(summary.updatedAt, now)}
                </td>
                <td className="hidden max-w-48 truncate px-3 py-2 text-ink-subtle xl:table-cell">
                  {summary.location ?? "—"}
                </td>
                <td className="px-2 py-2">
                  <RecordMenu summary={summary} actions={actions} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CompactList summaries={summaries} now={now} />
    </>
  );
}

function ariaSort(sort: Sort, key: SortKey): "ascending" | "descending" | "none" {
  if (sort.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

function SortButton({
  column,
  sort,
  onSortChange,
}: {
  column: Column;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
}) {
  const active = sort.key === column.key;
  const Icon = !active ? ChevronsPlaceholder : sort.direction === "asc" ? ChevronUp : ChevronDown;

  return (
    <button
      type="button"
      onClick={() => onSortChange(nextSort(sort, column.key))}
      className={cn(
        "inline-flex items-center gap-1 rounded transition-colors hover:text-ink",
        column.numeric && "flex-row-reverse",
        active ? "text-ink" : "text-ink-muted",
      )}
    >
      {column.label}
      <Icon className="size-3.5" aria-hidden="true" />
    </button>
  );
}

/** A neutral marker on unsorted columns, so every header has the same height. */
function ChevronsPlaceholder({ className }: { className?: string }) {
  return <ChevronDown className={cn(className, "opacity-25")} aria-hidden="true" />;
}

/**
 * Under 768px. Not a table with fewer columns — a list, because the row is now
 * a link to the detail view rather than a comparison across columns.
 */
function CompactList({
  summaries,
  now,
}: {
  summaries: KnowledgeBaseSummary[];
  now: Date;
}) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-card border border-border md:hidden">
      {summaries.map((summary) => (
        <li key={summary.id} className="border-b border-border last:border-b-0">
          <Link
            href={`/knowledge/view/${summary.id}`}
            className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">
                {displayName(summary)}
              </p>
              <p className="truncate text-xs text-ink-subtle">
                {summary.industry ?? "Industry not found"} ·{" "}
                {relativeTime(summary.updatedAt, now)}
              </p>
            </div>
            <Meter
              value={summary.completeness}
              compact
              className="w-16 shrink-0"
              label={`${Math.round(summary.completeness * 100)}%`}
            />
            <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
