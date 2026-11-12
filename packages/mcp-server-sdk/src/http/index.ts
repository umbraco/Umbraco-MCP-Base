/**
 * HTTP Utilities
 *
 * Fetch-based client for Umbraco API access.
 */

export {
  // Singleton exports (recommended for most use cases)
  initializeUmbracoFetch,
  isUmbracoFetchInitialized,
  clearUmbracoFetchToken,
  UmbracoManagementClient,
  // Custom transport for specialized environments
  setCustomTransport,
  // Factory for advanced use cases
  createUmbracoFetchClient,
  // Request building, shared with other Umbraco fetch clients (e.g. hosted)
  buildFetchBody,
  assertSafeRequestPath,
  serializeParams,
  // Types
  type UmbracoFetchAuthConfig,
  type UmbracoManagementClientOptions,
  type CustomTransport,
  type CreateUmbracoFetchClientOptions,
  type UmbracoFetchClientResult,
} from "./umbraco-fetch-client.js";
