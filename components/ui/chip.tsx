import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type ChipProps = {
  children: ReactNode;
  /** Renders a remove control. Omit for a read-only chip. */
  onRemove?: () => void;
  /** Used for the remove button's accessible name. */
  label?: string;
  className?: string;
};

export function Chip({ children, onRemove, label, className }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border",
        "bg-surface-raised py-1 pr-1 pl-2 text-sm text-ink",
        !onRemove && "pr-2",
        className,
      )}
    >
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label ?? String(children)}`}
          className="rounded p-0.5 text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

export function ChipList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>{children}</div>
  );
}
