import { UnauthenticatedError } from "./tenant";

/**
 * Turns a missing session into a 401 instead of a 500.
 *
 * The middleware already refuses unauthenticated requests to `/api/*`, so
 * reaching this means something got past it — a route added outside the
 * matcher, or a session that expired between that check and the query. Either
 * way the honest status is "sign in", not "we broke".
 *
 * Anything else is rethrown, so a real failure still looks like one. The access
 * decision stays in the middleware; this only makes the failure legible when
 * that decision is missed.
 *
 * Applied at the export rather than around each body, so adding it does not
 * reindent the handler it is protecting:
 *
 *     async function handleGet(request: Request) { … }
 *     export const GET = withAuth(handleGet);
 */
export function withAuth<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        return Response.json({ error: "Sign in to continue." }, { status: 401 });
      }
      throw error;
    }
  };
}
