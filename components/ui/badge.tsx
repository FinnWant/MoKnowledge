import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warn"
  | "danger"
  | "muted";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-raised text-ink-muted border-border",
  info: "bg-primary-soft text-link border-primary/40",
  success: "bg-success-soft text-success border-success/30",
  warn: "bg-warn-soft text-warn border-warn/40",
  danger: "bg-danger-soft text-danger border-danger/30",
  muted: "bg-transparent text-ink-subtle border-border",
};

export type BadgeProps = {
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
  title?: string;
  children: ReactNode;
};

export function Badge({
  tone = "neutral",
  icon,
  className,
  title,
  children,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
