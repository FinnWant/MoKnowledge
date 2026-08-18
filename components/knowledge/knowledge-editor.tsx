"use client";

import { AlertTriangle, Download, Info, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { AttentionTier } from "./attention-tier";
import { CategorySection } from "./category-section";
import { CompletenessRail, RAIL_GRID } from "./completeness-rail";
import { GapQuestions } from "./gap-questions";
import { SaveBar } from "./save-bar";
import {
  KnowledgeDraftProvider,
  useDraft,
  useDraftDispatch,
} from "@/context/knowledge-draft";
import { categoryView, formatDuration, hostOf } from "@/lib/knowledge/display";
import { lastRemoved } from "@/lib/knowledge/draft";
import type { EnrichmentReport } from "@/lib/ai/enrich";
import {
  CATEGORY_ORDER,
  type KnowledgeBase,
  type ScrapeWarning,
} from "@/lib/schema";

/**
 * The review page (R3, R4, R5).
 *
 * One page, priority-ordered: what needs attention, then the categories, then
 * the gaps — the information architecture from docs/EDIT-UX.md §2. Not a wizard
 * and not tabs, because a wizard walks a non-technical user through categories
 * they have no reason to visit and tabs hide the completeness picture.
 */
export function KnowledgeEditor({
  knowledgeBase,
  enrichment,
  onReset,
  exitLabel = "Scrape another site",
  autosaveKey,
  onSaved,
}: {
  knowledgeBase: KnowledgeBase;
  enrichment: EnrichmentReport | null;
  onReset: () => void;
  /** The library edits a saved record, where "scrape another site" is wrong. */
  exitLabel?: string;
  autosaveKey?: string;
  onSaved?: (saved: KnowledgeBase) => void;
}) {
  return (
    <KnowledgeDraftProvider knowledgeBase={knowledgeBase} autosaveKey={autosaveKey}>
      <EditorBody
        enrichment={enrichment}
        onReset={onReset}
        exitLabel={exitLabel}
        onSaved={onSaved}
      />
    </KnowledgeDraftProvider>
  );
}

function EditorBody({
  enrichment,
  onReset,
  exitLabel,
  onSaved,
}: {
  enrichment: EnrichmentReport | null;
  onReset: () => void;
  exitLabel: string;
  onSaved?: (saved: KnowledgeBase) => void;
}) {
  const state = useDraft();
  const kb = state.draft;
  const views = CATEGORY_ORDER.map((category) => categoryView(kb, category));
  const name = kb.companyName.value ?? hostOf(kb.sourceUrl);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-ink">{name}</h2>
            <a
              href={kb.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm text-link hover:text-ink"
            >
              {hostOf(kb.sourceUrl)}
            </a>
            <p className="mt-2 text-sm text-ink-muted">
              {kb.scrape.pages.length}{" "}
              {kb.scrape.pages.length === 1 ? "page" : "pages"} read in{" "}
              {formatDuration(kb.scrape.durationMs)} ·{" "}
              {kb.quality.missingFields.length} details still missing
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DownloadButton knowledgeBase={kb} />
            <Button
              variant="secondary"
              size="sm"
              onClick={onReset}
              iconLeft={<RotateCcw className="size-4" aria-hidden="true" />}
            >
              {exitLabel}
            </Button>
          </div>
        </div>
      </Card>

      {enrichment && !enrichment.apiKeyPresent ? <MockNotice /> : null}
      {kb.scrape.warnings.length > 0 ? (
        <WarningList warnings={kb.scrape.warnings} />
      ) : null}

      <AttentionTier />

      <div className={RAIL_GRID}>
        <CompletenessRail quality={kb.quality} />

        <div className="flex min-w-0 flex-col gap-3">
          {views.map((view, index) => (
            <CategorySection
              key={view.category}
              view={view}
              editable
              // Only the first section opens: docs/EDIT-UX.md §2 is explicit
              // that everything else collapses so the page stays skimmable.
              defaultOpen={index === 0}
            />
          ))}

          <GapQuestions />
        </div>
      </div>

      <SaveBar onSaved={onSaved} />
      <UndoToast />
    </div>
  );
}

/**
 * Delete is reversible rather than interruptive (docs/EDIT-UX.md §4). Somebody
 * reviewing fourteen offerings should not have to answer "are you sure"
 * fourteen times, and an undo costs one tap when they were.
 */
function UndoToast() {
  const state = useDraft();
  const dispatch = useDraftDispatch();
  const [dismissed, setDismissed] = useState(0);

  const removed = lastRemoved(state);
  const visible = removed !== null && state.removed.length > dismissed;

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setDismissed(state.removed.length), 8000);
    return () => clearTimeout(timer);
  }, [visible, state.removed.length]);

  if (!visible || !removed) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-card border border-border bg-surface-raised px-4 py-2.5 shadow-lg"
    >
      <span className="text-sm text-ink">Removed {removed.label}</span>
      <Button
        size="sm"
        variant="ghost"
        autoFocus
        onClick={() => dispatch({ type: "UNDO_REMOVE" })}
        iconLeft={<Undo2 className="size-4" aria-hidden="true" />}
      >
        Undo
      </Button>
    </div>
  );
}

/**
 * The knowledge base as a file, without a round-trip to the server — the honest
 * "here is the JSON" that the scrape itself produces (R7).
 */
function DownloadButton({ knowledgeBase }: { knowledgeBase: KnowledgeBase }) {
  function download() {
    const blob = new Blob([JSON.stringify(knowledgeBase, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${hostOf(knowledgeBase.sourceUrl).replace(/[^a-z0-9]+/gi, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={download}
      iconLeft={<Download className="size-4" aria-hidden="true" />}
    >
      Download JSON
    </Button>
  );
}

/**
 * Required by the brief: placeholder output must be unmistakable. The per-field
 * `AI sample` badge says it too, but a reviewer scanning the page deserves to
 * know before they read a single generated sentence.
 */
function MockNotice() {
  return (
    <Card accent="warn" className="flex items-start gap-3 p-4">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-ink">
          The written summaries are placeholder samples
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          No AI key is configured, so anything badged{" "}
          <Badge tone="warn">AI sample</Badge> was assembled from the scraped
          text by a stand-in generator rather than written by a model. Everything
          badged <Badge tone="neutral">From website</Badge> came off the site
          itself.
        </p>
      </div>
    </Card>
  );
}

function WarningList({ warnings }: { warnings: ScrapeWarning[] }) {
  return (
    <Card className="p-4">
      <h3 className="text-sm font-medium text-ink">
        What we couldn&apos;t read
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {warnings.map((warning) => (
          <li
            key={`${warning.code}-${warning.message}`}
            className="flex items-start gap-2 text-sm text-ink-muted"
          >
            <Info className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            <span>
              {warning.message}
              {warning.url ? (
                <span className="ml-1 font-mono text-xs text-ink-subtle">
                  {warning.url}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
