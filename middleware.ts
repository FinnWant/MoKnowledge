import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isPublicPath } from "@/lib/auth/paths";

/**
 * Session refresh, and the gate in front of everything that touches storage.
 *
 * Two jobs, and the first is the unglamorous one that makes the second work.
 * Supabase access tokens are short-lived; without something refreshing them on
 * each request, a user is signed out mid-session and server components start
 * disagreeing with the browser about who is logged in. This runs on every
 * matched request and writes the refreshed cookie onto the response.
 *
 * The gate is deliberately in middleware rather than in each page: a route that
 * forgets to check is the normal way this goes wrong, and there are three of
 * them plus three API routes. Middleware makes the default "protected" and the
 * exceptions explicit.
 *
 * With no Supabase configured there is no login and nothing to protect — the
 * app is running on the local JSON store — so this passes everything through.
 * That is what keeps `git clone && npm run dev` working with no setup.
 */

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !process.env.SUPABASE_DB_URL) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        // Both sides: the request so anything downstream in this pass sees the
        // refreshed token, and the response so the browser keeps it.
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Must be `getUser`, not `getSession`: this decides access, and getSession
  // trusts the cookie without asking the auth server whether it is still valid.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    // An API call gets a status it can act on; a page gets sent to sign in with
    // somewhere to come back to.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    }
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/login";
    signIn.search = `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(signIn);
  }

  if (user && pathname === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/knowledge";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}

export const config = {
  // Everything except static assets. The session cookie has to be refreshed on
  // page loads as well as API calls, so this cannot be narrowed to /api.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
