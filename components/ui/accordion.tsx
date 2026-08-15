"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { cn } from "@/lib/utils/cn";

export type AccordionProps = {
  title: ReactNode;
  /** Right-aligned summary shown while collapsed: counts, status badges. */
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Provide with `onOpenChange` to drive the section from the left-rail nav. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
};

/**
 * Built on native `<details>`/`<summary>` rather than a div with `aria-expanded`.
 * Disclosure semantics, keyboard operation, and find-in-page all come for free,
 * and the section still expands if the client bundle fails to load — which matters
 * for a page whose whole job is displaying scraped content.
 */
export function Accordion({
  title,
  summary,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
  children,
}: AccordionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = open ?? uncontrolledOpen;

  function handleToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    const next = event.currentTarget.open;
    if (open === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  return (
    <details
      open={isOpen}
      onToggle={handleToggle}
      className={cn(
        "group rounded-card border border-border bg-surface",
        className,
      )}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 rounded-card px-4 py-3",
          "text-sm font-semibold text-ink marker:content-none",
          "hover:bg-surface-raised",
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-subtle transition-transform group-open:rotate-90"
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {summary ? (
          <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-ink-subtle">
            {summary}
          </span>
        ) : null}
      </summary>
      <div className="border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}
