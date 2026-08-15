import { cn } from "@/lib/utils/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded bg-surface-raised", className)}
    />
  );
}

/** Placeholder for a category section while a scrape is still running. */
export function SkeletonField({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}
