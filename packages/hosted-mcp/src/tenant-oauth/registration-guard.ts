/**
 * Size limit on dynamic client registration (RFC 7591), applied before the
 * request reaches OAuthProvider. Registration is open to anyone, so each
 * request is bounded in size.
 *
 * There is deliberately no rate limit here. Cloudflare's Workers Rate
 * Limiting binding is approximate and eventually consistent, and at the
 * volume a registration endpoint sees it let most requests over the limit
 * through. Limit the rate in front of the Worker instead (for example a
 * WAF rate limiting rule on the registration paths).
 */

/** Largest registration body accepted. Real client metadata is a few hundred bytes. */
export const MAX_REGISTRATION_BODY_BYTES = 16 * 1024;

/**
 * Returns the response to send when a registration request must be refused,
 * or `null` when it may proceed.
 */
export async function guardRegistration(request: Request): Promise<Response | null> {
  if (request.method !== "POST") return null;

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REGISTRATION_BODY_BYTES) {
    return tooLarge();
  }
  // Content-Length can be absent or wrong: measure what was actually sent.
  const body = await request.clone().arrayBuffer();
  if (body.byteLength > MAX_REGISTRATION_BODY_BYTES) {
    return tooLarge();
  }

  return null;
}

function tooLarge(): Response {
  return new Response(
    JSON.stringify({
      error: "invalid_client_metadata",
      error_description: "Registration request is too large",
    }),
    { status: 413, headers: { "Content-Type": "application/json" } }
  );
}
