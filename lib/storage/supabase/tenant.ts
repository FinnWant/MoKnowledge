import { getPool, type PoolClient } from "./pool";

/**
 * Who is asking, and on whose behalf.
 *
 * Every table is scoped by `organization_id` and every policy keys off
 * `auth.uid()`, so no query in the adapter is answerable without this. It is a
 * resolver rather than a constructor argument because the answer is per-request
 * once there is a login, and constant before there is one.
 */
export type TenantContext = {
  organizationId: string;
  /**
   * The signed-in user, when there is one. Null means "no session" — the
   * pre-auth state the app is in today, and the service-role path afterwards.
   */
  userId: string | null;
};

export type TenantResolver = () => TenantContext | Promise<TenantContext>;

/**
 * The resolver used until authentication exists.
 *
 * `SUPABASE_ORG_ID` names the single tenant a self-hosted instance writes to.
 * When the signup flow in `handle_new_user()` is wired to a real login, this is
 * the one function that changes: it reads the session instead of the
 * environment, and everything below it already carries the tenant through.
 */
export function envTenant(): TenantContext {
  const organizationId = process.env.SUPABASE_ORG_ID;
  if (!organizationId) {
    throw new Error(
      "SUPABASE_ORG_ID is not set. Supabase persistence needs to know which " +
        "organization to write to; see README, 'Optional: Supabase persistence'.",
    );
  }
  return { organizationId, userId: process.env.SUPABASE_USER_ID ?? null };
}

/**
 * Runs `work` in one transaction, as the tenant.
 *
 * Two things happen here, and the second is the one worth explaining.
 *
 * **Everything is a transaction**, including reads. That is what makes
 * `set local` safe to use: the role and the JWT claim are scoped to the
 * transaction and unwind on commit, so a pooled connection can never be handed
 * to the next caller still wearing the last caller's identity.
 *
 * **The role is switched down when a user is known.** The connection string is
 * the `postgres` role, which has BYPASSRLS — connect with it and all 85
 * policies stop applying. Dropping to `authenticated` with the user's id as the
 * JWT subject means the database enforces tenant isolation even if a query in
 * this file forgets its `where organization_id`. Both belts are worn: every
 * query here is also explicitly scoped. Before there is a session there is no
 * uid to assume, so that path stays on the connecting role — and the explicit
 * scoping is the only thing standing between tenants, which is exactly why it
 * is not optional.
 */
export async function withTenant<T>(
  tenant: TenantContext,
  work: (client: PoolClient, tenant: TenantContext) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    if (tenant.userId) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: tenant.userId, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
    }

    const result = await work(client, tenant);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {
      // The connection is already broken; releasing it below is what matters.
    });
    throw error;
  } finally {
    client.release();
  }
}
