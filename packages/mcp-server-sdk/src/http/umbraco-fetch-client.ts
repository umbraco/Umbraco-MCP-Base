/**
 * Umbraco Fetch Client
 *
 * Native fetch-based client for Umbraco Management API with:
 * - OAuth client credentials authentication
 * - Automatic token refresh
 * - Query string serialization for arrays
 * - Error logging (status only; bodies are opt-in)
 *
 * Works in Node.js 22+ and Cloudflare Workers.
 *
 * @example
 * ```typescript
 * import { initializeUmbracoFetch, UmbracoManagementClient } from "@umbraco-cms/mcp-server-sdk";
 *
 * // Initialize once at startup
 * initializeUmbracoFetch({
 *   baseUrl: "http://localhost:44391",
 *   clientId: "my-client",
 *   clientSecret: "my-secret"
 * });
 *
 * // UmbracoManagementClient is ready - use as Orval mutator
 * ```
 */

import { HttpResponse } from "../helpers/api-call-helpers.js";
import { assertTlsNotDisabledForRemote } from "../helpers/url.js";
import { assertModuleFallbackAllowed, getActiveRequestContext } from "../request-context/async-request-context.js";
import { executeUmbracoRequest } from "./request.js";
import { requestClientCredentialsToken, resolveAuthConfig } from "./token.js";
import type {
  UmbracoFetchAuthConfig,
  UmbracoManagementClientOptions,
  UmbracoRequestConfig,
} from "./types.js";

// Re-exported so existing imports from the fetch client keep working.
export { assertTlsNotDisabledForRemote };
export { DEFAULT_TOKEN_PATH, requestClientCredentialsToken } from "./token.js";
export { buildFetchBody } from "./fetch-body.js";
export { assertSafeRequestPath, serializeParams } from "./request.js";
export {
  createUmbracoFetchClient,
  type CreateUmbracoFetchClientOptions,
  type UmbracoFetchClientResult,
} from "./fetch-client-factory.js";
export type { UmbracoFetchAuthConfig, UmbracoManagementClientOptions } from "./types.js";

// ============================================================================
// Module State
// ============================================================================

let authConfig: UmbracoFetchAuthConfig | null = null;
let accessToken: string | null = null;
let tokenExpiry: number | null = null;
// Shared by concurrent callers so a cold start or expiry sends one token request.
interface TokenFlight {
  promise: Promise<string>;
  /** Aborts the shared request; fired once every waiting caller has given up. */
  controller: AbortController;
  waiters: number;
}
let inFlightToken: TokenFlight | null = null;
// Bumped by clearUmbracoFetchToken, so a token request started before a
// re-init or clear doesn't store its late response.
let tokenGeneration = 0;

/** Cap on the refresh margin: it only has to cover latency and clock skew. */
const MAX_TOKEN_EXPIRY_MARGIN_MS = 30_000;

// ============================================================================
// Token Management
// ============================================================================

/**
 * Fetches a new access token from Umbraco.
 *
 * The stored expiry is brought forward by min(30 s, 10% of expires_in), so a
 * token isn't sent just before it expires.
 *
 * @param signal - Aborts the token exchange (see `getToken` for whose signal).
 */
const fetchAccessToken = async (signal?: AbortSignal): Promise<string> => {
  if (!authConfig) {
    throw new Error(
      "UmbracoFetch not initialized. Call initializeUmbracoFetch() first."
    );
  }

  const generation = tokenGeneration;
  const { accessToken: token, expiresIn } = await requestClientCredentialsToken({
    ...authConfig,
    signal,
  });

  // Re-initialized or cleared while in flight: the response is for the old config.
  if (generation === tokenGeneration) {
    const lifetimeMs = expiresIn * 1000;
    accessToken = token;
    tokenExpiry = Date.now() + lifetimeMs - Math.min(MAX_TOKEN_EXPIRY_MARGIN_MS, lifetimeMs * 0.1);
  }
  return token;
};

/**
 * Gets a valid access token, refreshing if expired. Concurrent callers share
 * one token request; a failed request isn't cached.
 *
 * @param signal - The calling request's abort signal, so a caller's deadline
 *   also bounds its wait for the token (umbraco/Umbraco-MCP-Base#428). The
 *   shared request has its own signal: one caller giving up rejects only that
 *   caller, and the request is aborted once every waiting caller has given up.
 */
const getToken = async (signal?: AbortSignal): Promise<string> => {
  if (accessToken && !(tokenExpiry && Date.now() >= tokenExpiry)) {
    return accessToken;
  }
  signal?.throwIfAborted();
  if (!inFlightToken) {
    const controller = new AbortController();
    const flight: TokenFlight = {
      controller,
      waiters: 0,
      promise: fetchAccessToken(controller.signal).finally(() => {
        if (inFlightToken === flight) inFlightToken = null;
      }),
    };
    inFlightToken = flight;
  }

  const flight = inFlightToken;
  flight.waiters++;
  if (!signal) return flight.promise;
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason);
      if (--flight.waiters === 0) flight.controller.abort(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    flight.promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
};

/**
 * Drops the cached token after a 401, but only if it is still the one that was
 * sent, so concurrent 401s for the same token cause one refresh.
 */
const invalidateToken = (rejectedToken: string): void => {
  if (accessToken === rejectedToken) {
    accessToken = null;
    tokenExpiry = null;
  }
};

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the Umbraco fetch client with authentication config.
 * Must be called before making any API requests.
 *
 * Does not change TLS certificate verification; throws if it has been disabled
 * for a non-local base URL (see assertTlsNotDisabledForRemote).
 *
 * @param config - Authentication configuration
 */
export function initializeUmbracoFetch(config: UmbracoFetchAuthConfig): void {
  authConfig = resolveAuthConfig(config);
  clearUmbracoFetchToken();
}


/**
 * Check if the client has been initialized.
 */
export function isUmbracoFetchInitialized(): boolean {
  return authConfig !== null;
}

/**
 * Clear the current access token (forces re-authentication on next request).
 */
export function clearUmbracoFetchToken(): void {
  accessToken = null;
  tokenExpiry = null;
  inFlightToken = null;
  tokenGeneration++;
}

// ============================================================================
// Custom Transport (for non-standard environments)
// ============================================================================

/**
 * Custom transport function type.
 * Must match the Orval mutator signature: (config, options) => Promise<T>
 */
export type CustomTransport = <T>(
  config: { url: string; method: string; data?: unknown; params?: Record<string, unknown>; headers?: Record<string, string> },
  options?: UmbracoManagementClientOptions
) => Promise<T>;

let customTransport: CustomTransport | null = null;

/**
 * Sets a custom transport for UmbracoManagementClient.
 *
 * When set, all Orval-generated API calls will use this transport instead of
 * the default fetch-based transport. This enables the same generated API client
 * to work in environments that need specialized request handling.
 *
 * This is a **module-level fallback** for stdio, CLI and tests — one process,
 * one Umbraco. A transport in the active per-request store
 * (`runWithRequestContext({ transport })`) wins over it; this value is used
 * whenever the active store has no `transport` (or no store is active).
 *
 * Hosted code must not call this: module scope is shared by every Durable
 * Object (i.e. every MCP session) in a Cloudflare isolate, so the last session
 * to set it would win for all of them. Hosted code keeps per-session values
 * (tokens, clients, servers, token keys) in the per-request store and reads
 * them through its accessors.
 *
 * @param transport - Custom transport function, or null to revert to default
 */
export function setCustomTransport(transport: CustomTransport | null): void {
  customTransport = transport;
}

// ============================================================================
// Error logging
// ============================================================================

function errorBodyLoggingEnabled(): boolean {
  return typeof process !== "undefined" && process.env?.UMBRACO_MCP_LOG_ERROR_BODIES === "true";
}

// ============================================================================
// Core fetch implementation
// ============================================================================

/**
 * Makes a fetch request to the Umbraco API with the singleton client.
 * @internal
 */
async function doFetch<T>(
  config: UmbracoRequestConfig,
  options?: UmbracoManagementClientOptions
): Promise<HttpResponse<T> | T> {
  if (!authConfig) {
    throw new Error(
      "UmbracoFetch not initialized. Call initializeUmbracoFetch() first."
    );
  }

  // Read the config before waiting for the token: a re-init meanwhile would
  // otherwise send the old config's token to the new base URL.
  const auth = authConfig;
  const generation = tokenGeneration;
  // Checked per request too: the env can change after initializeUmbracoFetch.
  assertTlsNotDisabledForRemote(auth.baseUrl);

  return executeUmbracoRequest<T>(
    {
      baseUrl: auth.baseUrl,
      getToken,
      onTokenRejected: (token) => {
        if (generation !== tokenGeneration) return false;
        invalidateToken(token);
        return true;
      },
      logErrorBodies: errorBodyLoggingEnabled(),
    },
    config,
    options
  );
}

// ============================================================================
// Orval Mutator
// ============================================================================

/**
 * Orval mutator for Umbraco Management API.
 *
 * Use this as the mutator in your Orval config:
 * ```typescript
 * // orval.config.ts
 * override: {
 *   mutator: {
 *     path: "@umbraco-cms/mcp-server-sdk",
 *     name: "UmbracoManagementClient",
 *   }
 * }
 * ```
 *
 * Transport precedence: the active per-request store's `transport` (hosted
 * sessions), then a module transport set via `setCustomTransport()` (stdio,
 * CLI, tests), then the default fetch-based transport.
 *
 * @param config - Request config from Orval
 * @param options - Additional options including returnFullResponse
 * @returns Promise resolving to response data (or full HttpResponse if requested)
 */
export const UmbracoManagementClient = <T>(
  config: { url: string; method: string; data?: unknown; params?: Record<string, unknown>; headers?: Record<string, string>; [key: string]: unknown },
  options?: UmbracoManagementClientOptions
): Promise<T> => {
  // The session's transport from the per-request store wins (hosted), read at
  // call time so interleaved sessions each use their own.
  const sessionTransport = getActiveRequestContext()?.transport;
  if (sessionTransport) {
    return sessionTransport<T>(config, options);
  }

  // Module-level values (stdio, CLI, tests); hosts that require a request
  // context never reach them.
  try {
    assertModuleFallbackAllowed("UmbracoManagementClient");
  } catch (error) {
    return Promise.reject(error);
  }
  if (customTransport) {
    return customTransport<T>(config, options);
  }

  return doFetch<T>(config, options) as Promise<T>;
};
