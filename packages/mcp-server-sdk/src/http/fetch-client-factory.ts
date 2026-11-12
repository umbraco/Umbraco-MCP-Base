/**
 * Factory for Umbraco fetch clients with their own config and token cache.
 */

import { assertTlsNotDisabledForRemote } from "../helpers/url.js";
import { executeUmbracoRequest } from "./request.js";
import { DEFAULT_TOKEN_PATH, requestClientCredentialsToken, resolveAuthConfig } from "./token.js";
import type { UmbracoFetchAuthConfig, UmbracoManagementClientOptions } from "./types.js";

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
