/**
 * Umbraco Fetch Client
 *
 * A fetch-based API client for Cloudflare Workers runtime.
 * Replaces the Axios-based client used in stdio mode.
 *
 * Returns responses matching the HttpResponse interface from the SDK,
 * compatible with api-call-helpers' validation logic.
 */

import type { HttpResponse } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import {
  getStoredUmbracoToken,
  refreshUmbracoToken,
} from "../auth/umbraco-handler.js";

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
  };
}

/**
 * Creates a fetch-based Umbraco API client for use in Workers.
 *
 * The returned function matches the Orval mutator signature so it can be
 * used as a drop-in replacement for the Axios-based UmbracoManagementClient.
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
    const fullUrl = `${config.baseUrl}${requestConfig.url}${queryString}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${currentToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...requestConfig.headers,
    };

    const fetchOptions: RequestInit = {
      method: requestConfig.method,
      headers,
    };

    if (requestConfig.data !== undefined) {
      fetchOptions.body = JSON.stringify(requestConfig.data);
    }

    let resp = await fetch(fullUrl, fetchOptions);

    // Handle token refresh on 401
    if (resp.status === 401 && config.refreshContext) {
      const newToken = await refreshUmbracoToken(
        config.refreshContext.env,
        config.refreshContext.tokenKey,
        config.refreshContext.refreshToken
      );

      if (newToken) {
        currentToken = newToken;
        headers.Authorization = `Bearer ${currentToken}`;
        resp = await fetch(fullUrl, { ...fetchOptions, headers });
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
      return {
        status: resp.status,
        statusText: resp.statusText,
        data,
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
  const tokens = await getStoredUmbracoToken(env.OAUTH_KV, tokenKey);
  if (!tokens) return null;

  // Use UMBRACO_SERVER_URL for server-side calls if available
  // (supports HTTP proxy for self-signed certs in local dev)
  const serverBaseUrl = env.UMBRACO_SERVER_URL ?? env.UMBRACO_BASE_URL;

  return createUmbracoFetchClient({
    baseUrl: serverBaseUrl,
    accessToken: tokens.access_token,
    refreshContext: tokens.refresh_token
      ? {
          env,
          tokenKey,
          refreshToken: tokens.refresh_token,
        }
      : undefined,
  });
}
