import { authEnabled } from "@/lib/auth/config";
import { LocalJsonAdapter } from "./local-json";
import { SupabaseAdapter } from "./supabase/adapter";
import type { StorageAdapter } from "./types";

/**
 * The adapter the app uses, chosen here and nowhere else.
 *
 * `LocalJsonAdapter` is the default and stays the default: a fresh clone runs
 * with no credentials, no services and no login, which is the promise the
 * README makes. Supabase is opt-in, and opting in means setting the database
 * URL *and* the auth keys — no route, component or test above this line changes
 * either way.
 *
 * Both halves are required together on purpose. The keys say a person can sign
 * in; the database URL says there is somewhere for their data to go. One
 * without the other is a misconfiguration rather than a mode: a database with
 * no way to authenticate has no tenant to write into, and a login with no
 * database has nothing to protect.
 *
 * The tenant comes from the session, not the environment. `SUPABASE_ORG_ID` did
 * that job while there was no login, and keeping it afterwards would pin every
 * request to one organization no matter who was signed in — which is the exact
 * bug the multi-tenancy is built to prevent. Scripts still accept it, because a
 * script has no session; the app no longer reads it.
 *
 * Server-only: one touches the filesystem, the other holds a connection pool.
 */

function selectAdapter(): StorageAdapter {
  if (!authEnabled()) {
    const partial =
      Boolean(process.env.SUPABASE_DB_URL) !==
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (partial) {
      console.warn(
        "[storage] Supabase is half-configured — falling back to the local JSON store. " +
          "Set SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY together.",
      );
    }
    return new LocalJsonAdapter();
  }

  // The tenant resolver is imported at call time, not here. It reaches
  // `next/headers` through `lib/auth/server`, which only exists inside a
  // request — and a `require()` of it is worse than useless: `@supabase/ssr` is
  // ESM, and CommonJS-requiring it under Turbopack yields a namespace object
  // whose classes are not constructors, which fails at build rather than at
  // runtime. A dynamic `import()` is both correct and still lazy.
  return new SupabaseAdapter(async () => {
    const { sessionTenant } = await import("@/lib/auth/tenant");
    return sessionTenant();
  });
}

export const storage: StorageAdapter = selectAdapter();

/** True when the app is running on Postgres behind a login. */
export { authEnabled as storageRequiresAuth } from "@/lib/auth/config";

export { LocalJsonAdapter } from "./local-json";
export { toSummary } from "./types";
export type { SavedVersion, StorageAdapter } from "./types";
