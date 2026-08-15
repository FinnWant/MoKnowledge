import { cn } from "@/lib/utils/cn";

export type MeterProps = {
  /** 0–1. */
  value: number;
  label?: string;
  /** Hides the percentage text; the bar keeps its accessible name. */
  compact?: boolean;
  className?: string;
};

/**
 * Completeness bar. The *score* is shown because it is impact-weighted and
 * therefore meaningful (docs/DATA-QUALITY.md §5) — unlike per-field confidence,
 * which is deliberately never surfaced as a number.
 */
export function Meter({ value, label, compact = false, className }: MeterProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const tone =
    pct >= 75 ? "bg-success" : pct >= 40 ? "bg-primary" : "bg-warn";

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label || !compact ? (
        <div className="flex items-baseline justify-between gap-2">
          {label ? (
            <span className="text-xs font-medium text-ink-muted">{label}</span>
          ) : null}
          {!compact ? (
            <span className="text-xs tabular-nums text-ink-subtle">{pct}%</span>
          ) : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? "Completeness"}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", tone)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
