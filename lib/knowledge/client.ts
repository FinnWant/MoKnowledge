import type { KnowledgeBase, KnowledgeBaseSummary } from "@/lib/schema";
import type { SavedVersion } from "@/lib/storage/types";

/**
 * The library's calls to the knowledge-base routes.
 *
 * One place rather than a `fetch` in each component, for the reason the rest of
 * the app returns `Result` instead of throwing: a failed load has to render as a
 * message with a retry, and a component that has to remember to catch is a
 * component that will eventually forget.
 */

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function request<T>(
  url: string,
  init: RequestInit | undefined,
  read: (body: Record<string, unknown>) => T | null,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, error: "We couldn't reach the server. Check that the app is still running." };
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON body is still a failure we can describe by status.
  }

  if (!response.ok) {
    const error = typeof body.error === "string" ? body.error : null;
    const detail = typeof body.detail === "string" ? body.detail : null;
    return {
      ok: false,
      error: [error ?? `The server returned an error (${response.status}).`, detail]
        .filter(Boolean)
        .join(" "),
    };
  }

  const value = read(body);
  if (value === null) {
    return { ok: false, error: "The server sent back something we couldn't read." };
  }
  return { ok: true, value };
}

export function listKnowledgeBases(): Promise<ApiResult<KnowledgeBaseSummary[]>> {
  return request("/api/knowledge-bases", { cache: "no-store" }, (body) =>
    Array.isArray(body.knowledgeBases) ? (body.knowledgeBases as KnowledgeBaseSummary[]) : null,
  );
}

export type LoadedKnowledgeBase = {
  knowledgeBase: KnowledgeBase;
  versions: SavedVersion[];
};

export function getKnowledgeBase(
  id: string,
  version?: number,
): Promise<ApiResult<LoadedKnowledgeBase>> {
  const query = version === undefined ? "" : `?version=${version}`;
  return request(`/api/knowledge-bases/${id}${query}`, { cache: "no-store" }, (body) =>
    body.knowledgeBase
      ? {
          knowledgeBase: body.knowledgeBase as KnowledgeBase,
          versions: Array.isArray(body.versions) ? (body.versions as SavedVersion[]) : [],
        }
      : null,
  );
}

/** A save is always a new immutable version, new record or not. */
export function saveKnowledgeBase(
  knowledgeBase: KnowledgeBase,
): Promise<ApiResult<KnowledgeBase>> {
  return request(
    "/api/knowledge-bases",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(knowledgeBase),
    },
    (body) => (body.knowledgeBase ? (body.knowledgeBase as KnowledgeBase) : null),
  );
}

export function deleteKnowledgeBase(id: string): Promise<ApiResult<string>> {
  return request(
    `/api/knowledge-bases/${id}`,
    { method: "DELETE" },
    (body) => (typeof body.deleted === "string" ? body.deleted : null),
  );
}

/**
 * Fired when a deferred delete has to go out during unload. `keepalive` is what
 * lets the request outlive the page; `sendBeacon` can't be used because it only
 * sends `POST`.
 */
export function deleteKnowledgeBaseOnUnload(id: string): void {
  try {
    void fetch(`/api/knowledge-bases/${id}`, { method: "DELETE", keepalive: true });
  } catch {
    // Nothing useful to do while the page is going away.
  }
}

export function exportAllKnowledgeBases(): Promise<ApiResult<KnowledgeBase[]>> {
  return request("/api/knowledge-bases?full=1", { cache: "no-store" }, (body) =>
    Array.isArray(body.knowledgeBases) ? (body.knowledgeBases as KnowledgeBase[]) : null,
  );
}

/* ---------------------------------------------------------------- download */

/** Filename stem from the company or its host: `bee-cave-drilling.json`. */
export function fileNameFor(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug.length > 0 ? slug : "knowledge-base"}.json`;
}

/** The browser's own save dialog — no round trip, the data is already here. */
export function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
