/**
 * Which paths need a session, and where it is safe to send someone afterwards.
 *
 * Both of these decide access, and both are the kind of one-line predicate that
 * looks obviously right and has a well-known way of being wrong — so they live
 * here with tests rather than inline in the middleware.
 */

/** Reachable without a session. */
const PUBLIC_PATHS = ["/login", "/auth"];

export function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  // Prefix matching has to respect segment boundaries: `/loginsomething` is not
  // under `/login`, and treating it as public would expose whatever is there.
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Where to go after signing in.
 *
 * The destination arrives in a query parameter, which means an attacker
 * controls it: a link to our own login page carrying
 * `?next=https://evil.example` would bounce the user off-site immediately after
 * they authenticate, with our domain in the referrer and their guard down.
 *
 * Only same-origin absolute paths are allowed through. `//evil.example` is the
 * case worth naming — the browser reads a protocol-relative URL as another
 * origin, and it starts with `/`, so the obvious check passes it.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/knowledge"): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.startsWith("//")) return fallback;
  // `/\evil.example` is treated as a protocol-relative URL by some browsers.
  if (next.startsWith("/\\")) return fallback;
  return next;
}
