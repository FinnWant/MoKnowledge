import { NextResponse } from "next/server";
import { authEnabled } from "@/lib/auth/config";
import { supabaseServer } from "@/lib/auth/server";

/**
 * `POST /auth/sign-out`
 *
 * POST rather than GET, and a form rather than a link: a GET that ends a
 * session gets fired by anything that prefetches links, which signs people out
 * by hovering.
 */
export async function POST(request: Request): Promise<Response> {
  if (authEnabled()) {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
