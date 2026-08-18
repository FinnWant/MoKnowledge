import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { buttonClasses, ErrorState } from "@/components/ui";

/**
 * 404 (P8).
 *
 * The realistic way to land here is a stale or mistyped
 * `/knowledge/view/{id}` — a knowledge base that was deleted, or a link copied
 * from someone else's machine, since the local JSON store is per-checkout. So
 * the offer is the library rather than a bare "page not found": from there the
 * record either exists under a different id or visibly does not exist at all.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl items-center px-4 py-10 sm:px-6">
      <ErrorState
        className="w-full"
        icon={<FileQuestion className="size-6" aria-hidden="true" />}
        title="We couldn't find that page"
        description="The knowledge base may have been deleted, or the link may point at a record saved on another machine — the local store lives in this checkout."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/knowledge/view" className={buttonClasses("primary")}>Saved knowledge bases</Link>
            <Link href="/knowledge" className={buttonClasses("secondary")}>New scrape</Link>
          </div>
        }
      />
    </div>
  );
}
