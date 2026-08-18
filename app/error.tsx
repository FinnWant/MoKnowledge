"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClasses, ErrorState } from "@/components/ui";

/**
 * The boundary for everything under `app/` (P8).
 *
 * Without this, an exception thrown while rendering any page replaces the whole
 * app with Next's default screen — in production, an unstyled "Application
 * error" with no way back. Every route here is one thin server shell around one
 * client island, so a render error is almost always inside an island and this
 * boundary is what stands between that and a blank page.
 *
 * `reset()` re-renders the segment without a full reload, which is the right
 * first offer: most failures here are a bad response or a transient fetch, and
 * both survive a re-render. The link out exists because `reset()` cannot help
 * when the route itself is the problem.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server strips the message from production errors before they reach
    // the client, so the console is the only place the real one survives during
    // development — and in production this is what a reviewer would paste to us.
    console.error("Unhandled error in the knowledge app:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl items-center px-4 py-10 sm:px-6">
      <ErrorState
        className="w-full"
        icon={<AlertTriangle className="size-6" aria-hidden="true" />}
        title="Something went wrong on this page"
        description="Nothing you saved has been lost — knowledge bases are written as immutable versions, so the last saved one is intact. Try again, and if it keeps happening, start a new scrape."
        digest={error.digest}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" onClick={reset}>
              Try again
            </Button>
            <Link href="/knowledge/view" className={buttonClasses("secondary")}>Saved knowledge bases</Link>
          </div>
        }
      />
    </div>
  );
}
