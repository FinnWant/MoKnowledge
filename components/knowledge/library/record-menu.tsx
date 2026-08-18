"use client";

import { Copy, Download, ExternalLink, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Menu } from "@/components/ui";
import { displayName } from "@/lib/knowledge/library";
import type { KnowledgeBaseSummary } from "@/lib/schema";

export type RecordActions = {
  onDuplicate: (summary: KnowledgeBaseSummary) => void;
  onExport: (summary: KnowledgeBaseSummary) => void;
  onDelete: (summary: KnowledgeBaseSummary) => void;
  /** Set while a duplicate or export for this record is in flight. */
  busy?: boolean;
};

/**
 * The `⋮` menu on a card or a table row (docs/VIEW-PAGE.md §Actions).
 *
 * Open, Edit and Re-scrape are navigations rather than work done here: all three
 * end up on the detail page, which is where the draft context, the editors and
 * the scrape stream already live. Duplicating a record into the library and
 * exporting it are the only two that belong to the list itself.
 */
export function RecordMenu({
  summary,
  actions,
}: {
  summary: KnowledgeBaseSummary;
  actions: RecordActions;
}) {
  const router = useRouter();
  const href = `/knowledge/view/${summary.id}`;

  return (
    <Menu
      label={`Actions for ${displayName(summary)}`}
      items={[
        {
          label: "Open",
          icon: <ExternalLink className="size-4" aria-hidden="true" />,
          onSelect: () => router.push(href),
        },
        {
          label: "Edit",
          icon: <Pencil className="size-4" aria-hidden="true" />,
          onSelect: () => router.push(`${href}?edit=1`),
        },
        {
          label: "Duplicate as template",
          icon: <Copy className="size-4" aria-hidden="true" />,
          disabled: actions.busy,
          onSelect: () => actions.onDuplicate(summary),
        },
        {
          label: "Export JSON",
          icon: <Download className="size-4" aria-hidden="true" />,
          disabled: actions.busy,
          onSelect: () => actions.onExport(summary),
        },
        {
          label: "Re-scrape",
          icon: <RefreshCw className="size-4" aria-hidden="true" />,
          onSelect: () => router.push(`${href}?rescrape=1`),
        },
        {
          label: "Delete",
          icon: <Trash2 className="size-4" aria-hidden="true" />,
          destructive: true,
          onSelect: () => actions.onDelete(summary),
        },
      ]}
    />
  );
}
