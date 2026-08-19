import { getPool } from "@/lib/storage/supabase/pool";
import type { TenantContext } from "@/lib/storage/supabase/tenant";
import { currentUser } from "./server";

/**
 * Which tenant the current request belongs to.
 *
 * This is the function `SUPABASE_ORG_ID` was standing in for. That variable
 * pinned every request to one organization, which was fine while there was no
 * session and wrong the moment there is one: with a login, the tenant is a
 * property of who is asking, not of the deployment.
 *
 * A user's memberships are read with the pool's own role rather than under RLS,
 * and deliberately: `is_member()` answers "is this user in that org", which is
 * not the question here. The question is "which orgs is this user in", asked
 * about a user we have just authenticated, and answering it under a policy that
 * needs the answer first is circular.
 */
export async function sessionTenant(): Promise<TenantContext> {
  const user = await currentUser();
  if (!user) {
    // Every caller sits behind middleware or an explicit check, so reaching
    // here means an access check was missed rather than that someone is
    // browsing anonymously. Failing loudly is correct.
    throw new UnauthenticatedError();
  }

  const organizationId = await organizationFor(user.id);
  if (!organizationId) {
    // `handle_new_user` gives every account a tenant at signup, so this means
    // the trigger did not run — an account created before it existed, or one
    // made directly in the dashboard.
    throw new Error(
      `Signed in as ${user.email ?? user.id} but that account belongs to no organization. ` +
        "It was probably created before the signup trigger existed.",
    );
  }

  return { organizationId, userId: user.id };
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

/**
 * The user's organization.
 *
 * One membership per user today. When a person can belong to several — an
 * agency contractor working across two accounts — this is where the active one
 * gets chosen, and the choice becomes a cookie rather than a query. The
 * `order by` keeps that day deterministic instead of arbitrary.
 */
export async function organizationFor(userId: string): Promise<string | null> {
  const { rows } = await getPool().query<{ organization_id: string }>(
    `select organization_id from organization_members
     where user_id = $1
     order by created_at asc
     limit 1`,
    [userId],
  );
  return rows[0]?.organization_id ?? null;
}
