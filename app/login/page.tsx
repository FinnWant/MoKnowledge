import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authEnabled } from "@/lib/auth/config";
import { safeNextPath } from "@/lib/auth/paths";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · MoKnowledge" };

/**
 * The sign-in page exists only when there is something to sign in to.
 *
 * Running on the local JSON store there are no accounts and no tenants, so a
 * login form would be a dead end that implies the app has users. It redirects
 * to the tool instead.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!authEnabled()) redirect("/knowledge");

  const { next } = await searchParams;
  const destination = safeNextPath(next);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-10">
      <header>
        <p className="text-xs font-medium tracking-wide text-link uppercase">MoKnowledge</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">Sign in</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Knowledge bases are stored per workspace. Yours are visible only to your workspace.
        </p>
      </header>

      <SignInForm next={destination} />
    </main>
  );
}
