import { LocalJsonAdapter } from "./local-json";
import type { StorageAdapter } from "./types";

/**
 * The adapter the app uses, chosen here and nowhere else.
 *
 * `LocalJsonAdapter` is the default and stays the default: a fresh clone runs
 * with no credentials and no services, which is the promise the README makes.
 * Supabase is opt-in, and opting in is setting two environment variables —
 * no route, component or test above this line changes either way.
 *
 * Both variables are required together on purpose. `SUPABASE_DB_URL` alone says
 * where the database is but not which tenant to write to, and defaulting that
 * (to "the only organization", say) would be a guess that silently writes one
 * customer's knowledge bases into another's account the day there are two.
 *
 * Server-only: one touches the filesystem, the other holds a connection pool.
 */

function selectAdapter(): StorageAdapter {
  const configured = Boolean(process.env.SUPABASE_DB_URL && process.env.SUPABASE_ORG_ID);
  if (!configured) {
    if (process.env.SUPABASE_DB_URL && !process.env.SUPABASE_ORG_ID) {
      console.warn(
        "[storage] SUPABASE_DB_URL is set but SUPABASE_ORG_ID is not — " +
          "falling back to the local JSON store. Set both to use Supabase.",
      );
    }
    return new LocalJsonAdapter();
  }

  // Required lazily so a local-only run never loads `pg` or builds a pool.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SupabaseAdapter } = require("./supabase/adapter") as typeof import("./supabase/adapter");
  return new SupabaseAdapter();
}

export const storage: StorageAdapter = selectAdapter();

export { LocalJsonAdapter } from "./local-json";
export { toSummary } from "./types";
export type { SavedVersion, StorageAdapter } from "./types";
