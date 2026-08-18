import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCrawlResult } from "../fixtures/load";
import { GET as LIST, POST } from "@/app/api/knowledge-bases/route";
import { DELETE, GET } from "@/app/api/knowledge-bases/[id]/route";
import { LocalJsonAdapter, toSummary } from "@/lib/storage";
import type { KnowledgeBase } from "@/lib/schema";
import { buildKnowledgeBase } from "@/lib/scraper/pipeline";

/**
 * Persistence (R5, R20).
 *
 * The adapter is tested against a temporary directory rather than the app's
 * store, so the suite never writes into `data/`. The routes are tested for the
 * behaviour that does not touch disk — validation and 404s — because a route
 * test that saved would be testing the adapter a second time through a wire.
 */

const CLOCK = new Date("2026-02-13T00:00:00.000Z");

const scraped: KnowledgeBase = buildKnowledgeBase(
  loadCrawlResult("bee-cave-drilling"),
  { now: CLOCK, enrich: false },
).knowledgeBase;

let root: string;
let store: LocalJsonAdapter;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "moknowledge-store-"));
  store = new LocalJsonAdapter(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("LocalJsonAdapter", () => {
  it("starts empty on a fresh clone rather than failing", async () => {
    expect(await store.list()).toEqual([]);
    expect(await store.get("nothing-here")).toBeNull();
  });

  it("writes version 1, then a new version per save", async () => {
    const first = await store.save(scraped);
    expect(first.version).toBe(1);

    const second = await store.save({
      ...first,
      companyName: { ...first.companyName, value: "Renamed", method: "user-edited", confidence: 1 },
    });
    expect(second.version).toBe(2);

    // The earlier version is still readable: a save is a snapshot, not an
    // overwrite.
    expect((await store.get(first.id, 1))?.companyName.value).toBe(
      scraped.companyName.value,
    );
    expect((await store.get(first.id))?.companyName.value).toBe("Renamed");

    expect(await store.versions(first.id)).toEqual([
      { version: 2, savedAt: second.updatedAt },
      { version: 1, savedAt: first.updatedAt },
    ]);
  });

  it("keeps the original creation date across versions", async () => {
    const saved = await store.get(scraped.id);
    expect(saved?.createdAt).toBe(scraped.createdAt);
    expect(saved?.updatedAt).not.toBe(scraped.createdAt);
  });

  it("lists summaries rather than whole knowledge bases", async () => {
    const [summary] = await store.list();
    expect(summary).toEqual(toSummary((await store.get(scraped.id))!));
    expect(Object.keys(summary)).not.toContain("foundation");
  });

  it("refuses an id that could escape the store", async () => {
    await expect(store.save({ ...scraped, id: "../../etc" })).rejects.toThrow();
    expect(await store.get("../../etc/passwd")).toBeNull();
    expect(await store.remove("../../etc")).toBe(false);
  });

  it("returns null for a version file that isn't a knowledge base", async () => {
    const saved = await store.save({ ...scraped, id: "corrupted-kb" });
    await writeFile(path.join(root, saved.id, "v1.json"), "{}", "utf8");
    expect(await store.get("corrupted-kb")).toBeNull();
  });

  it("deletes, once", async () => {
    expect(await store.remove(scraped.id)).toBe(true);
    expect(await store.remove(scraped.id)).toBe(false);
    expect(await store.get(scraped.id)).toBeNull();
  });
});

/**
 * Version history (R14). `rescraped` is derived rather than stored: editing
 * keeps the crawl a knowledge base was built from, and applying a re-scrape
 * brings the new crawl's metadata across with the values — so a version whose
 * crawl differs from its predecessor's is exactly a re-scraped one.
 */
describe("marking which versions came from a new crawl", () => {
  it("flags only the version whose crawl changed", async () => {
    const id = "versioned-kb";
    const first = await store.save({ ...scraped, id });

    // An edit: same crawl, new values.
    const second = await store.save({
      ...first,
      companyName: { ...first.companyName, value: "Edited", method: "user-edited", confidence: 1 },
    });

    // A re-scrape: the crawl metadata comes across with the accepted values.
    await store.save({
      ...second,
      scrape: { ...second.scrape, startedAt: "2026-06-01T00:00:00.000Z" },
    });

    expect(await store.versions(id)).toEqual([
      { version: 3, savedAt: expect.any(String), rescraped: true },
      { version: 2, savedAt: expect.any(String) },
      { version: 1, savedAt: expect.any(String) },
    ]);
  });
});

describe("the save route", () => {
  const post = (body: unknown) =>
    POST(
      new Request("http://localhost/api/knowledge-bases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  it("rejects a body that isn't JSON", async () => {
    const response = await post("not json");
    expect(response.status).toBe(400);
  });

  it("rejects a knowledge base that fails the schema, and says where", async () => {
    const response = await post({ ...scraped, foundation: { ...scraped.foundation, phone: "0800" } });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string; detail?: string };
    expect(body.error).toMatch(/shape we can save/);
    expect(body.detail).toContain("foundation.phone");
  });

  it("lists summaries by default and whole records only when asked", async () => {
    const list = (await (
      await LIST(new Request("http://localhost/api/knowledge-bases"))
    ).json()) as Record<string, unknown>;
    const full = (await (
      await LIST(new Request("http://localhost/api/knowledge-bases?full=1"))
    ).json()) as Record<string, unknown>;

    expect(Array.isArray(list.knowledgeBases)).toBe(true);
    expect(list.exportedAt).toBeUndefined();
    // `Export all` is the one caller entitled to whole knowledge bases, and it
    // is stamped so the file says when it was taken.
    expect(typeof full.exportedAt).toBe("string");
  });

  it("404s for a knowledge base that was never saved", async () => {
    const params = Promise.resolve({ id: "does-not-exist" });
    const read = await GET(new Request("http://localhost/api/knowledge-bases/x"), { params });
    const deleted = await DELETE(new Request("http://localhost/api/knowledge-bases/x"), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });

    expect(read.status).toBe(404);
    expect(deleted.status).toBe(404);
  });
});
