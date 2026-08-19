import { withAuth } from "@/lib/auth/guard";
import { knowledgeBaseSchema } from "@/lib/schema";
import { storage } from "@/lib/storage";

/**
 * One saved knowledge base: read a version, save a new one, or delete it.
 *
 * `PATCH` is a full replacement rather than a partial merge — the client holds
 * the whole draft and a knowledge base is a snapshot, so merging halves of two
 * versions would produce a document neither the user nor the scraper wrote.
 */

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

async function handleGet(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  const requested = new URL(request.url).searchParams.get("version");
  const version = requested ? Number(requested) : undefined;

  if (version !== undefined && !Number.isInteger(version)) {
    return Response.json({ error: "`version` must be a whole number." }, { status: 400 });
  }

  const knowledgeBase = await storage.get(id, version);
  if (!knowledgeBase) return notFound();

  return Response.json({
    knowledgeBase,
    versions: await storage.versions(id),
  });
}

async function handlePatch(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!(await storage.get(id))) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send a knowledge base as JSON." }, { status: 400 });
  }

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

  if (parsed.data.id !== id) {
    return Response.json(
      { error: "The knowledge base in the body has a different id." },
      { status: 400 },
    );
  }

  return Response.json({ knowledgeBase: await storage.save(parsed.data) });
}

async function handleDelete(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  return (await storage.remove(id))
    ? Response.json({ deleted: id })
    : notFound();
}

function notFound(): Response {
  return Response.json({ error: "No knowledge base with that id." }, { status: 404 });
}

export const GET = withAuth(handleGet);
export const PATCH = withAuth(handlePatch);
export const DELETE = withAuth(handleDelete);
