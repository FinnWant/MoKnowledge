import type { Metadata } from "next";
import { BackToLibrary, KnowledgeDetail } from "@/components/knowledge/library/detail";

export const metadata: Metadata = {
  title: "Knowledge base · MoKnowledge",
  description: "Everything captured for one company, with its version history.",
};

/**
 * `/knowledge/view/[id]` — detail view (R10, R13).
 *
 * The id is all the server contributes. Loading happens in the client island so
 * that editing, comparing versions and re-scraping can all replace what's on
 * screen without a round trip through the router.
 */
export default async function KnowledgeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <BackToLibrary />
      </header>

      <main>
        <KnowledgeDetail id={id} />
      </main>
    </div>
  );
}
