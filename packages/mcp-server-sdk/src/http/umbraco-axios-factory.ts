/**
 * Umbraco Axios Client Factory
 *
 * Factory for creating custom Umbraco Axios client instances.
 * Use this for advanced scenarios where you need multiple clients
 * or custom configuration. For most cases, use the pre-configured
 * `UmbracoAxios` and `initializeUmbracoAxios()` from the main module.
 */

import Axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import https from "https";
import qs from "qs";
import {
  UmbracoAxiosAuthConfig,
  UmbracoManagementClientOptions,
  DEFAULT_TOKEN_PATH,
} from "./umbraco-axios-client.js";

/**
 * Options for creating a custom Umbraco Axios client.
 */
export interface CreateUmbracoAxiosClientOptions {
  /** Token endpoint path (defaults to Umbraco's standard path) */
  tokenPath?: string;
  /** Whether to reject unauthorized certificates (defaults to true in production) */
  rejectUnauthorized?: boolean;
  /** Enable request/response logging (defaults to false) */
  enableLogging?: boolean;
}

/**
 * Result of creating a custom Umbraco Axios client.
 */
export interface UmbracoAxiosClientResult {
  /** The configured Axios instance */
  client: AxiosInstance;
  /** Initialize the client with authentication config */
  initialize: (config: UmbracoAxiosAuthConfig) => void;
  /** Check if the client has been initialized */
  isInitialized: () => boolean;
  /** Clear the current access token */
  clearToken: () => void;
  /** Orval mutator for this client */
  mutator: <T>(config: AxiosRequestConfig, options?: UmbracoManagementClientOptions) => Promise<T>;
}

/**
 * Creates a new Umbraco Axios client instance.
 *
 * Use this for advanced scenarios where you need multiple clients
 * or custom configuration. For most cases, use the pre-configured
 * `UmbracoAxios` and `initializeUmbracoAxios()` instead.
 *
 * @param options - Client configuration options
 * @returns Object containing the client, initialization function, and mutator
 */
export function createUmbracoAxiosClient(
  options: CreateUmbracoAxiosClientOptions = {}
): UmbracoAxiosClientResult {
  const {
    tokenPath = DEFAULT_TOKEN_PATH,
    rejectUnauthorized = process.env.NODE_ENV === "production",
    enableLogging = false,
  } = options;

  // State for this instance
  let instanceAuthConfig: UmbracoAxiosAuthConfig | null = null;
  let instanceAccessToken: string | null = null;
  let instanceTokenExpiry: number | null = null;

  const instanceHttpsAgent = new https.Agent({ rejectUnauthorized });
  const client = Axios.create({ httpsAgent: instanceHttpsAgent });

  client.defaults.paramsSerializer = (params) =>
    qs.stringify(params, { arrayFormat: "repeat" });

  const fetchToken = async (): Promise<string> => {
    if (!instanceAuthConfig) {
      throw new Error("Client not initialized. Call initialize() first.");
    }

    const response = await Axios.post(
      `${instanceAuthConfig.baseUrl}${tokenPath}`,
      {
        client_id: instanceAuthConfig.clientId,
        client_secret: instanceAuthConfig.clientSecret ?? "",
        grant_type: "client_credentials",
      },
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        httpsAgent: instanceHttpsAgent,
      }
    );

    const { access_token, expires_in } = response.data;
    instanceAccessToken = access_token;
    instanceTokenExpiry = Date.now() + expires_in * 1000;
    return access_token;
  };

  client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    if (!instanceAccessToken || (instanceTokenExpiry && Date.now() >= instanceTokenExpiry)) {
      await fetchToken();
    }
    if (instanceAccessToken) {
      config.headers.Authorization = `Bearer ${instanceAccessToken}`;
    }
    return config;
  });

  if (enableLogging) {
    client.interceptors.request.use((request) => {
      console.log("Request:", request.method?.toUpperCase(), request.url);
      return request;
    });
  }

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response) {
        console.error(`HTTP Error: ${error.response.status}`, error.response.data);
      } else if (error.request) {
        console.error("No response received:", error.request);
      } else {
        console.error("Error setting up request:", error.message);
      }
      return Promise.reject(error);
    }
  );

  if (enableLogging) {
    client.interceptors.response.use((response) => {
      console.log("Response:", response.status, response.config.url);
      return response;
    });
  }

  const mutator = <T>(config: AxiosRequestConfig, opts?: UmbracoManagementClientOptions): Promise<T> => {
    const source = Axios.CancelToken.source();
    const promise = client({
      ...config,
      ...opts,
      cancelToken: source.token,
    }).then((response: AxiosResponse) => (opts?.returnFullResponse ? response : response.data));
    // @ts-ignore
    promise.cancel = () => source.cancel("Query was cancelled");
    return promise;
  };

  return {
    client,
    initialize: (config: UmbracoAxiosAuthConfig) => {
      const { clientId, clientSecret, baseUrl } = config;
      if (!baseUrl) throw new Error("Missing required configuration: baseUrl");
      if (!clientId) throw new Error("Missing required configuration: clientId");
      if (!clientSecret && clientId !== "umbraco-swagger") {
        throw new Error("Missing required configuration: clientSecret");
      }
      instanceAuthConfig = config;
      client.defaults.baseURL = baseUrl;
    },
    isInitialized: () => instanceAuthConfig !== null,
    clearToken: () => {
      instanceAccessToken = null;
      instanceTokenExpiry = null;
    },
    mutator,
  };
}
