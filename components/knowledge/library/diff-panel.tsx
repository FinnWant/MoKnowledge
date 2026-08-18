"use client";

import { Minus, Pencil, Plus } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { diffLines, type ChangeKind, type FieldChange } from "@/lib/knowledge/diff";
import { CATEGORY_LABELS, type CategoryId } from "@/lib/schema";
import { cn } from "@/lib/utils/cn";

/**
 * Renders a field-level diff, for both places one appears: comparing two saved
 * versions, and reviewing what a re-scrape would change.
 *
 * The two differ only in whether the rows are selectable, so they are one
 * component. A diff that looked different in the two places would make the
 * re-scrape flow feel like a separate feature rather than the same question
 * asked about a different pair of documents.
 */

const KIND_META: Record<
  Exclude<ChangeKind, "unchanged">,
  { label: string; tone: "success" | "danger" | "warn"; icon: typeof Plus }
> = {
  added: { label: "New", tone: "success", icon: Plus },
  removed: { label: "Gone", tone: "danger", icon: Minus },
  changed: { label: "Changed", tone: "warn", icon: Pencil },
};

export function DiffPanel({
  changes,
  selected,
  onToggle,
  beforeLabel,
  afterLabel,
  emptyMessage = "Nothing changed.",
}: {
  changes: FieldChange[];
  /** Omit for a read-only diff; provide both to make the rows selectable. */
  selected?: Set<string>;
  onToggle?: (path: string) => void;
  beforeLabel: string;
  afterLabel: string;
  emptyMessage?: string;
}) {
  if (changes.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm text-ink-muted">{emptyMessage}</p>
      </Card>
    );
  }

  const byCategory = new Map<CategoryId, FieldChange[]>();
  for (const change of changes) {
    const list = byCategory.get(change.meta.category) ?? [];
    list.push(change);
    byCategory.set(change.meta.category, list);
  }

  return (
    <div className="flex flex-col gap-3">
      {[...byCategory.entries()].map(([category, entries]) => (
        <Card key={category} className="overflow-hidden">
          <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-ink">
            {CATEGORY_LABELS[category]}
          </h3>
          <ul className="flex flex-col">
            {entries.map((change) => (
              <ChangeRow
                key={change.meta.path}
                change={change}
                selected={selected?.has(change.meta.path) ?? false}
                onToggle={onToggle}
                beforeLabel={beforeLabel}
                afterLabel={afterLabel}
              />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function ChangeRow({
  change,
  selected,
  onToggle,
  beforeLabel,
  afterLabel,
}: {
  change: FieldChange;
  selected: boolean;
  onToggle?: (path: string) => void;
  beforeLabel: string;
  afterLabel: string;
}) {
  if (change.kind === "unchanged") return null;
  const meta = KIND_META[change.kind];
  const Icon = meta.icon;

  // A collection is read as which records moved, not as two lists side by side:
  // "14 offerings" against "15 offerings" hides the one line that matters.
  const collection = change.before.length > 1 || change.after.length > 1;

  return (
    <li className="border-t border-border px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        {onToggle ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(change.meta.path)}
            aria-label={`Apply the new ${change.meta.label.toLowerCase()}`}
            className="size-4 accent-primary"
          />
        ) : null}
        <span className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
          {change.meta.label}
        </span>
        <Badge tone={meta.tone} icon={<Icon className="size-3" aria-hidden="true" />}>
          {meta.label}
        </Badge>
        {/* A field the user set by hand is the one a re-scrape must not quietly
            reclaim, so it says so where the decision is being made. */}
        {change.current.method === "user-edited" ? (
          <Badge tone="info">You edited this</Badge>
        ) : null}
      </div>

      <div className="mt-2">
        {collection ? (
          <ul className="flex flex-col gap-0.5">
            {diffLines(change.before, change.after).map((line, index) => (
              <li
                key={`${line.status}-${line.text}-${index}`}
                className={cn(
                  "text-sm",
                  line.status === "added" && "text-success",
                  line.status === "removed" && "text-danger line-through",
                  line.status === "same" && "text-ink-subtle",
                )}
              >
                <span aria-hidden="true" className="mr-1.5 font-mono text-xs">
                  {line.status === "added" ? "+" : line.status === "removed" ? "−" : " "}
                </span>
                {line.text}
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <Side label={beforeLabel} lines={change.before} tone="before" />
            <Side label={afterLabel} lines={change.after} tone="after" />
          </div>
        )}
      </div>
    </li>
  );
}

function Side({
  label,
  lines,
  tone,
}: {
  label: string;
  lines: string[];
  tone: "before" | "after";
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-ink-subtle">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm break-words",
          lines.length === 0
            ? "text-ink-subtle italic"
            : tone === "before"
              ? "text-ink-muted"
              : "text-ink",
        )}
      >
        {lines.length === 0 ? "Not found" : lines.join(" · ")}
      </p>
    </div>
  );
}
