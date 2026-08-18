import { cn } from "@/lib/utils/cn";

/**
 * The card's primary visual signal (docs/VIEW-PAGE.md §Card view).
 *
 * A ring rather than the `Meter` bar used elsewhere: a card is scanned in a grid
 * where the eye lands on shape before it reads text, and a ring reads at a
 * glance from across a 3-up layout in a way a 4px bar does not. Same thresholds
 * and same colours as `Meter`, so the two never disagree about what 62% means.
 */
export function CompletenessRing({
  value,
  size = 44,
  className,
}: {
  /** 0–1. */
  value: number;
  size?: number;
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone =
    pct >= 75 ? "text-success" : pct >= 40 ? "text-primary" : "text-warn";

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${pct}% complete`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-raised"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
          className={cn("stroke-current transition-[stroke-dashoffset]", tone)}
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-xs font-medium tabular-nums text-ink"
      >
        {pct}
      </span>
    </div>
  );
}
