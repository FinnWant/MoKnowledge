import { withAuth } from "@/lib/auth/guard";
import { knowledgeBaseSchema } from "@/lib/schema";
import { storage } from "@/lib/storage";

/**
 * `GET /api/knowledge-bases`  — summaries for the library (R10).
 * `POST /api/knowledge-bases` — save a reviewed knowledge base (R5).
 *
 * A save is a new immutable version, whether the knowledge base is new or not,
 * so the id in the body is the identity and the version is the store's business.
 */

export const runtime = "nodejs";

async function handleGet(request: Request): Promise<Response> {
  const summaries = await storage.list();

  // `?full=1` is `Export all` (R14) — the migration path off the local store, and
  // the one case that legitimately wants every record whole. The default stays
  // summaries: rendering a grid of cards must never pull fourteen offerings per
  // row across the wire (docs/VIEW-PAGE.md §Data loading).
  if (new URL(request.url).searchParams.get("full") !== "1") {
    return Response.json({ knowledgeBases: summaries });
  }

  const full = await Promise.all(summaries.map((summary) => storage.get(summary.id)));
  return Response.json({
    exportedAt: new Date().toISOString(),
    knowledgeBases: full.filter((knowledgeBase) => knowledgeBase !== null),
  });
}

async function handlePost(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a knowledge base as JSON." }, { status: 400 });
  }

  // The same schema that validated the scrape validates the edit. A draft that
  // has been through eight editors and a reducer is user input again by the time
  // it comes back over the wire.
  const parsed = knowledgeBaseSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return Response.json(
      {
        error: "That knowledge base isn't in a shape we can save.",
        detail: issue ? `${issue.path.join(".")}: ${issue.message}` : undefined,
      },
      { status: 400 },
    );
  }

  try {
    const saved = await storage.save(parsed.data);
    return Response.json({ knowledgeBase: saved }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error: "We couldn't write that to the store.",
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: 500 },
    );
  }
}

export const GET = withAuth(handleGet);
export const POST = withAuth(handlePost);
