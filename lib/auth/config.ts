/**
 * Whether authentication is configured, and the values it needs.
 *
 * The app has two modes and they are chosen by environment, not by a flag:
 * without these variables it runs on `LocalJsonAdapter` with no login at all,
 * which is what a fresh clone does. With them it runs on Postgres behind a
 * session. Nothing in between — see `lib/storage/index.ts`.
 */

export type AuthConfig = { url: string; anonKey: string };

export function authConfig(): AuthConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * True when the app should require a session.
 *
 * Both halves are needed: the auth keys say a user can sign in, and the
 * database URL says there is somewhere for their data to go. Having one without
 * the other is a misconfiguration rather than a mode, so it falls back to local
 * and says so rather than half-working.
 */
export function authEnabled(): boolean {
  return authConfig() !== null && Boolean(process.env.SUPABASE_DB_URL);
}
