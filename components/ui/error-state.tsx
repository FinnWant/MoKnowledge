import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type ErrorStateProps = {
  icon?: ReactNode;
  title: string;
  /**
   * What went wrong and what the person can do about it. Never the exception
   * message: that is for `digest`, which a user can quote to us but does not
   * have to understand.
   */
  description?: string;
  action?: ReactNode;
  /**
   * Next.js's error digest. Rendered small and selectable rather than hidden —
   * it is the only handle anyone has on a server error whose real message was
   * stripped before it left the server.
   */
  digest?: string;
  className?: string;
};

/**
 * The failure counterpart to `EmptyState`.
 *
 * Solid border and a danger-tinted icon rather than the dashed border of an
 * empty state, because the two mean opposite things: an empty state is a normal
 * outcome the user can act on, and this is a promise the app failed to keep.
 * Making them look alike would train people to ignore both.
 */
export function ErrorState({
  icon,
  title,
  description,
  action,
  digest,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-border",
        "bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      {icon ? <div className="text-danger">{icon}</div> : null}
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {description ? (
          <p className="mt-1 max-w-md text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action}
      {digest ? (
        <p className="font-mono text-xs text-ink-subtle">
          Reference: <span className="select-all">{digest}</span>
        </p>
      ) : null}
    </div>
  );
}
