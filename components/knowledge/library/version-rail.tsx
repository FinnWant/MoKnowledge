"use client";

import { History } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { relativeTime } from "@/lib/knowledge/library";
import type { SavedVersion } from "@/lib/storage/types";
import { cn } from "@/lib/utils/cn";

/**
 * Version history (R14, R27).
 *
 * Every save writes an immutable version, so the history is real rather than a
 * schema drawing — this rail is what makes the versioning in the Supabase design
 * something a reviewer can click on. One click views a version; a second selects
 * a pair to compare.
 */
export function VersionRail({
  versions,
  viewing,
  selection,
  onSelect,
  onClear,
  now,
}: {
  versions: SavedVersion[];
  /** The version on screen. */
  viewing: number;
  /** Up to two, for the diff. */
  selection: number[];
  onSelect: (version: number) => void;
  onClear: () => void;
  now: Date;
}) {
  if (versions.length <= 1) {
    return (
      <Card className="p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <History className="size-4 text-ink-subtle" aria-hidden="true" />
          Version history
        </h2>
        <p className="mt-2 text-sm text-ink-subtle">
          This knowledge base has been saved once. Save it again after an edit
          and the two versions can be compared here.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <History className="size-4 text-ink-subtle" aria-hidden="true" />
          Version history
        </h2>
        {selection.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        ) : null}
      </div>

      <p className="px-4 pt-3 text-xs text-ink-subtle">
        {selection.length === 0
          ? "Pick a version to view it, or two to compare."
          : selection.length === 1
            ? "Pick a second version to compare."
            : `Comparing v${Math.min(...selection)} with v${Math.max(...selection)}.`}
      </p>

      <ul className="flex flex-col p-2">
        {versions.map((version, index) => {
          const picked = selection.includes(version.version);
          return (
            <li key={version.version}>
              <button
                type="button"
                aria-pressed={picked}
                onClick={() => onSelect(version.version)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                  picked
                    ? "bg-primary-soft text-ink"
                    : "text-ink-muted hover:bg-surface-raised hover:text-ink",
                )}
              >
                <span className="font-medium tabular-nums">v{version.version}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-subtle">
                  {relativeTime(version.savedAt, now)}
                </span>
                {index === 0 ? <Badge tone="muted">Current</Badge> : null}
                {version.version === viewing && index !== 0 ? (
                  <Badge tone="info">Viewing</Badge>
                ) : null}
                {version.rescraped ? <Badge tone="neutral">Re-scraped</Badge> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
