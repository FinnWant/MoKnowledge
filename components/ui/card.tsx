import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type CardProps = {
  className?: string;
  children: ReactNode;
  /** Lifts the card off the page — used for the attention tier. */
  raised?: boolean;
  /** Left edge accent, matching the attention/conflict treatment. */
  accent?: "none" | "warn" | "danger" | "primary";
};

const ACCENTS = {
  none: "",
  warn: "border-l-2 border-l-warn",
  danger: "border-l-2 border-l-danger",
  primary: "border-l-2 border-l-primary",
} as const;

export function Card({
  className,
  children,
  raised = false,
  accent = "none",
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card border border-border",
        raised ? "bg-surface-raised" : "bg-surface",
        ACCENTS[accent],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink">{title}</div>
        {meta ? (
          <div className="mt-0.5 text-xs text-ink-subtle">{meta}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function CardBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("px-4 pb-4", className)}>{children}</div>;
}

export function CardFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-border px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
