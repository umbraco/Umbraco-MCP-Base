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
import { resolveStatusText } from "../helpers/status-text.js";
import { assertTlsNotDisabledForRemote, normalizeBaseUrl } from "../helpers/url.js";

// Re-exported so existing imports from the fetch client keep working.
export { assertTlsNotDisabledForRemote };
import { assertModuleFallbackAllowed, getActiveRequestContext } from "../request-context/async-request-context.js";

/**
 * Authentication configuration for Umbraco API.
 */
export interface UmbracoFetchAuthConfig {
  /** Base URL of the Umbraco instance */
  baseUrl: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret */
  clientSecret?: string;
}

/**
 * Options for the Orval mutator.
 * Includes extra fields that Orval-generated code may pass through.
 */
export interface UmbracoManagementClientOptions {
  /** Return full HttpResponse instead of just data */
  returnFullResponse?: boolean;
  /** Custom status validator — when present, prevents throwing on error status codes */
  validateStatus?: ((status: number) => boolean) | null;
  /** Additional headers (used by Orval-generated multipart uploads etc.) */
  headers?: Record<string, string>;
  /** Abort signal for request cancellation */
  signal?: AbortSignal;
  /** Response type hint (ignored by fetch — included for Orval compatibility) */
  responseType?: string;
  /** Allow extra properties from Orval-generated code */
  [key: string]: unknown;
}

// ============================================================================
// Module State
// ============================================================================

export const DEFAULT_TOKEN_PATH = "/umbraco/management/api/v1/security/back-office/token";

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
// Query String Serialization
// ============================================================================

/**
 * Serializes params for Umbraco API calls.
 * Handles array params in repeat format (e.g., id=1&id=2).
 * Replaces the `qs` library.
 */
function serializeParams(params: Record<string, unknown> | undefined): string {
  if (!params) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * Performs the client-credentials token exchange against Umbraco.
 *
 * The one place this request is built. Both the singleton and per-instance
 * clients below wrap it with their own token caching, and the build-time
 * target-major writer uses it too — the request itself is identical in all
 * three, so it lives here rather than being re-implemented per caller.
 *
 * @throws If the token endpoint returns a non-2xx response
 */
export const requestClientCredentialsToken = async (config: {
  baseUrl: string;
  clientId: string;
  clientSecret?: string;
  tokenPath?: string;
  /** Forwarded to `fetch`, so callers can impose their own deadline. */
  signal?: AbortSignal;
}): Promise<{ accessToken: string; expiresIn: number }> => {
  const {
    baseUrl,
    clientId,
    clientSecret,
    tokenPath = DEFAULT_TOKEN_PATH,
    signal,
  } = config;

  assertTlsNotDisabledForRemote(baseUrl);
  const response = await fetch(`${baseUrl}${tokenPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret ?? "",
      grant_type: "client_credentials",
    }).toString(),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `Token request failed: ${response.status} ${resolveStatusText(response.status, response.statusText)}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
};

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

/** Validates an auth config, applies the TLS check and normalizes the base URL. */
function resolveAuthConfig(config: UmbracoFetchAuthConfig): UmbracoFetchAuthConfig {
  const { clientId, clientSecret, baseUrl } = config;

  if (!baseUrl) {
    throw new Error("Missing required configuration: baseUrl");
  }
  if (!clientId) {
    throw new Error("Missing required configuration: clientId");
  }
  if (!clientSecret && clientId !== "umbraco-swagger") {
    throw new Error("Missing required configuration: clientSecret");
  }

  assertTlsNotDisabledForRemote(baseUrl);
  return { ...config, baseUrl: normalizeBaseUrl(baseUrl) };
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

/**
 * Logs a failed request to stderr. Only status, method and path are written by
 * default: error bodies (e.g. `application/problem+json`) can echo submitted
 * values such as member names or emails, and MCP clients capture a stdio
 * server's stderr in their own log files. The full body is written only when
 * the caller opts in (`enableLogging` on the factory, or the
 * `UMBRACO_MCP_LOG_ERROR_BODIES=true` env var for the singleton client).
 * @internal
 */
function logHttpError(
  status: number,
  method: string,
  url: string,
  data: unknown,
  includeBody: boolean
): void {
  const path = url.split("?")[0];
  const line = `HTTP Error: ${status} ${method.toUpperCase()} ${path}`;
  if (includeBody) {
    console.error(line, data);
  } else {
    console.error(line);
  }
}

function errorBodyLoggingEnabled(): boolean {
  return typeof process !== "undefined" && process.env?.UMBRACO_MCP_LOG_ERROR_BODIES === "true";
}

// ============================================================================
// Core fetch implementation
// ============================================================================

/** True when every Authorization header in `headers` carries our cached token. */
function sentOurToken(headers: Record<string, string>, token: string): boolean {
  return Object.entries(headers).every(
    ([name, value]) => name.toLowerCase() !== "authorization" || value === `Bearer ${token}`
  );
}

/**
 * True when a 401 is a bearer-token challenge from the token validation
 * middleware (`WWW-Authenticate: Bearer …`), i.e. the token itself was refused.
 * An endpoint that returns 401 from its own code (Umbraco does this for some
 * permission checks) sends no challenge, and a fresh token wouldn't help.
 */
function isBearerChallenge(resp: Response): boolean {
  return /(?:^|,)\s*Bearer\b/i.test(resp.headers.get("www-authenticate") ?? "");
}

/** Stream FormData from the `form-data` package (Node only). */
interface StreamFormData {
  getHeaders: () => Record<string, string>;
  pipe: Function;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
  resume: () => unknown;
  destroy?: () => unknown;
}

/**
 * Collects a stream FormData into one Uint8Array. The `form-data` package emits
 * a CombinedStream which is not async-iterable, so chunks come via 'data'.
 * Uses no Node globals (Buffer), so it runs in Workers too, and the signal
 * bounds the wait: a stream that never ends (e.g. one already drained by an
 * earlier attempt) would otherwise hang the request whatever deadline was set.
 */
function collectStreamFormData(fd: StreamFormData, signal?: AbortSignal): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      reject(signal!.reason);
      fd.destroy?.();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => signal?.removeEventListener("abort", onAbort);

    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    fd.on("data", (chunk: string | Uint8Array) =>
      chunks.push(typeof chunk === "string" ? encoder.encode(chunk) : chunk));
    fd.on("end", () => {
      done();
      const body = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(body);
    });
    fd.on("error", (error: unknown) => {
      done();
      reject(error);
    });
    fd.resume();
  });
}

/**
 * Builds the fetch body for a request payload and says whether the default
 * `Content-Type: application/json` must be left off. Shared by every Umbraco
 * fetch client (the singleton and factory here, and `@umbraco-cms/mcp-hosted`)
 * so they cannot drift (umbraco/Umbraco-MCP-Base#446). Works in Node and Workers.
 *
 * Supported payloads:
 *   - undefined: no body.
 *   - Web FormData (globalThis.FormData; Workers and Node 18+): passed straight
 *     to fetch, which sets the multipart Content-Type with boundary.
 *   - Stream FormData (`form-data` package, Node only; has getHeaders()/pipe()):
 *     collected into a Uint8Array for native fetch. The caller supplies the
 *     multipart Content-Type through its own headers (from getHeaders()).
 *   - anything else: JSON.stringify.
 *
 * @param signal - The request's abort signal; bounds collecting a stream body.
 *   Without one, a stream that never ends (e.g. one already drained) still hangs.
 * @internal Exported for `@umbraco-cms/mcp-hosted` (released in lockstep); not a
 *   supported public API, so its shape may change in any release.
 */
export async function buildFetchBody(
  data: unknown,
  signal?: AbortSignal,
): Promise<{ body?: BodyInit; skipDefaultContentType: boolean }> {
  const isWebFormData = data != null
    && typeof (globalThis as any).FormData !== "undefined"
    && data instanceof (globalThis as any).FormData;
  const isStreamFormData = !isWebFormData
    && data != null
    && typeof (data as any).getHeaders === "function"
    && typeof (data as any).pipe === "function";
  const skipDefaultContentType = isWebFormData || isStreamFormData;

  if (data === undefined) return { skipDefaultContentType };
  if (isWebFormData) return { body: data as FormData, skipDefaultContentType };
  if (isStreamFormData) {
    const body = await collectStreamFormData(data as StreamFormData, signal);
    return { body: body as unknown as BodyInit, skipDefaultContentType };
  }
  return { body: JSON.stringify(data), skipDefaultContentType };
}

type UmbracoRequestConfig = {
  url: string;
  method: string;
  data?: unknown;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
};

/** What differs between the singleton and factory clients. */
interface UmbracoRequestAuth {
  baseUrl: string;
  /** Returns a valid token; the request's signal bounds the wait. */
  getToken: (signal?: AbortSignal) => Promise<string>;
  /**
   * Called when Umbraco refused `token` with a bearer challenge. Drops it from
   * the cache and returns true to resend with a fresh token, or false to return
   * the 401 as is (e.g. the client was re-initialised meanwhile).
   */
  onTokenRejected: (token: string) => boolean;
  /** Write full error bodies to stderr (see logHttpError). */
  logErrorBodies: boolean;
  /** Write each request and response line to stderr. */
  logRequests?: boolean;
}

/**
 * Sends one request to the Umbraco API. The single request path for both the
 * singleton and factory clients, so headers, the 401 resend, response parsing
 * and error throwing cannot drift between them (umbraco/Umbraco-MCP-Base#446).
 * @internal
 */
async function executeUmbracoRequest<T>(
  auth: UmbracoRequestAuth,
  config: UmbracoRequestConfig,
  options?: UmbracoManagementClientOptions
): Promise<HttpResponse<T> | T> {
  // The request's signal bounds the wait for the token too: without it a CMS
  // that accepts the connection but never answers the token request would hang
  // the caller whatever deadline it set (umbraco/Umbraco-MCP-Base#428).
  const token = await auth.getToken(options?.signal);
  const queryString = serializeParams(config.params);
  const fullUrl = `${auth.baseUrl}${config.url}${queryString}`;

  const { body, skipDefaultContentType } = await buildFetchBody(config.data, options?.signal);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(skipDefaultContentType ? {} : { "Content-Type": "application/json" }),
    Accept: "application/json",
    ...config.headers,
    ...options?.headers,
  };

  const fetchOptions: RequestInit = {
    method: config.method,
    headers,
    signal: options?.signal,
  };

  if (body !== undefined) {
    fetchOptions.body = body;
  }

  const send = async (): Promise<Response> => {
    if (auth.logRequests) {
      console.error("Request:", config.method.toUpperCase(), config.url);
    }
    const response = await fetch(fullUrl, fetchOptions);
    if (auth.logRequests) {
      console.error("Response:", response.status, config.url);
    }
    return response;
  };

  let resp = await send();

  // Resend once with a fresh token when the token itself was refused. Only a
  // bearer challenge counts: it comes from token validation, before the
  // endpoint runs, so resending is safe for every method. Done before the
  // returnFullResponse branch so tool calls (which return the 401) get it too.
  // Skipped when the caller supplied its own Authorization header, or when the
  // client was re-initialised meanwhile (the new token belongs to another config).
  if (
    resp.status === 401
    && isBearerChallenge(resp)
    && !options?.signal?.aborted
    && sentOurToken(headers, token)
    && auth.onTokenRejected(token)
  ) {
    void resp.body?.cancel().catch(() => {});
    headers.Authorization = `Bearer ${await auth.getToken(options?.signal)}`;
    resp = await send();
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

  // Collect response headers
  const responseHeaders: Record<string, string> = {};
  resp.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const returnFullResponse = options?.returnFullResponse;

  if (returnFullResponse) {
    return {
      status: resp.status,
      statusText: resolveStatusText(resp.status, resp.statusText),
      data,
      headers: responseHeaders,
    } satisfies HttpResponse<T>;
  }

  // Without returnFullResponse, check status and throw or return data
  if (!options?.validateStatus && resp.status >= 400) {
    logHttpError(resp.status, config.method, config.url, data, auth.logErrorBodies);
    const error = new Error(
      `Request failed with status ${resp.status}: ${resolveStatusText(resp.status, resp.statusText)}`
    );
    (error as any).response = { status: resp.status, data };
    throw error;
  }

  return data;
}

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

// ============================================================================
// Factory (for advanced use cases)
// ============================================================================

/**
 * Options for creating a custom Umbraco fetch client.
 */
export interface CreateUmbracoFetchClientOptions {
  /** Token endpoint path (defaults to Umbraco's standard path) */
  tokenPath?: string;
  /** Enable request logging, including full error response bodies (defaults to false) */
  enableLogging?: boolean;
}

/**
 * Result of creating a custom Umbraco fetch client.
 */
export interface UmbracoFetchClientResult {
  /** Initialize the client with authentication config */
  initialize: (config: UmbracoFetchAuthConfig) => void;
  /** Check if the client has been initialized */
  isInitialized: () => boolean;
  /** Clear the current access token */
  clearToken: () => void;
  /** Orval mutator for this client */
  mutator: <T>(config: { url: string; method: string; data?: unknown; params?: Record<string, unknown>; headers?: Record<string, string> }, options?: UmbracoManagementClientOptions) => Promise<T>;
}

/**
 * Creates a new Umbraco fetch client instance.
 *
 * Use this for advanced scenarios where you need multiple clients
 * or custom configuration. For most cases, use the pre-configured
 * singleton via `initializeUmbracoFetch()` instead.
 *
 * @param options - Client configuration options
 * @returns Object containing initialization function and mutator
 */
export function createUmbracoFetchClient(
  options: CreateUmbracoFetchClientOptions = {}
): UmbracoFetchClientResult {
  const {
    tokenPath = DEFAULT_TOKEN_PATH,
    enableLogging = false,
  } = options;

  // State for this instance
  let instanceAuthConfig: UmbracoFetchAuthConfig | null = null;
  let instanceAccessToken: string | null = null;
  let instanceTokenExpiry: number | null = null;

  const fetchToken = async (signal?: AbortSignal): Promise<string> => {
    if (!instanceAuthConfig) {
      throw new Error("Client not initialized. Call initialize() first.");
    }

    const { accessToken, expiresIn } = await requestClientCredentialsToken({
      ...instanceAuthConfig,
      tokenPath,
      signal,
    });

    instanceAccessToken = accessToken;
    instanceTokenExpiry = Date.now() + expiresIn * 1000;
    return accessToken;
  };

  const getInstanceToken = async (signal?: AbortSignal): Promise<string> => {
    if (!instanceAccessToken || (instanceTokenExpiry && Date.now() >= instanceTokenExpiry)) {
      await fetchToken(signal);
    }
    return instanceAccessToken!;
  };

  const mutator = async <T>(
    config: { url: string; method: string; data?: unknown; params?: Record<string, unknown>; headers?: Record<string, string> },
    opts?: UmbracoManagementClientOptions
  ): Promise<T> => {
    if (!instanceAuthConfig) {
      throw new Error("Client not initialized. Call initialize() first.");
    }

    const auth = instanceAuthConfig;
    assertTlsNotDisabledForRemote(auth.baseUrl);

    return executeUmbracoRequest<T>(
      {
        baseUrl: auth.baseUrl,
        getToken: getInstanceToken,
        onTokenRejected: (token) => {
          // Re-initialised meanwhile: the new token belongs to another config.
          if (auth !== instanceAuthConfig) return false;
          if (instanceAccessToken === token) {
            instanceAccessToken = null;
            instanceTokenExpiry = null;
          }
          return true;
        },
        logErrorBodies: enableLogging,
        logRequests: enableLogging,
      },
      config,
      opts
    ) as Promise<T>;
  };

  return {
    initialize: (config: UmbracoFetchAuthConfig) => {
      instanceAuthConfig = resolveAuthConfig(config);
    },
    isInitialized: () => instanceAuthConfig !== null,
    clearToken: () => {
      instanceAccessToken = null;
      instanceTokenExpiry = null;
    },
    mutator,
  };
}
