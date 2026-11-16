/**
 * Limits on dynamic client registration (RFC 7591), applied before the
 * request reaches OAuthProvider.
 *
 * Registration is open to anyone, so each request is bounded in size, and a
 * deployment can bound the rate per caller by adding a Workers Rate Limiting
 * binding named `REGISTER_RATE_LIMITER`.
 */

import type { HostedMcpEnv } from "../types/env.js";

/** Largest registration body accepted. Real client metadata is a few hundred bytes. */
export const MAX_REGISTRATION_BODY_BYTES = 16 * 1024;

/**
 * Returns the response to send when a registration request must be refused,
 * or `null` when it may proceed.
 */
export async function guardRegistration(
  request: Request,
  env: HostedMcpEnv
): Promise<Response | null> {
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

  const limiter = env.REGISTER_RATE_LIMITER;
  if (limiter) {
    const key = request.headers.get("cf-connecting-ip") ?? "unknown";
    try {
      const { success } = await limiter.limit({ key });
      if (!success) {
        return jsonError(429, "too_many_requests", "Too many registration requests. Try again shortly.", {
          "Retry-After": "60",
        });
      }
    } catch (error) {
      // A limiter outage must not stop clients from connecting.
      console.warn("[mcp-hosted] registration rate limiter unavailable:", error);
    }
  }

  return null;
}

function tooLarge(): Response {
  return jsonError(413, "invalid_client_metadata", "Registration request is too large");
}

function jsonError(
  status: number,
  error: string,
  error_description: string,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ error, error_description }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
