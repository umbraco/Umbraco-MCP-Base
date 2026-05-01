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

// Accept self-signed certificates in non-production environments.
// Must run at module load time (before any fetch calls) because Node.js
// reads this env var when establishing TLS connections.
if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
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
 * Fetches a new access token from Umbraco.
 */
const fetchAccessToken = async (): Promise<string> => {
  if (!authConfig) {
    throw new Error(
      "UmbracoFetch not initialized. Call initializeUmbracoFetch() first."
    );
  }

  const response = await fetch(
    `${authConfig.baseUrl}${DEFAULT_TOKEN_PATH}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: authConfig.clientId,
        client_secret: authConfig.clientSecret ?? "",
        grant_type: "client_credentials",
      }).toString(),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Token request failed: ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  accessToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return data.access_token;
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
 * In non-production environments, automatically disables TLS certificate
 * verification to support self-signed certificates during local development.
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

  // Detect stream-based FormData (from `form-data` npm package).
  // It has getHeaders()/pipe() methods unlike web-standard FormData.
  const isStreamFormData = config.data != null
    && typeof (config.data as any).getHeaders === "function"
    && typeof (config.data as any).pipe === "function";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    // Skip Content-Type for FormData — let the boundary header from FormData take precedence
    ...(isStreamFormData ? {} : { "Content-Type": "application/json" }),
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
    if (isStreamFormData) {
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
  if (contentType.includes("application/json")) {
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
 * If a custom transport has been set via `setCustomTransport()`, it will be
 * used instead of the default fetch-based transport.
 *
 * @param config - Request config from Orval
 * @param options - Additional options including returnFullResponse
 * @returns Promise resolving to response data (or full HttpResponse if requested)
 */
export const UmbracoManagementClient = <T>(
  config: { url: string; method: string; data?: unknown; params?: Record<string, unknown>; headers?: Record<string, string>; [key: string]: unknown },
  options?: UmbracoManagementClientOptions
): Promise<T> => {
  // Use custom transport if configured
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

    const response = await fetch(
      `${instanceAuthConfig.baseUrl}${tokenPath}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: instanceAuthConfig.clientId,
          client_secret: instanceAuthConfig.clientSecret ?? "",
          grant_type: "client_credentials",
        }).toString(),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Token request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    instanceAccessToken = data.access_token;
    instanceTokenExpiry = Date.now() + data.expires_in * 1000;
    return data.access_token;
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

    const isStreamFormData = config.data != null
      && typeof (config.data as any).getHeaders === "function"
      && typeof (config.data as any).pipe === "function";

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      ...(isStreamFormData ? {} : { "Content-Type": "application/json" }),
      Accept: "application/json",
      ...config.headers,
    };

    const fetchOpts: RequestInit = {
      method: config.method,
      headers,
    };

    if (config.data !== undefined) {
      if (isStreamFormData) {
        const fd = config.data as { pipe: Function; resume: Function; on: Function };
        fetchOpts.body = await new Promise<BodyInit>((resolve, reject) => {
          const chunks: Buffer[] = [];
          fd.on("data", (chunk: string | Buffer) =>
            chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
          fd.on("end", () => resolve(Buffer.concat(chunks)));
          fd.on("error", reject);
          fd.resume();
        });
      } else {
        fetchOpts.body = JSON.stringify(config.data);
      }
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
    if (contentType.includes("application/json")) {
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
