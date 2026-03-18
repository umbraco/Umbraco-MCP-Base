/**
 * HTTP Utilities
 *
 * Fetch-based client and Orval helpers for Umbraco API access.
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
  // Backwards-compatible aliases
  initializeUmbracoFetch as initializeUmbracoAxios,
  isUmbracoFetchInitialized as isUmbracoAxiosInitialized,
  clearUmbracoFetchToken as clearUmbracoAxiosToken,
  // Types
  type UmbracoFetchAuthConfig,
  type UmbracoFetchAuthConfig as UmbracoAxiosAuthConfig,
  type UmbracoManagementClientOptions,
  type CustomTransport,
  type CreateUmbracoFetchClientOptions,
  type CreateUmbracoFetchClientOptions as CreateUmbracoAxiosClientOptions,
  type UmbracoFetchClientResult,
  type UmbracoFetchClientResult as UmbracoAxiosClientResult,
} from "./umbraco-fetch-client.js";

export { createUmbracoFetchClient as createUmbracoAxiosClient } from "./umbraco-fetch-client.js";

export { orvalImportFixer } from "./orval-import-fixer.js";
