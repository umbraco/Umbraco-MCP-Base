/**
 * Umbraco Axios Client
 *
 * Pre-configured Axios client for Umbraco Management API with:
 * - OAuth client credentials authentication
 * - Automatic token refresh
 * - Self-signed certificate support in development
 * - Query string serialization for arrays
 * - Error logging
 *
 * @example
 * ```typescript
 * import { initializeUmbracoAxios, UmbracoManagementClient } from "@umbraco-cms/mcp-server-sdk";
 *
 * // Initialize once at startup
 * initializeUmbracoAxios({
 *   baseUrl: "http://localhost:44391",
 *   clientId: "my-client",
 *   clientSecret: "my-secret"
 * });
 *
 * // UmbracoManagementClient is ready - use as Orval mutator
 * // UmbracoAxios is also available for direct use
 * ```
 */

import Axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import https from "https";
import qs from "qs";

/**
 * Authentication configuration for Umbraco API.
 */
export interface UmbracoAxiosAuthConfig {
  /** Base URL of the Umbraco instance */
  baseUrl: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret */
  clientSecret?: string;
}

/**
 * Options for the Orval mutator.
 */
export interface UmbracoManagementClientOptions extends AxiosRequestConfig {
  /** Return full AxiosResponse instead of just data */
  returnFullResponse?: boolean;
}

// ============================================================================
// Module State
// ============================================================================

export const DEFAULT_TOKEN_PATH = "/umbraco/management/api/v1/security/back-office/token";

let authConfig: UmbracoAxiosAuthConfig | null = null;
let accessToken: string | null = null;
let tokenExpiry: number | null = null;

// Create HTTPS agent (accepts self-signed certs in non-production)
const httpsAgent = new https.Agent({
  rejectUnauthorized: process.env.NODE_ENV === "production",
});

// ============================================================================
// Axios Instance
// ============================================================================

/**
 * Pre-configured Axios instance for Umbraco Management API.
 * Must call `initializeUmbracoAxios()` before use.
 */
export const UmbracoAxios: AxiosInstance = Axios.create({ httpsAgent });

// Configure query string serialization for arrays
UmbracoAxios.defaults.paramsSerializer = (params) =>
  qs.stringify(params, { arrayFormat: "repeat" });

/**
 * Fetches a new access token from Umbraco.
 */
const fetchAccessToken = async (): Promise<string> => {
  if (!authConfig) {
    throw new Error(
      "UmbracoAxios not initialized. Call initializeUmbracoAxios() first."
    );
  }

  const response = await Axios.post(
    `${authConfig.baseUrl}${DEFAULT_TOKEN_PATH}`,
    {
      client_id: authConfig.clientId,
      client_secret: authConfig.clientSecret ?? "",
      grant_type: "client_credentials",
    },
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      httpsAgent,
    }
  );

  const { access_token, expires_in } = response.data;
  accessToken = access_token;
  tokenExpiry = Date.now() + expires_in * 1000;
  return access_token;
};

// Request interceptor: Add Authorization header
UmbracoAxios.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    if (!accessToken || (tokenExpiry && Date.now() >= tokenExpiry)) {
      await fetchAccessToken();
    }

    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }

    return config;
  }
);

// Response interceptor: Error logging
UmbracoAxios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      console.error(
        `HTTP Error: ${error.response.status}`,
        error.response.data
      );
    } else if (error.request) {
      console.error("No response received:", error.request);
    } else {
      console.error("Error setting up request:", error.message);
    }
    return Promise.reject(error);
  }
);

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the Umbraco Axios client with authentication config.
 * Must be called before making any API requests.
 *
 * @param config - Authentication configuration
 */
export function initializeUmbracoAxios(config: UmbracoAxiosAuthConfig): void {
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

  authConfig = config;
  UmbracoAxios.defaults.baseURL = baseUrl;
}

/**
 * Check if the client has been initialized.
 */
export function isUmbracoAxiosInitialized(): boolean {
  return authConfig !== null;
}

/**
 * Clear the current access token (forces re-authentication on next request).
 */
export function clearUmbracoAxiosToken(): void {
  accessToken = null;
  tokenExpiry = null;
}

// ============================================================================
// Orval Mutator
// ============================================================================

// ============================================================================
// Custom Transport (for non-Axios environments like Cloudflare Workers)
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
 * When set, all Orval-generated API calls will use this transport instead of Axios.
 * This enables the same generated API client to work in non-Node environments
 * like Cloudflare Workers where Axios is not available.
 *
 * @param transport - Custom transport function, or null to revert to Axios
 *
 * @example
 * ```typescript
 * import { setCustomTransport } from "@umbraco-cms/mcp-server-sdk";
 * import { createFetchClientFromKV } from "@umbraco-cms/mcp-hosted";
 *
 * const fetchClient = await createFetchClientFromKV(env, tokenKey);
 * setCustomTransport(fetchClient);
 * ```
 */
export function setCustomTransport(transport: CustomTransport | null): void {
  customTransport = transport;
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
 * used instead of the default Axios-based transport.
 *
 * @param config - Axios request config from Orval
 * @param options - Additional options including returnFullResponse
 * @returns Promise resolving to response data (or full response if requested)
 */
export const UmbracoManagementClient = <T>(
  config: AxiosRequestConfig,
  options?: UmbracoManagementClientOptions
): Promise<T> => {
  // Use custom transport if configured (e.g., fetch-based for Workers)
  if (customTransport) {
    return customTransport<T>(config as any, options);
  }

  const source = Axios.CancelToken.source();
  const returnFullResponse = options?.returnFullResponse;

  const promise = UmbracoAxios({
    ...config,
    ...options,
    cancelToken: source.token,
  }).then((response: AxiosResponse) => {
    return returnFullResponse ? response : response.data;
  });

  // @ts-ignore - Add cancel method for Orval compatibility
  promise.cancel = () => {
    source.cancel("Query was cancelled");
  };

  return promise;
};

