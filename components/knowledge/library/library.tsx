"use client";

import { Download, FolderOpen, SearchX, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { DeleteToast } from "./delete-toast";
import { FilterPanel } from "./filter-panel";
import { KbCard } from "./kb-card";
import { KbTable } from "./kb-table";
import { LibraryToolbar } from "./library-toolbar";
import type { RecordActions } from "./record-menu";
import {
  deleteKnowledgeBase,
  deleteKnowledgeBaseOnUnload,
  downloadJson,
  exportAllKnowledgeBases,
  fileNameFor,
  getKnowledgeBase,
  listKnowledgeBases,
  saveKnowledgeBase,
} from "@/lib/knowledge/client";
import {
  DEFAULT_SORT,
  NO_FILTERS,
  activeFilterChips,
  activeFilterCount,
  displayName,
  duplicateAsTemplate,
  filterSummaries,
  isViewMode,
  sortSummaries,
  type LibraryFilters,
  type Sort,
  type ViewMode,
} from "@/lib/knowledge/library";
import type { KnowledgeBaseSummary } from "@/lib/schema";

/**
 * `/knowledge/view` — the library (R10–R15).
 *
 * Everything is loaded once and filtered in memory, which is the scale
 * assumption docs/VIEW-PAGE.md states outright and the README repeats as a known
 * limitation. It is what makes search instant on a local JSON store, and the
 * point it stops being true is the point the Supabase adapter earns its place.
 */

/** How long a delete is held before it goes through. */
const UNDO_MS = 10_000;

const MODE_STORAGE_KEY = "moknowledge:view-mode";

type Pending = { summaries: KnowledgeBaseSummary[]; deadline: number };

export function Library() {
  const [summaries, setSummaries] = useState<KnowledgeBaseSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [mode, setMode] = useState<ViewMode>("card");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [now, setNow] = useState(() => new Date());

  /* ------------------------------------------------------------ loading */

  const load = useCallback(async () => {
    const result = await listKnowledgeBases();
    if (result.ok) {
      setSummaries(result.value);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // "2h ago" going stale while the tab sits open is a small thing that makes the
  // page look broken. One tick a minute is enough and costs nothing.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  /* --------------------------------------------------------------- mode */

  // Read on mount rather than through `useSearchParams`, which would force the
  // whole page into a Suspense boundary for a value we only need in the browser.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("view");
    if (isViewMode(fromUrl)) {
      setMode(fromUrl);
      return;
    }
    const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
    if (isViewMode(stored)) setMode(stored);
  }, []);

  const changeMode = useCallback((next: ViewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // A disabled localStorage costs the preference, not the feature.
    }
    // `replaceState` rather than a router push: a view mode is not a place you
    // should have to press Back through, but it is worth having in a link.
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", url);
  }, []);

  /* ------------------------------------------------------- deferred delete */

  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((target: Pending) => {
    for (const summary of target.summaries) void deleteKnowledgeBase(summary.id);
  }, []);

  /** Sends a held delete now — when a second one arrives, or the page closes. */
  const flush = useCallback(
    (onUnload: boolean) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;

      const target = pendingRef.current;
      if (!target) return;
      pendingRef.current = null;

      if (onUnload) {
        for (const summary of target.summaries) deleteKnowledgeBaseOnUnload(summary.id);
      } else {
        commit(target);
        setPending(null);
      }
    },
    [commit],
  );

  useEffect(() => {
    const onBeforeUnload = () => flush(true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Navigating away is a decision to leave the delete standing. `keepalive`
      // is what lets the request outlive the page that started it.
      flush(true);
    };
  }, [flush]);

  const scheduleDelete = useCallback(
    (targets: KnowledgeBaseSummary[]) => {
      if (targets.length === 0) return;
      flush(false);

      const target: Pending = { summaries: targets, deadline: Date.now() + UNDO_MS };
      pendingRef.current = target;
      setPending(target);
      setNotice(null);

      const ids = new Set(targets.map((summary) => summary.id));
      setSummaries((current) => current?.filter((row) => !ids.has(row.id)) ?? current);
      setSelected((current) => new Set([...current].filter((id) => !ids.has(id))));

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (pendingRef.current !== target) return;
        pendingRef.current = null;
        commit(target);
        setPending(null);
      }, UNDO_MS);
    },
    [commit, flush],
  );

  /**
   * The detail page's Delete sends the record back here rather than deleting in
   * place, so there is one delete path and one guard: the toast below.
   */
  const [handedOff, setHandedOff] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const target = url.searchParams.get("delete");
    if (!target) return;

    setHandedOff(target);
    url.searchParams.delete("delete");
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    if (!handedOff || !summaries) return;
    const target = summaries.find((summary) => summary.id === handedOff);
    setHandedOff(null);
    if (target) scheduleDelete([target]);
  }, [handedOff, summaries, scheduleDelete]);

  const undoDelete = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;

    const target = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (!target) return;

    // Nothing left the server, so the records go straight back into the list.
    setSummaries((current) => (current ? [...current, ...target.summaries] : current));
  }, []);

  /* ------------------------------------------------------------- actions */

  const exportOne = useCallback(async (summary: KnowledgeBaseSummary) => {
    setBusy(true);
    const result = await getKnowledgeBase(summary.id);
    setBusy(false);

    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    downloadJson(result.value.knowledgeBase, fileNameFor(displayName(summary)));
  }, []);

  const duplicate = useCallback(
    async (summary: KnowledgeBaseSummary) => {
      setBusy(true);
      const loaded = await getKnowledgeBase(summary.id);
      if (!loaded.ok) {
        setBusy(false);
        setNotice(loaded.error);
        return;
      }

      const copy = duplicateAsTemplate(loaded.value.knowledgeBase, {
        id: crypto.randomUUID(),
      });
      const saved = await saveKnowledgeBase(copy);
      setBusy(false);

      if (!saved.ok) {
        setNotice(saved.error);
        return;
      }
      setNotice(`Created a template from ${displayName(summary)}.`);
      await load();
    },
    [load],
  );

  const exportAll = useCallback(async (ids?: Set<string>) => {
    setExporting(true);
    const result = await exportAllKnowledgeBases();
    setExporting(false);

    if (!result.ok) {
      setNotice(result.error);
      return;
    }

    const chosen = ids ? result.value.filter((kb) => ids.has(kb.id)) : result.value;
    downloadJson(
      { exportedAt: new Date().toISOString(), knowledgeBases: chosen },
      ids ? "moknowledge-selected.json" : "moknowledge-library.json",
    );
  }, []);

  const actions: RecordActions = useMemo(
    () => ({
      onDuplicate: (summary) => void duplicate(summary),
      onExport: (summary) => void exportOne(summary),
      onDelete: (summary) => scheduleDelete([summary]),
      busy,
    }),
    [busy, duplicate, exportOne, scheduleDelete],
  );

  /* -------------------------------------------------------------- render */

  const visible = useMemo(() => {
    if (!summaries) return [];
    return sortSummaries(filterSummaries(summaries, filters, now), sort);
  }, [summaries, filters, sort, now]);

  const chips = activeFilterChips(filters);
  const selectedVisible = visible.filter((summary) => selected.has(summary.id));

  if (loadError) {
    return (
      <Card accent="danger" className="p-4">
        <h2 className="text-sm font-semibold text-ink">We couldn&apos;t load your library</h2>
        <p className="mt-1 text-sm text-ink-muted">{loadError}</p>
        <Button size="sm" className="mt-3" onClick={() => void load()}>
          Try again
        </Button>
      </Card>
    );
  }

  if (!summaries) return <LoadingGrid />;

  return (
    <div className="flex flex-col gap-4">
      <LibraryToolbar
        filters={filters}
        onFiltersChange={setFilters}
        mode={mode}
        onModeChange={changeMode}
        sort={sort}
        onSortChange={setSort}
        filtersOpen={filtersOpen}
        onFiltersOpenChange={setFiltersOpen}
        onExportAll={() => void exportAll()}
        exporting={exporting}
        resultCount={visible.length}
        totalCount={summaries.length}
      />

      {filtersOpen ? (
        <FilterPanel
          summaries={summaries}
          filters={filters}
          onChange={setFilters}
          onClose={() => setFiltersOpen(false)}
        />
      ) : null}

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilters(chip.without)}
              className="rounded-md border border-primary bg-primary-soft px-2 py-1 text-xs text-link transition-colors hover:border-link"
            >
              {chip.label} ✕
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
            Clear all
          </Button>
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="text-sm text-ink-muted">
          {notice}
        </p>
      ) : null}

      {selectedVisible.length > 0 && mode === "table" ? (
        <BulkBar
          count={selectedVisible.length}
          exporting={exporting}
          onExport={() => void exportAll(new Set(selectedVisible.map((row) => row.id)))}
          onDelete={() => scheduleDelete(selectedVisible)}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      {visible.length === 0 ? (
        <LibraryEmpty
          hasRecords={summaries.length > 0}
          filtered={activeFilterCount(filters) > 0}
          onClear={() => setFilters(NO_FILTERS)}
        />
      ) : mode === "card" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((summary) => (
            <KbCard key={summary.id} summary={summary} actions={actions} now={now} />
          ))}
        </div>
      ) : (
        <KbTable
          summaries={visible}
          actions={actions}
          sort={sort}
          onSortChange={setSort}
          selected={selected}
          onSelectedChange={setSelected}
          now={now}
        />
      )}

      {pending ? (
        <DeleteToast
          label={
            pending.summaries.length === 1
              ? displayName(pending.summaries[0])
              : `${pending.summaries.length} knowledge bases`
          }
          deadline={pending.deadline}
          onUndo={undoDelete}
        />
      ) : null}
    </div>
  );
}

function BulkBar({
  count,
  exporting,
  onExport,
  onDelete,
  onClear,
}: {
  count: number;
  exporting: boolean;
  onExport: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <Card raised className="flex flex-wrap items-center gap-2 p-3">
      <span className="text-sm text-ink">
        {count} selected
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={exporting}
          onClick={onExport}
          iconLeft={<Download className="size-4" aria-hidden="true" />}
        >
          Export selected
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={onDelete}
          iconLeft={<Trash2 className="size-4" aria-hidden="true" />}
        >
          Delete selected
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </div>
    </Card>
  );
}

/**
 * An empty library and an over-filtered one are different problems with
 * different fixes, so they are different messages (docs/VIEW-PAGE.md).
 */
function LibraryEmpty({
  hasRecords,
  filtered,
  onClear,
}: {
  hasRecords: boolean;
  filtered: boolean;
  onClear: () => void;
}) {
  if (!hasRecords) {
    return (
      <EmptyState
        icon={<FolderOpen className="size-6" aria-hidden="true" />}
        title="No knowledge bases saved yet"
        description="Scrape a company website and save the result — it will show up here."
        action={
          <Link
            href="/knowledge"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            Scrape a site
          </Link>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<SearchX className="size-6" aria-hidden="true" />}
      title="Nothing matches those filters"
      description={
        filtered
          ? "Every saved knowledge base was filtered out. Clearing the filters brings them back."
          : "Try a shorter search — we match on company, industry, services and people."
      }
      action={
        filtered ? (
          <Button size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((key) => (
        <Card key={key} className="flex flex-col gap-3 p-4">
          <Skeleton className="h-11 w-11 rounded-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
        </Card>
      ))}
    </div>
  );
}
