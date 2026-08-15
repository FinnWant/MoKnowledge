import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  /** Say what happened and what to do next — never just "No data". */
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-dashed",
        "border-border px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="text-ink-subtle">{icon}</div> : null}
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {description ? (
          <p className="mt-1 max-w-sm text-sm text-ink-subtle">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
