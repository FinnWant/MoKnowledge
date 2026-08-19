"use client";

import { createBrowserClient } from "@supabase/ssr";

import { authConfig } from "./config";

/**
 * The browser-side auth client, used only by the sign-in form.
 *
 * `NEXT_PUBLIC_` values are inlined at build time, which is why the config is
 * read through a function rather than destructured at module scope — a missing
 * key should surface as a clear error in the one component that needs it, not
 * as an undefined at import time in every bundle that transitively includes it.
 */
export function supabaseBrowser() {
  const config = authConfig();
  if (!config) {
    throw new Error(
      "Supabase auth is not configured: NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.",
    );
  }
  return createBrowserClient(config.url, config.anonKey);
}
