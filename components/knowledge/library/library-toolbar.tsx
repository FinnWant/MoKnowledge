"use client";

import { Download, LayoutGrid, Rows3, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import {
  activeFilterCount,
  type LibraryFilters,
  type Sort,
  type ViewMode,
} from "@/lib/knowledge/library";
import { cn } from "@/lib/utils/cn";

/** Debounce on the search box, so a filter pass doesn't run per keystroke. */
const SEARCH_DEBOUNCE_MS = 150;

export function LibraryToolbar({
  filters,
  onFiltersChange,
  mode,
  onModeChange,
  sort,
  onSortChange,
  filtersOpen,
  onFiltersOpenChange,
  onExportAll,
  exporting,
  resultCount,
  totalCount,
}: {
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (open: boolean) => void;
  onExportAll: () => void;
  exporting: boolean;
  resultCount: number;
  totalCount: number;
}) {
  const active = activeFilterCount(filters);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={filters.search}
          onChange={(search) => onFiltersChange({ ...filters, search })}
        />

        <Button
          size="sm"
          variant={filtersOpen ? "primary" : "secondary"}
          onClick={() => onFiltersOpenChange(!filtersOpen)}
          aria-expanded={filtersOpen}
          iconLeft={<SlidersHorizontal className="size-4" aria-hidden="true" />}
        >
          Filters
          {active > 0 ? (
            <span className="ml-1 rounded-full bg-surface px-1.5 text-xs tabular-nums text-ink">
              {active}
            </span>
          ) : null}
        </Button>

        {/* Card mode has no column headers to sort by, so the control lives here. */}
        {mode === "card" ? (
          <SortSelect sort={sort} onSortChange={onSortChange} />
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            loading={exporting}
            onClick={onExportAll}
            iconLeft={<Download className="size-4" aria-hidden="true" />}
          >
            <span className="hidden sm:inline">Export all</span>
            <span className="sm:hidden">Export</span>
          </Button>
          <ModeSwitcher mode={mode} onModeChange={onModeChange} />
        </div>
      </div>

      <p className="text-xs text-ink-subtle" aria-live="polite">
        {resultCount === totalCount
          ? `${totalCount} knowledge ${totalCount === 1 ? "base" : "bases"}`
          : `${resultCount} of ${totalCount} shown`}
      </p>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(value);

  // The parent owns the value — clearing a search chip has to empty the box.
  useEffect(() => setText(value), [value]);

  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onChange(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle"
        aria-hidden="true"
      />
      <input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Search companies, services, people…"
        aria-label="Search saved knowledge bases"
        className={cn(
          "h-8 w-full rounded-lg border border-border bg-surface-sunken pr-8 pl-9",
          "text-sm text-ink placeholder:text-ink-subtle",
          "transition-colors hover:border-border-strong focus:border-link focus:outline-none",
        )}
      />
      {text.length > 0 ? (
        <button
          type="button"
          onClick={() => setText("")}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-ink-subtle hover:text-ink"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

const SORT_OPTIONS: Array<{ value: string; label: string; sort: Sort }> = [
  { value: "updated-desc", label: "Recently updated", sort: { key: "updated", direction: "desc" } },
  { value: "created-desc", label: "Newest first", sort: { key: "created", direction: "desc" } },
  { value: "name-asc", label: "Company A–Z", sort: { key: "name", direction: "asc" } },
  {
    value: "completeness-asc",
    label: "Least complete",
    sort: { key: "completeness", direction: "asc" },
  },
  {
    value: "completeness-desc",
    label: "Most complete",
    sort: { key: "completeness", direction: "desc" },
  },
];

function SortSelect({
  sort,
  onSortChange,
}: {
  sort: Sort;
  onSortChange: (sort: Sort) => void;
}) {
  const value = `${sort.key}-${sort.direction}`;

  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-subtle">
      <span className="sr-only sm:not-sr-only">Sort</span>
      <select
        value={SORT_OPTIONS.some((option) => option.value === value) ? value : "updated-desc"}
        onChange={(event) => {
          const option = SORT_OPTIONS.find((entry) => entry.value === event.target.value);
          if (option) onSortChange(option.sort);
        }}
        className={cn(
          "h-8 rounded-lg border border-border bg-surface-raised px-2 text-sm text-ink",
          "transition-colors hover:border-border-strong focus:border-link focus:outline-none",
        )}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Two modes rather than three: `detail` is a page, not a layout, so putting it
 * in this switch would offer a mode with nothing selected to show.
 */
function ModeSwitcher({
  mode,
  onModeChange,
}: {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}) {
  const options = [
    { value: "card" as const, label: "Cards", icon: LayoutGrid },
    { value: "table" as const, label: "Table", icon: Rows3 },
  ];

  return (
    <div
      role="group"
      aria-label="View mode"
      className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onModeChange(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
              active
                ? "bg-surface-raised text-ink"
                : "text-ink-subtle hover:text-ink",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
