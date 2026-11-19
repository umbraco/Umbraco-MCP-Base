import type { createFetchClientFromKV } from "../http/umbraco-fetch-client.js";

/**
 * What a session start tells the caller when the Management API answered with
 * something that isn't the API (a sign-in page, say) rather than JSON.
 */
export const MANAGEMENT_API_BLOCKED_MESSAGE =
  "The Umbraco site returned a sign-in page instead of the Management API. Check whether the site restricts " +
  "access to `/umbraco/management/api` (basic authentication, IP restrictions or custom middleware). The MCP " +
  "server needs to reach it.";

/**
 * Thrown when a Management API request that should return a JSON object got
 * back a non-JSON body (the fetch client hands those over as a string) — e.g. a
 * `200` carrying an HTML sign-in page from basic auth, an IP restriction or
 * middleware in front of the site. The message is fixed on purpose: the body is
 * never included, since it can carry anti-forgery tokens and site names.
 */
export class ManagementApiBlockedError extends Error {
  constructor() {
    super(MANAGEMENT_API_BLOCKED_MESSAGE);
    this.name = "ManagementApiBlockedError";
  }
}

/** Throws `ManagementApiBlockedError` when `body` is not a parsed JSON object. */
export function assertManagementApiObject(body: unknown): void {
  if (typeof body === "string") throw new ManagementApiBlockedError();
}

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
    assertManagementApiObject(fetched);
    user = (fetched ?? {}) as Record<string, unknown>;
  } catch (err) {
    // Not a failed fetch: the site answered, but not with the API. Surface it.
    if (err instanceof ManagementApiBlockedError) throw err;
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
