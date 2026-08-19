import { readFileSync } from "node:fs";

/**
 * `next dev` loads `.env.local`; a bare tsx process does not.
 *
 * Shared by the scripts that talk to a live dependency (`ai:check`, `db:check`),
 * both of which are run by hand from a terminal rather than through Next.
 * Existing values win, so `SUPABASE_DB_URL=... npm run db:check` overrides the
 * file without editing it.
 */
export function loadEnv(...files: string[]): void {
  for (const file of files) {
    let contents: string;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of contents.split("\n")) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}
