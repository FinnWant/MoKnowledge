"use client";

import "./globals.css";

/**
 * The last boundary (P8).
 *
 * `app/error.tsx` is rendered *inside* the root layout, so it cannot catch a
 * failure in the layout itself. This one replaces the whole document, which is
 * why it has to supply its own `<html>` and `<body>`.
 *
 * Deliberately plain: no shared components, no icon library, no `next/link`. It
 * runs in the one situation where the app's own scaffolding is what broke, so
 * importing more of that scaffolding is how a fallback fails a second time. Only
 * the stylesheet is shared, and the markup below is legible without it.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <div className="mx-auto flex min-h-dvh max-w-3xl items-center px-4 py-10 sm:px-6">
          <div
            role="alert"
            className="w-full rounded-card border border-border bg-surface px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-ink">MoKnowledge failed to load</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
              Something broke before the page could render. Saved knowledge bases
              are files on disk and are unaffected.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
              >
                Reload
              </button>
              <a
                href="/knowledge"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface-raised px-4 text-sm font-medium text-ink transition-colors hover:border-border-strong"
              >
                Start again
              </a>
            </div>
            {error.digest ? (
              <p className="mt-4 font-mono text-xs text-ink-subtle">
                Reference: <span className="select-all">{error.digest}</span>
              </p>
            ) : null}
          </div>
        </div>
      </body>
    </html>
  );
}
