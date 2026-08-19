import { authEnabled } from "@/lib/auth/config";
import { currentUser } from "@/lib/auth/server";

/**
 * Who you are, and how to stop being them.
 *
 * Renders nothing at all without auth configured — on the local store there is
 * no account, and an empty "signed in as" would be a lie about how the app is
 * running.
 */
export async function AccountMenu() {
  if (!authEnabled()) return null;

  const user = await currentUser();
  if (!user) return null;

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="max-w-[18ch] truncate text-ink-subtle" title={user.email ?? undefined}>
        {user.email}
      </span>
      <form action="/auth/sign-out" method="post">
        <button
          type="submit"
          className="text-ink-subtle underline underline-offset-4 transition-colors hover:text-ink"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
