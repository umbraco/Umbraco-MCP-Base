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
 * The fetch client function type returned by createUmbracoFetchClient.
 */
export type UmbracoFetchClient = ReturnType<typeof createUmbracoFetchClient>;

export function createUmbracoFetchClient(config: UmbracoFetchClientConfig) {
  let currentToken = config.accessToken;
  const normalizedBaseUrl = normalizeBaseUrl(config.baseUrl);

  /**
   * The mutator function - compatible with Orval custom instance pattern.
   */
  async function fetchClient<T>(
    requestConfig: {
      url: string;
      method: string;
      data?: unknown;
      params?: Record<string, unknown>;
      headers?: Record<string, string>;
    },
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

    console.log("[hosted-fetch]", {
      url: requestConfig.url,
      method: requestConfig.method,
      isWebFormData,
      bodyKind: fetchOptions.body == null ? "null" : (fetchOptions.body as any)?.constructor?.name,
      ctHeader: headers["Content-Type"] ?? null,
    });

    let resp = await fetch(fullUrl, fetchOptions);

    // Handle token refresh on 401
    if (resp.status === 401) {
      if (config.refreshContext) {
        const env = config.refreshContext.env;
        logAuth(
          env,
          `401 on ${requestConfig.method} ${requestConfig.url} — attempting refresh (key=${config.refreshContext.tokenKey})`
        );
        const newToken = await refreshUmbracoToken(
          env,
          config.refreshContext.tokenKey,
          config.refreshContext.refreshToken,
          config.refreshContext.site
        );

        if (newToken) {
          currentToken = newToken;
          headers.Authorization = `Bearer ${currentToken}`;
          resp = await fetch(fullUrl, { ...fetchOptions, headers });
          logAuth(
            env,
            `retry after refresh ${requestConfig.method} ${requestConfig.url} status=${resp.status}`
          );
        } else {
          logAuth(
            env,
            `refresh failed — propagating 401 for ${requestConfig.method} ${requestConfig.url}`
          );
        }
      } else {
        // No refreshContext means no refresh_token was stored — we can't
        // gate this on LOG_AUTH because the caller has no env handle here,
        // but the resulting 401 will surface to the MCP client regardless.
      }
    }

    // Parse response body
    let data: T;
    const contentType = resp.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
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

  return fetchClient;
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
): Promise<ReturnType<typeof createUmbracoFetchClient> | null> {
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
