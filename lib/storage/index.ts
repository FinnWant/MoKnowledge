import { LocalJsonAdapter } from "./local-json";
import type { StorageAdapter } from "./types";

/**
 * The adapter the app uses.
 *
 * One module-level instance, chosen here and nowhere else — swapping in the
 * Supabase adapter documented in `docs/DATABASE.md` is a one-line change on the
 * next line, and no route or component has to know it happened.
 *
 * Server-only: it touches the filesystem.
 */
export const storage: StorageAdapter = new LocalJsonAdapter();

export { LocalJsonAdapter } from "./local-json";
export { toSummary } from "./types";
export type { SavedVersion, StorageAdapter } from "./types";
