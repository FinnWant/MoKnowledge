"use client";

import { Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

/**
 * The reversible delete (docs/VIEW-PAGE.md §Actions).
 *
 * A toast rather than a confirmation dialog, for the same reason the build page
 * uses one: "are you sure" is a tax on every correct delete to catch the rare
 * wrong one, and an undo costs a single tap when they were.
 *
 * The countdown is shown because this undo is doing more work than the build
 * page's. Deleting a saved knowledge base takes its version history with it, so
 * the request is *held* for the length of the toast rather than sent and
 * reversed — which makes the remaining time the thing the user needs to know.
 */
export function DeleteToast({
  label,
  deadline,
  onUndo,
}: {
  label: string;
  /** Epoch ms at which the delete goes through. */
  deadline: number;
  onUndo: () => void;
}) {
  const [remaining, setRemaining] = useState(() => secondsUntil(deadline));

  useEffect(() => {
    setRemaining(secondsUntil(deadline));
    const timer = setInterval(() => setRemaining(secondsUntil(deadline)), 250);
    return () => clearInterval(timer);
  }, [deadline]);

  return (
    <div
      role="status"
      className={cn(
        "fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2",
        "items-center gap-3 rounded-card border border-border bg-surface-raised",
        "px-4 py-2.5 shadow-lg",
      )}
    >
      <span className="min-w-0 truncate text-sm text-ink">
        Deleting {label}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{remaining}s</span>
      <Button
        size="sm"
        variant="ghost"
        autoFocus
        onClick={onUndo}
        iconLeft={<Undo2 className="size-4" aria-hidden="true" />}
      >
        Undo
      </Button>
    </div>
  );
}

function secondsUntil(deadline: number): number {
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}
