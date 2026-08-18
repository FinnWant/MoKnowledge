"use client";

import {
  ArrowLeft,
  Download,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Skeleton } from "@/components/ui";
import { CategorySection } from "../category-section";
import { CompletenessRail, RAIL_GRID } from "../completeness-rail";
import { KnowledgeEditor } from "../knowledge-editor";
import { CompletenessRing } from "./completeness-ring";
import { DiffPanel } from "./diff-panel";
import { RescrapePanel } from "./rescrape-panel";
import { VersionRail } from "./version-rail";
import { savedDraftKey } from "@/context/knowledge-draft";
import {
  downloadJson,
  fileNameFor,
  getKnowledgeBase,
  type LoadedKnowledgeBase,
} from "@/lib/knowledge/client";
import { changedOnly, diffKnowledgeBases, type FieldChange } from "@/lib/knowledge/diff";
import { categoryView, formatDuration, hostOf } from "@/lib/knowledge/display";
import { relativeTime } from "@/lib/knowledge/library";
import { CATEGORY_ORDER, type KnowledgeBase } from "@/lib/schema";

/**
 * `/knowledge/view/[id]` — one knowledge base in full (docs/VIEW-PAGE.md).
 *
 * The read-only body is the build page's category accordion, unchanged and in
 * read-only mode. That reuse is the point: one mental model for both pages, the
 * same section order, the same provenance badges, the same "Not found" chips —
 * so a reviewer who has used one already knows this one.
 */

type Mode = "read" | "edit" | "rescrape";

export function KnowledgeDetail({ id }: { id: string }) {
  const router = useRouter();

  const [loaded, setLoaded] = useState<LoadedKnowledgeBase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("read");

  /** Up to two versions: one to view, two to compare. */
  const [selection, setSelection] = useState<number[]>([]);
  const [viewing, setViewing] = useState<KnowledgeBase | null>(null);
  const [comparison, setComparison] = useState<{
    before: number;
    after: number;
    changes: FieldChange[];
  } | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);

  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const result = await getKnowledgeBase(id);
    if (result.ok) {
      setLoaded(result.value);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [id]);

  useEffect(() => {
    void load();
    setNow(new Date());
  }, [load]);

  // The library's ⋮ menu links straight into edit and re-scrape, so the mode is
  // in the URL rather than something the user has to find again on arrival.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("edit") === "1") setMode("edit");
    else if (params.get("rescrape") === "1") setMode("rescrape");
  }, []);

  /* ------------------------------------------------------------ versions */

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      setVersionError(null);

      if (selection.length === 0) {
        setViewing(null);
        setComparison(null);
        return;
      }

      if (selection.length === 1) {
        setComparison(null);
        const result = await getKnowledgeBase(id, selection[0]);
        if (cancelled) return;
        if (result.ok) setViewing(result.value.knowledgeBase);
        else setVersionError(result.error);
        return;
      }

      const [before, after] = [Math.min(...selection), Math.max(...selection)];
      const [olderResult, newerResult] = await Promise.all([
        getKnowledgeBase(id, before),
        getKnowledgeBase(id, after),
      ]);
      if (cancelled) return;

      if (!olderResult.ok) {
        setVersionError(olderResult.error);
        return;
      }
      if (!newerResult.ok) {
        setVersionError(newerResult.error);
        return;
      }

      setViewing(null);
      setComparison({
        before,
        after,
        changes: changedOnly(
          diffKnowledgeBases(olderResult.value.knowledgeBase, newerResult.value.knowledgeBase),
        ),
      });
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [id, selection]);

  function selectVersion(version: number) {
    setSelection((current) => {
      if (current.includes(version)) return current.filter((entry) => entry !== version);
      // A third pick replaces the older of the two, so comparing down a list
      // keeps working without having to clear it between pairs.
      return current.length < 2 ? [...current, version] : [current[1], version];
    });
  }

  /* -------------------------------------------------------------- render */

  if (error) {
    return (
      <Card accent="danger" className="p-4">
        <h2 className="text-sm font-semibold text-ink">
          We couldn&apos;t open that knowledge base
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{error}</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => void load()}>
            Try again
          </Button>
          <Link
            href="/knowledge/view"
            className="inline-flex h-8 items-center rounded-lg px-3 text-sm text-ink-muted hover:text-ink"
          >
            Back to the library
          </Link>
        </div>
      </Card>
    );
  }

  if (!loaded) return <DetailSkeleton />;

  const { knowledgeBase, versions } = loaded;
  const shown = viewing ?? knowledgeBase;
  const name = knowledgeBase.companyName.value ?? hostOf(knowledgeBase.sourceUrl);

  if (mode === "edit") {
    return (
      <KnowledgeEditor
        knowledgeBase={knowledgeBase}
        enrichment={null}
        exitLabel="Done editing"
        autosaveKey={savedDraftKey(id)}
        onReset={() => setMode("read")}
        onSaved={(saved) => {
          setLoaded((current) =>
            current ? { ...current, knowledgeBase: saved } : current,
          );
          // The version list gained an entry; the rail would otherwise still be
          // showing the history as it was when the page loaded.
          void load();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <CompletenessRing value={knowledgeBase.quality.overallScore} size={52} />
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-ink">{name}</h2>
              <a
                href={knowledgeBase.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm text-link hover:text-ink"
              >
                {hostOf(knowledgeBase.sourceUrl)}
              </a>
              <p className="mt-2 text-sm text-ink-muted">
                {knowledgeBase.scrape.pages.length}{" "}
                {knowledgeBase.scrape.pages.length === 1 ? "page" : "pages"} read in{" "}
                {formatDuration(knowledgeBase.scrape.durationMs)} · saved{" "}
                {relativeTime(knowledgeBase.updatedAt, now)} · version{" "}
                {knowledgeBase.version}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMode("edit")}
              iconLeft={<Pencil className="size-4" aria-hidden="true" />}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                downloadJson(knowledgeBase, fileNameFor(name))
              }
              iconLeft={<Download className="size-4" aria-hidden="true" />}
            >
              Export
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMode("rescrape")}
              iconLeft={<RefreshCw className="size-4" aria-hidden="true" />}
            >
              Re-scrape
            </Button>
            <Button
              size="sm"
              variant="danger"
              // Deleting from here hands the record back to the library, which
              // is where the ten-second undo lives. One delete path, one guard.
              onClick={() => router.push(`/knowledge/view?delete=${id}`)}
              iconLeft={<Trash2 className="size-4" aria-hidden="true" />}
            >
              Delete
            </Button>
          </div>
        </div>
      </Card>

      {mode === "rescrape" ? (
        <RescrapePanel
          current={knowledgeBase}
          onCancel={() => setMode("read")}
          onApplied={(saved) => {
            setMode("read");
            setSelection([]);
            setLoaded((current) =>
              current ? { ...current, knowledgeBase: saved } : current,
            );
            void load();
          }}
        />
      ) : (
        <div className={RAIL_GRID}>
          <div className="flex flex-col gap-4">
            <CompletenessRail quality={shown.quality} />
            <VersionRail
              versions={versions}
              viewing={shown.version}
              selection={selection}
              onSelect={selectVersion}
              onClear={() => setSelection([])}
              now={now}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            {versionError ? (
              <Card accent="danger" className="p-3">
                <p className="text-sm text-danger">{versionError}</p>
              </Card>
            ) : null}

            {comparison ? (
              <>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <p className="text-sm text-ink">
                    Comparing <Badge tone="muted">v{comparison.before}</Badge> with{" "}
                    <Badge tone="info">v{comparison.after}</Badge> —{" "}
                    {comparison.changes.length}{" "}
                    {comparison.changes.length === 1 ? "field" : "fields"} differ
                  </p>
                  <Button size="sm" variant="ghost" onClick={() => setSelection([])}>
                    Back to the current version
                  </Button>
                </Card>
                <DiffPanel
                  changes={comparison.changes}
                  beforeLabel={`v${comparison.before}`}
                  afterLabel={`v${comparison.after}`}
                  emptyMessage="These two versions hold the same values — the save recorded a review rather than a change."
                />
              </>
            ) : (
              <>
                {viewing && viewing.version !== knowledgeBase.version ? (
                  <Card accent="warn" className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <p className="text-sm text-ink">
                      Viewing version {viewing.version} of {knowledgeBase.version}.
                      This is a snapshot — editing always works on the current
                      version.
                    </p>
                    <Button size="sm" variant="ghost" onClick={() => setSelection([])}>
                      Back to current
                    </Button>
                  </Card>
                ) : null}

                {CATEGORY_ORDER.map((category, index) => (
                  <CategorySection
                    key={category}
                    view={categoryView(shown, category)}
                    defaultOpen={index === 0}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-start gap-3 p-4 sm:p-6">
        <Skeleton className="size-13 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-64" />
        </div>
      </Card>
      <div className={RAIL_GRID}>
        <Skeleton className="h-40" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-14" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Back link, rendered above the detail body by the page. */
export function BackToLibrary() {
  return (
    <Link
      href="/knowledge/view"
      className="inline-flex items-center gap-1.5 text-sm text-ink-subtle transition-colors hover:text-ink"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      All knowledge bases
    </Link>
  );
}
