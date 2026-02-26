/**
 * HTTP Utilities
 *
 * Axios client factory and Orval helpers for Umbraco API access.
 */

export {
  // Singleton exports (recommended for most use cases)
  UmbracoAxios,
  initializeUmbracoAxios,
  isUmbracoAxiosInitialized,
  clearUmbracoAxiosToken,
  UmbracoManagementClient,
  // Custom transport for non-Axios environments (e.g., Workers)
  setCustomTransport,
  // Types
  type UmbracoAxiosAuthConfig,
  type UmbracoManagementClientOptions,
  type CustomTransport,
} from "./umbraco-axios-client.js";

// Factory for advanced use cases
export {
  createUmbracoAxiosClient,
  type CreateUmbracoAxiosClientOptions,
  type UmbracoAxiosClientResult,
} from "./umbraco-axios-factory.js";

export { orvalImportFixer } from "./orval-import-fixer.js";
