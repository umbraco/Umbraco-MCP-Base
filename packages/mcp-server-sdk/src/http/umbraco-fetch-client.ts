/**
 * Umbraco Fetch Client
 *
 * Native fetch-based client for Umbraco Management API with:
 * - OAuth client credentials authentication
 * - Automatic token refresh
 * - Query string serialization for arrays
 * - Error logging
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
import { normalizeBaseUrl } from "../helpers/url.js";
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

const ALLOW_SELF_SIGNED_LOCALHOST_ENV = "UMBRACO_ALLOW_SELF_SIGNED_LOCALHOST";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Printed once per process, not on every token request. stderr, because
// stdout carries the MCP stdio protocol.
const reportedTlsMessages = new Set<string>();
function reportTlsOnce(message: string): void {
  if (reportedTlsMessages.has(message)) return;
  reportedTlsMessages.add(message);
  console.error(`[umbraco-mcp] ${message}`);
}

function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Certificate verification stays on unless UMBRACO_ALLOW_SELF_SIGNED_LOCALHOST=true
 * and the base URL is loopback, in which case it is turned off process-wide
 * (the only switch Node.js offers). Warns when the opt-in is ignored, or when
 * the user has set NODE_TLS_REJECT_UNAUTHORIZED=0 for a non-local site.
 */
function applyTlsPolicy(baseUrl: string): void {
  if (typeof process === "undefined" || !process.env) return;
  const local = isLoopbackUrl(baseUrl);
  const optIn = process.env[ALLOW_SELF_SIGNED_LOCALHOST_ENV]?.trim().toLowerCase() === "true";

  if (optIn && local) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    reportTlsOnce(
      `${ALLOW_SELF_SIGNED_LOCALHOST_ENV}=true and the Umbraco base URL is local: ` +
        "TLS certificate verification is disabled for this process."
    );
    return;
  }
  if (optIn) {
    reportTlsOnce(
      `${ALLOW_SELF_SIGNED_LOCALHOST_ENV} is ignored: the Umbraco base URL is not localhost, ` +
        "127.0.0.1 or [::1]. Certificate verification stays on."
    );
  }
  if (!local && process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    reportTlsOnce(
      "Warning: NODE_TLS_REJECT_UNAUTHORIZED=0 is set and the Umbraco base URL is not local, " +
        "so its TLS certificate is not being verified. Remove it; for a local self-signed site use " +
        `${ALLOW_SELF_SIGNED_LOCALHOST_ENV}=true or NODE_EXTRA_CA_CERTS instead.`
    );
  }
}

export const DEFAULT_TOKEN_PATH = "/umbraco/management/api/v1/security/back-office/token";

let authConfig: UmbracoFetchAuthConfig | null = null;
let accessToken: string | null = null;
let tokenExpiry: number | null = null;

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

  applyTlsPolicy(baseUrl);
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
      `Token request failed: ${response.status} ${response.statusText}`
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
 */
const fetchAccessToken = async (): Promise<string> => {
  if (!authConfig) {
    throw new Error(
      "UmbracoFetch not initialized. Call initializeUmbracoFetch() first."
    );
  }

  const { accessToken: token, expiresIn } = await requestClientCredentialsToken(
    authConfig
  );

  accessToken = token;
  tokenExpiry = Date.now() + expiresIn * 1000;
  return token;
};

/**
 * Gets a valid access token, refreshing if expired.
 */
const getToken = async (): Promise<string> => {
  if (!accessToken || (tokenExpiry && Date.now() >= tokenExpiry)) {
    await fetchAccessToken();
  }
  return accessToken!;
};

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the Umbraco fetch client with authentication config.
 * Must be called before making any API requests.
 *
 * Applies the TLS policy for the base URL (see applyTlsPolicy): certificate
 * verification stays on unless a local base URL is explicitly opted in.
 *
 * @param config - Authentication configuration
 */
export function initializeUmbracoFetch(config: UmbracoFetchAuthConfig): void {
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

  applyTlsPolicy(baseUrl);
  authConfig = { ...config, baseUrl: normalizeBaseUrl(baseUrl) };
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
// Core fetch implementation
// ============================================================================

/**
 * Makes a fetch request to the Umbraco API.
 * @internal
 */
async function doFetch<T>(
  config: { url: string; method: string; data?: unknown; params?: Record<string, unknown>; headers?: Record<string, string> },
  options?: UmbracoManagementClientOptions
): Promise<HttpResponse<T> | T> {
  if (!authConfig) {
    throw new Error(
      "UmbracoFetch not initialized. Call initializeUmbracoFetch() first."
    );
  }

  const token = await getToken();
  const queryString = serializeParams(config.params);
  const fullUrl = `${authConfig.baseUrl}${config.url}${queryString}`;

  // Detect FormData payloads. Two shapes are supported:
  //   - Web FormData (globalThis.FormData) — works on Cloudflare Workers and Node 18+.
  //     Pass straight to fetch, which sets multipart Content-Type with boundary.
  //   - Stream FormData (`form-data` npm package, Node-only) — has getHeaders()/pipe().
  //     Caller supplies the multipart Content-Type via config.headers from getHeaders().
  const isWebFormData = config.data != null
    && typeof (globalThis as any).FormData !== "undefined"
    && config.data instanceof (globalThis as any).FormData;
  const isStreamFormData = !isWebFormData
    && config.data != null
    && typeof (config.data as any).getHeaders === "function"
    && typeof (config.data as any).pipe === "function";
  const skipDefaultContentType = isWebFormData || isStreamFormData;

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

  if (config.data !== undefined) {
    if (isWebFormData) {
      // Pass through; fetch sets multipart Content-Type + boundary.
      fetchOptions.body = config.data as FormData;
    } else if (isStreamFormData) {
      // Collect the stream-based FormData into a Buffer for native fetch.
      // The `form-data` package emits a CombinedStream which is not async-iterable,
      // so we collect chunks via the 'data' event.
      const fd = config.data as { pipe: Function; resume: Function; on: Function };
      fetchOptions.body = await new Promise<BodyInit>((resolve, reject) => {
        const chunks: Buffer[] = [];
        fd.on("data", (chunk: string | Buffer) =>
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
        fd.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as unknown as BodyInit);
        });
        fd.on("error", reject);
        fd.resume();
      });
    } else {
      fetchOptions.body = JSON.stringify(config.data);
    }
  }

  const resp = await fetch(fullUrl, fetchOptions);

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
      statusText: resp.statusText,
      data,
      headers: responseHeaders,
    } satisfies HttpResponse<T>;
  }

  // Without returnFullResponse, check status and throw or return data
  if (!options?.validateStatus && resp.status >= 400) {
    console.error(`HTTP Error: ${resp.status}`, data);
    const error = new Error(
      `Request failed with status ${resp.status}: ${resp.statusText}`
    );
    (error as any).response = { status: resp.status, data };
    throw error;
  }

  return data;
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
  /** Enable request logging (defaults to false) */
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

  const fetchToken = async (): Promise<string> => {
    if (!instanceAuthConfig) {
      throw new Error("Client not initialized. Call initialize() first.");
    }

    const { accessToken, expiresIn } = await requestClientCredentialsToken({
      ...instanceAuthConfig,
      tokenPath,
    });

    instanceAccessToken = accessToken;
    instanceTokenExpiry = Date.now() + expiresIn * 1000;
    return accessToken;
  };

  const getInstanceToken = async (): Promise<string> => {
    if (!instanceAccessToken || (instanceTokenExpiry && Date.now() >= instanceTokenExpiry)) {
      await fetchToken();
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

    const token = await getInstanceToken();
    const queryString = serializeParams(config.params);
    const fullUrl = `${instanceAuthConfig.baseUrl}${config.url}${queryString}`;

    const isWebFormData = config.data != null
      && typeof (globalThis as any).FormData !== "undefined"
      && config.data instanceof (globalThis as any).FormData;
    const isStreamFormData = !isWebFormData
      && config.data != null
      && typeof (config.data as any).getHeaders === "function"
      && typeof (config.data as any).pipe === "function";
    const skipDefaultContentType = isWebFormData || isStreamFormData;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(skipDefaultContentType ? {} : { "Content-Type": "application/json" }),
      Accept: "application/json",
      ...config.headers,
    };

    const fetchOpts: RequestInit = {
      method: config.method,
      headers,
    };

    if (config.data !== undefined) {
      if (isWebFormData) {
        fetchOpts.body = config.data as FormData;
      } else if (isStreamFormData) {
        const fd = config.data as { pipe: Function; resume: Function; on: Function };
        fetchOpts.body = await new Promise<BodyInit>((resolve, reject) => {
          const chunks: Buffer[] = [];
          fd.on("data", (chunk: string | Buffer) =>
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
          fd.on("end", () => resolve(Buffer.concat(chunks) as unknown as BodyInit));
          fd.on("error", reject);
          fd.resume();
        });
      } else {
        fetchOpts.body = JSON.stringify(config.data);
      }
    }

    console.log("[sdk-fetch] body shape:", {
      url: config.url,
      isWebFormData,
      isStreamFormData,
      dataKind: config.data == null ? "null" : (config.data as any)?.constructor?.name,
      hasGetHeaders: typeof (config.data as any)?.getHeaders === "function",
      hasPipe: typeof (config.data as any)?.pipe === "function",
      globalFormDataExists: typeof (globalThis as any).FormData !== "undefined",
      bodyKind: fetchOpts.body == null ? "null" : (fetchOpts.body as any)?.constructor?.name,
      ctHeader: (fetchOpts.headers as Record<string, string>)?.["Content-Type"] ?? null,
    });
    if (isWebFormData) {
      const fdEntries: Array<{ name: string; kind: string; size?: number }> = [];
      for (const [k, v] of (config.data as any).entries()) {
        fdEntries.push({
          name: k,
          kind: typeof v === "string" ? "string" : (v?.constructor?.name ?? typeof v),
          size: typeof v === "string" ? v.length : v?.size,
        });
      }
      console.log("[sdk-fetch] web formdata entries:", fdEntries);
    }

    if (enableLogging) {
      console.log("Request:", config.method.toUpperCase(), config.url);
    }

    const resp = await fetch(fullUrl, fetchOpts);

    if (enableLogging) {
      console.log("Response:", resp.status, config.url);
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

    const responseHeaders: Record<string, string> = {};
    resp.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (opts?.returnFullResponse) {
      return {
        status: resp.status,
        statusText: resp.statusText,
        data,
        headers: responseHeaders,
      } as T;
    }

    if (!opts?.validateStatus && resp.status >= 400) {
      console.error(`HTTP Error: ${resp.status}`, data);
      const error = new Error(
        `Request failed with status ${resp.status}: ${resp.statusText}`
      );
      (error as any).response = { status: resp.status, data };
      throw error;
    }

    return data;
  };

  return {
    initialize: (config: UmbracoFetchAuthConfig) => {
      const { clientId, clientSecret, baseUrl } = config;
      if (!baseUrl) throw new Error("Missing required configuration: baseUrl");
      if (!clientId) throw new Error("Missing required configuration: clientId");
      if (!clientSecret && clientId !== "umbraco-swagger") {
        throw new Error("Missing required configuration: clientSecret");
      }
      applyTlsPolicy(baseUrl);
      instanceAuthConfig = { ...config, baseUrl: normalizeBaseUrl(baseUrl) };
    },
    isInitialized: () => instanceAuthConfig !== null,
    clearToken: () => {
      instanceAccessToken = null;
      instanceTokenExpiry = null;
    },
    mutator,
  };
}
