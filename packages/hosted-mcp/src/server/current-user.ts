import type { createFetchClientFromKV } from "../http/umbraco-fetch-client.js";

/**
 * Fetches the current user from Umbraco's Management API.
 * Used to provide per-user tool filtering based on allowed sections, for the
 * main server's tools and for chained tools alike.
 */
export async function fetchCurrentUser(
  fetchClient: Awaited<ReturnType<typeof createFetchClientFromKV>> & {}
): Promise<Record<string, unknown>> {
  let user: Record<string, unknown> = {};
  try {
    const fetched = await fetchClient({
      url: "/umbraco/management/api/v1/user/current",
      method: "GET",
    });
    user = (fetched ?? {}) as Record<string, unknown>;
  } catch {
    // If we can't fetch the user, fall through to defaults. Tools that
    // gate on permissions will see empty arrays and refuse to expose
    // themselves; a definitively dead token fails server creation below.
  }
  // Guarantee the array-shaped fields downstream policy predicates iterate
  // over. Without this, every consumer has to guard with `?? []` against the
  // empty-object fallback above (and against partial responses).
  if (!Array.isArray(user.allowedSections)) user.allowedSections = [];
  if (!Array.isArray(user.userGroupIds)) user.userGroupIds = [];
  return user;
}
