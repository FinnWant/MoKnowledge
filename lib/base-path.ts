/**
 * Serving the app under a sub-path (e.g. `https://example.com/moknowledge`).
 *
 * `next.config.ts` hands `NEXT_PUBLIC_BASE_PATH` to Next's `basePath`, which
 * covers `<Link>`, `router.push`, `redirect()` and middleware on its own. It does
 * not touch raw strings: a `fetch("/api/…")`, a plain `<a href>` or a form
 * `action` still goes to the domain root. Those go through `withBasePath`.
 *
 * Unset — the default — is the root, so `npm run dev` is unchanged. The value is
 * inlined at build time, so changing it means rebuilding.
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");

export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
