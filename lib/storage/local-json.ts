import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { knowledgeBaseSchema, type KnowledgeBase, type KnowledgeBaseSummary } from "@/lib/schema";
import { toSummary, type SavedVersion, type StorageAdapter } from "./types";

/**
 * Knowledge bases as JSON files on disk.
 *
 *   data/knowledge-bases/<id>/meta.json   { currentVersion, createdAt, updatedAt }
 *   data/knowledge-bases/<id>/v1.json     immutable snapshot
 *   data/knowledge-bases/<id>/v2.json     …
 *
 * A directory per knowledge base with a file per version, rather than one file
 * that grows a `versions` array: a version is never rewritten once written, and
 * reading the current one never means parsing the history.
 *
 * Everything read back off disk goes through the zod schema. The store is a file
 * a human can edit, which makes it exactly as trustworthy as user input.
 */

const ROOT = path.join(process.cwd(), "data", "knowledge-bases");

/** Ids come from `crypto.randomUUID`; anything else is not addressing our store. */
const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

type Meta = {
  id: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
};

export class LocalJsonAdapter implements StorageAdapter {
  constructor(private readonly root: string = ROOT) {}

  async list(): Promise<KnowledgeBaseSummary[]> {
    const ids = await this.ids();
    const summaries: KnowledgeBaseSummary[] = [];

    for (const id of ids) {
      const knowledgeBase = await this.get(id);
      if (knowledgeBase) summaries.push(toSummary(knowledgeBase));
    }

    // Most recently touched first: the library's default order is "what I was
    // just working on".
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string, version?: number): Promise<KnowledgeBase | null> {
    if (!SAFE_ID.test(id)) return null;

    const meta = await this.meta(id);
    if (!meta) return null;

    const wanted = version ?? meta.currentVersion;
    const parsed = knowledgeBaseSchema.safeParse(
      await this.readJson(path.join(this.dir(id), `v${wanted}.json`)),
    );
    return parsed.success ? parsed.data : null;
  }

  async save(knowledgeBase: KnowledgeBase): Promise<KnowledgeBase> {
    if (!SAFE_ID.test(knowledgeBase.id)) {
      throw new Error(`Refusing to write a knowledge base with id "${knowledgeBase.id}"`);
    }

    const directory = this.dir(knowledgeBase.id);
    await mkdir(directory, { recursive: true });

    const existing = await this.meta(knowledgeBase.id);
    const version = (existing?.currentVersion ?? 0) + 1;
    const now = new Date().toISOString();

    const stored: KnowledgeBase = {
      ...knowledgeBase,
      version,
      createdAt: existing?.createdAt ?? knowledgeBase.createdAt,
      updatedAt: now,
    };

    // The snapshot goes down before the pointer moves. A crash between the two
    // leaves an orphan version file, which is recoverable; the reverse leaves a
    // pointer to a file that does not exist, which is not.
    await writeFile(
      path.join(directory, `v${version}.json`),
      `${JSON.stringify(stored, null, 2)}\n`,
      "utf8",
    );

    const meta: Meta = {
      id: stored.id,
      currentVersion: version,
      createdAt: stored.createdAt,
      updatedAt: now,
    };
    await writeFile(
      path.join(directory, "meta.json"),
      `${JSON.stringify(meta, null, 2)}\n`,
      "utf8",
    );

    return stored;
  }

  async remove(id: string): Promise<boolean> {
    if (!SAFE_ID.test(id)) return false;
    if (!(await this.meta(id))) return false;

    await rm(this.dir(id), { recursive: true, force: true });
    return true;
  }

  async versions(id: string): Promise<SavedVersion[]> {
    if (!SAFE_ID.test(id)) return [];

    let files: string[];
    try {
      files = await readdir(this.dir(id));
    } catch {
      return [];
    }

    type Snapshot = { version: number; savedAt: string; crawledAt: string | null };
    const snapshots: Snapshot[] = [];

    for (const file of files) {
      const match = file.match(/^v(\d+)\.json$/);
      if (!match) continue;

      const stored = (await this.readJson(path.join(this.dir(id), file))) as {
        updatedAt?: string;
        scrape?: { startedAt?: string };
      } | null;

      snapshots.push({
        version: Number(match[1]),
        savedAt: stored?.updatedAt ?? new Date(0).toISOString(),
        crawledAt: stored?.scrape?.startedAt ?? null,
      });
    }

    // Oldest first, so each version can be compared with the one it replaced.
    snapshots.sort((a, b) => a.version - b.version);

    // A re-scrape is not recorded anywhere as a flag — it doesn't need to be.
    // Editing keeps the crawl the knowledge base was built from; applying a
    // re-scrape brings the new crawl's metadata with it. A version whose crawl
    // differs from its predecessor's is therefore exactly a re-scraped one.
    return snapshots
      .map((snapshot, index) => {
        const previous = snapshots[index - 1];
        const rescraped =
          previous !== undefined &&
          snapshot.crawledAt !== null &&
          snapshot.crawledAt !== previous.crawledAt;

        return {
          version: snapshot.version,
          savedAt: snapshot.savedAt,
          ...(rescraped ? { rescraped: true } : {}),
        };
      })
      .reverse();
  }

  /* --------------------------------------------------------------- private */

  private dir(id: string): string {
    return path.join(this.root, id);
  }

  private async ids(): Promise<string[]> {
    try {
      const entries = await readdir(this.root, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      // No store yet is the normal state of a fresh clone, not an error.
      return [];
    }
  }

  private async meta(id: string): Promise<Meta | null> {
    const meta = (await this.readJson(path.join(this.dir(id), "meta.json"))) as Meta | null;
    return meta && typeof meta.currentVersion === "number" ? meta : null;
  }

  private async readJson(file: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      return null;
    }
  }
}
