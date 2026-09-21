/**
 * Umbraco Fetch Client
 *
 * A fetch-based API client for the Cloudflare Workers runtime.
 *
 * Returns responses matching the HttpResponse interface from the SDK,
 * compatible with api-call-helpers' validation logic.
 */

import { normalizeBaseUrl, type HttpResponse } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import {
  getStoredUmbracoToken,
  refreshUmbracoToken,
  type RefreshFailure,
  type StoredSiteContext,
} from "../auth/token-storage.js";
import { logAuth } from "../auth/log.js";

/**
 * Options for the fetch-based Umbraco management client.
 * Mirrors the Orval mutator options interface for compatibility.
 */
export interface FetchClientOptions {
  /** Return the full HttpResponse instead of just data */
  returnFullResponse?: boolean;
  /** Custom status validation (defaults to throwing on non-2xx) */
  validateStatus?: ((status: number) => boolean) | null;
}

/**
 * Captures the raw HTTP response for use with api-call-helpers.
 * Equivalent to CAPTURE_RAW_HTTP_RESPONSE from the SDK.
 */
export const CAPTURE_RAW_HTTP_RESPONSE = {
  returnFullResponse: true,
  validateStatus: () => true,
} as const;

/**
 * Serializes params for Umbraco API calls.
 * Handles array params in repeat format (e.g., id=1&id=2).
 */
function serializeParams(
  params: Record<string, unknown> | undefined
): string {
  if (!params) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`
        );
      }
    } else {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
      );
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/**
 * Configuration for creating a fetch client instance.
 */
export interface UmbracoFetchClientConfig {
  /** Umbraco base URL */
  baseUrl: string;
  /** The stored Umbraco Bearer token */
  accessToken: string;
  /** Optional: env and token key for automatic token refresh */
  refreshContext?: {
    env: HostedMcpEnv;
    tokenKey: string;
    refreshToken: string;
    /**
     * Optional per-tenant OAuth context. Required for cloud-routed Workers
     * where the client_id is per-tenant rather than env-wide; without it,
     * `refreshUmbracoToken` posts `client_id=undefined` and Umbraco rejects.
     */
    site?: StoredSiteContext;
  };
}

/**
 * Creates a fetch-based Umbraco API client for use in Workers.
 *
 * The returned function matches the Orval mutator signature, so it can serve
 * as the transport behind UmbracoManagementClient (via setCustomTransport).
 *
 * @param config - Client configuration with base URL and access token
 * @returns A mutator function compatible with Orval-generated API clients
 *
 * @example
 * ```typescript
 * const client = createUmbracoFetchClient({
 *   baseUrl: env.UMBRACO_BASE_URL,
 *   accessToken: storedToken.access_token,
 * });
 *
 * // Use with api-call-helpers
 * configureApiClient(() => client);
 * ```
 */
/**
 * A request as the Orval mutator hands it to the client.
 */
export interface UmbracoFetchRequestConfig {
  url: string;
  method: string;
  data?: unknown;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * The fetch client returned by `createUmbracoFetchClient`: an Orval-compatible
 * mutator, plus a read-out of the last token refresh that failed.
 */
export interface UmbracoFetchClient {
  <T>(
    requestConfig: UmbracoFetchRequestConfig,
    options?: FetchClientOptions
  ): Promise<HttpResponse<T> | T>;
  /**
   * The last refresh failure this client observed, or `undefined` if it has
   * never failed to refresh. `createPerRequestServer` reads this after its
   * opening round-trips so a definitively dead session (`reason: "expired"`)
   * can be surfaced as the degraded `authentication-expired` server rather
   * than as a toolset that 401s on every call.
   */
  getRefreshFailure(): RefreshFailure | undefined;
}

/**
 * RFC 7807 problem body synthesised when a 401 could not be recovered by a
 * refresh.
 *
 * Umbraco's Management API answers an expired access token with a 401 that has
 * an **empty body**, so without this the failure surfaced to the user as a bare
 * `UmbracoApiError: Unauthorized` with nothing to act on. The refresh result
 * knows exactly what went wrong, so spend it here.
 */
function synthesizeRefreshFailureBody(
  status: number,
  statusText: string,
  failure: RefreshFailure
): Response {
  const expired = failure.reason === "expired";
  const problem = {
    type: expired
      ? "https://umbraco.com/probs/mcp/session-expired"
      : "https://umbraco.com/probs/mcp/token-refresh-failed",
    title: expired ? "Umbraco session expired" : "Umbraco token refresh failed",
    status,
    detail: expired
      ? "Umbraco session expired — disconnect and reconnect this MCP server to re-authenticate. " +
        "The stored refresh token is no longer valid. Umbraco derives both token lifetimes from " +
        "`Umbraco:CMS:Global:TimeOut` (20 minutes by default), so a session idle for longer than " +
        "that has to be re-authenticated."
      : `The Umbraco access token expired and could not be refreshed, so this request stays unauthorized. ${failure.message}`,
    // RFC 7807 extension members — the normalised reason and the OAuth error
    // code, so a caller can branch without re-parsing `detail`.
    refreshFailureReason: failure.reason,
    ...(failure.error ? { oauthError: failure.error } : {}),
  };

  return new Response(JSON.stringify(problem), {
    status,
    statusText,
    headers: { "Content-Type": "application/problem+json" },
  });
}

export function createUmbracoFetchClient(config: UmbracoFetchClientConfig): UmbracoFetchClient {
  let currentToken = config.accessToken;
  // Tracked here rather than read from `config.refreshContext` on every call:
  // OpenIddict rotates the refresh token on each redemption, so a client that
  // kept replaying its original one could only ever refresh once ("The
  // specified refresh token has already been redeemed" on the second attempt).
  let currentRefreshToken = config.refreshContext?.refreshToken;
  let lastRefreshFailure: RefreshFailure | undefined;
  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);

  /**
   * The mutator function - compatible with Orval custom instance pattern.
   */
  async function fetchClient<T>(
    requestConfig: UmbracoFetchRequestConfig,
    options?: FetchClientOptions
  ): Promise<HttpResponse<T> | T> {
    const queryString = serializeParams(requestConfig.params);
    const fullUrl = `${normalizedBaseUrl}${requestConfig.url}${queryString}`;

    // Detect Web FormData (Cloudflare Workers + Node 18+). When present,
    // pass straight to fetch — it sets multipart Content-Type with boundary.
    const isWebFormData = requestConfig.data != null
      && typeof (globalThis as any).FormData !== "undefined"
      && requestConfig.data instanceof (globalThis as any).FormData;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${currentToken}`,
      ...(isWebFormData ? {} : { "Content-Type": "application/json" }),
      Accept: "application/json",
      ...requestConfig.headers,
    };

    const fetchOptions: RequestInit = {
      method: requestConfig.method,
      headers,
    };

    if (requestConfig.data !== undefined) {
      fetchOptions.body = isWebFormData
        ? (requestConfig.data as FormData)
        : JSON.stringify(requestConfig.data);
    }

    let resp = await fetch(fullUrl, fetchOptions);

    // Handle token refresh on 401
    if (resp.status === 401) {
      if (config.refreshContext && currentRefreshToken) {
        const env = config.refreshContext.env;
        logAuth(
          env,
          `401 on ${requestConfig.method} ${requestConfig.url} — attempting refresh (key=${config.refreshContext.tokenKey})`
        );
        const result = await refreshUmbracoToken(
          env,
          config.refreshContext.tokenKey,
          currentRefreshToken,
          config.refreshContext.site
        );

        if (result.ok) {
          currentToken = result.accessToken;
          // Adopt the rotated refresh token. Without this the next refresh on
          // this same client replays a redeemed token and Umbraco answers
          // `400 invalid_grant`.
          if (result.refreshToken) {
            currentRefreshToken = result.refreshToken;
          }
          lastRefreshFailure = undefined;
          headers.Authorization = `Bearer ${currentToken}`;
          resp = await fetch(fullUrl, { ...fetchOptions, headers });
          logAuth(
            env,
            `retry after refresh ${requestConfig.method} ${requestConfig.url} status=${resp.status}`
          );
        } else {
          lastRefreshFailure = result;
          logAuth(
            env,
            `refresh failed (${result.reason}) — synthesizing problem details for ${requestConfig.method} ${requestConfig.url}`
          );
          // Umbraco's 401 body is empty, so replace it with something the user
          // can act on before it reaches the MCP client's error rendering.
          resp = synthesizeRefreshFailureBody(
            resp.status,
            resp.statusText || "Unauthorized",
            result
          );
        }
      } else {
        // No refreshContext (or no refresh token left) means auto-refresh is
        // off for this session — we can't gate a log on LOG_AUTH because the
        // caller has no env handle here, but the 401 surfaces regardless.
      }
    }

    // Parse response body
    let data: T;
    const contentType = resp.headers.get("content-type") ?? "";
    // Parse anything JSON: `application/json` plus the `+json` structured-syntax
    // suffix (RFC 6839), e.g. `application/problem+json` used by RFC 7807 error
    // bodies. Umbraco 18 returns Management API errors as `application/problem+json`,
    // so without the suffix check they'd pass through unparsed as raw strings.
    if (contentType.includes("application/json") || contentType.includes("+json")) {
      data = (await resp.json()) as T;
    } else {
      const text = await resp.text();
      data = (text || undefined) as T;
    }

    // Return full response or just data based on options
    if (options?.returnFullResponse) {
      const responseHeaders: Record<string, string> = {};
      resp.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return {
        status: resp.status,
        statusText: resp.statusText,
        data,
        headers: responseHeaders,
      } satisfies HttpResponse<T>;
    }

    // Without returnFullResponse, check status and throw or return data
    if (!options?.validateStatus && resp.status >= 400) {
      const error = new Error(
        `Request failed with status ${resp.status}: ${resp.statusText}`
      );
      (error as any).response = { status: resp.status, data };
      throw error;
    }

    return data;
  }

  return Object.assign(fetchClient, {
    getRefreshFailure: () => lastRefreshFailure,
  }) as UmbracoFetchClient;
}

/**
 * Creates a fetch client from stored Umbraco tokens in KV.
 *
 * Convenience function that looks up stored tokens and creates a configured
 * fetch client ready for API calls.
 *
 * @param env - Worker environment bindings
 * @param tokenKey - The KV key reference for the stored Umbraco tokens
 * @returns Configured fetch client, or null if token not found
 */
export async function createFetchClientFromKV(
  env: HostedMcpEnv,
  tokenKey: string
): Promise<UmbracoFetchClient | null> {
  const entry = await getStoredUmbracoToken(env.OAUTH_KV, tokenKey);
  if (!entry) {
    logAuth(env, `createFetchClientFromKV key=${tokenKey} no_tokens_in_kv`);
    return null;
  }

  const { tokens, site } = entry;

  if (!tokens.refresh_token) {
    logAuth(
      env,
      `createFetchClientFromKV key=${tokenKey} stored_tokens_have_NO_refresh_token — auto-refresh disabled for this session`
    );
  }

  // Prefer stored site context for the base URL too (covers cloud-routed
  // Workers where env.UMBRACO_BASE_URL is the routing root, not the tenant).
  const serverBaseUrl =
    site?.serverUrl ?? site?.baseUrl ?? env.UMBRACO_SERVER_URL ?? env.UMBRACO_BASE_URL;

  return createUmbracoFetchClient({
    baseUrl: serverBaseUrl,
    accessToken: tokens.access_token,
    refreshContext: tokens.refresh_token
      ? {
          env,
          tokenKey,
          refreshToken: tokens.refresh_token,
          site,
        }
      : undefined,
  });
}
