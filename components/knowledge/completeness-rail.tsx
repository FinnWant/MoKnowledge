import { Meter } from "@/components/ui";
import { sectionId } from "./category-section";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type CategoryId,
  type Quality,
} from "@/lib/schema";

/**
 * Completeness at a glance, plus jump navigation.
 *
 * The overall number is shown because it is impact-weighted and therefore means
 * something (docs/DATA-QUALITY.md §5); per-field confidence never is. One set of
 * markup serves both layouts from docs/EDIT-UX.md §9 — a sticky rail from 1024px
 * up, a horizontally scrolling row of the same items below it.
 */
/**
 * The layout class for a page that puts `CompletenessRail` beside its content.
 *
 * `grid-cols-1` is load-bearing below `lg`, not decoration. With no explicit
 * track the single column is implicit and sized to max-content, and a grid item
 * defaults to `min-width: auto` — so the `whitespace-nowrap` chips in the row
 * below made the column 1195px wide inside a 375px viewport and scrolled the
 * whole page sideways, instead of scrolling the chip row as intended. Spelling
 * the track as `repeat(1, minmax(0, 1fr))` lets the column shrink and hands the
 * overflow back to `overflow-x-auto`.
 *
 * Exported so the constraint lives next to the markup that causes it: a page
 * that lays the rail out by hand will reintroduce the bug.
 */
export const RAIL_GRID =
  "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]";

export function CompletenessRail({ quality }: { quality: Quality }) {
  const scores = new Map(
    quality.categoryScores.map((score) => [score.category as CategoryId, score]),
  );

  return (
    <nav
      aria-label="Knowledge base sections"
      className="flex flex-col gap-3 lg:sticky lg:top-4"
    >
      <div className="rounded-card border border-border bg-surface p-4">
        <Meter value={quality.overallScore} label="Completeness" />
        <p className="mt-2 text-xs text-ink-subtle">
          {quality.missingFields.length} of{" "}
          {quality.missingFields.length + filledCount(quality)} details still
          missing
        </p>
      </div>

      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {CATEGORY_ORDER.map((category) => {
          const score = scores.get(category);
          return (
            <li key={category} className="shrink-0 lg:shrink">
              <a
                href={`#${sectionId(category)}`}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink-muted transition-colors hover:border-border-strong hover:text-ink lg:border-transparent lg:bg-transparent lg:px-2 lg:py-1.5"
              >
                <span className="whitespace-nowrap">
                  {CATEGORY_LABELS[category]}
                </span>
                {score && score.needsAttention > 0 ? (
                  <span
                    aria-label={`${score.needsAttention} to check`}
                    className="size-1.5 shrink-0 rounded-full bg-warn"
                  />
                ) : null}
                <span className="ml-auto hidden text-xs tabular-nums text-ink-subtle lg:inline">
                  {score ? Math.round(score.score * 100) : 0}%
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Filled = every scored field minus the ones the scorer listed as missing. */
function filledCount(quality: Quality): number {
  const total = quality.categoryScores.reduce(
    (sum, score) => sum + score.totalFields,
    0,
  );
  return Math.max(0, total - quality.missingFields.length);
}
