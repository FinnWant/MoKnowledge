import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { authConfig } from "./config";

/**
 * The Supabase client for server components, route handlers and actions.
 *
 * It exists to do one thing — read and refresh the session cookie. Data access
 * does not go through it: the adapter talks to Postgres over the `pg` pool and
 * carries the user's id into the transaction itself (`withTenant`). Keeping
 * those separate means the anon key never touches the storage path, and the
 * query layer stays plain SQL rather than PostgREST.
 */
export async function supabaseServer() {
  const config = authConfig();
  if (!config) throw new Error("Supabase auth is not configured");

  const store = await cookies();

  return createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) {
            store.set(name, value, options);
          }
        } catch {
          // Server components cannot set cookies. The middleware refreshes the
          // session on every request, so the write here is redundant rather
          // than load-bearing — throwing would break every page that reads a
          // user.
        }
      },
    },
  });
}

/** The signed-in user, or null. Never throws for "not signed in". */
export async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await supabaseServer();
  // `getUser` revalidates against the auth server rather than trusting the
  // cookie's contents, which is the difference that matters for anything used
  // to make an access decision.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}
