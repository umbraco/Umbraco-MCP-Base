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
  // Types
  type UmbracoFetchAuthConfig,
  type UmbracoManagementClientOptions,
  type CustomTransport,
  type CreateUmbracoFetchClientOptions,
  type UmbracoFetchClientResult,
} from "./umbraco-fetch-client.js";

export { orvalImportFixer } from "./orval-import-fixer.js";
export {
  relaxUntypedArrays,
  type OpenApiDocumentLike,
} from "./orval-relax-untyped-arrays.js";
export {
  createUmbracoTargetMajorTransformer,
  extractSpecMajor,
  renderTargetMajorModule,
  DEFAULT_TARGET_MAJOR_CONSTANT,
  type OpenApiDocumentWithInfo,
  type UmbracoTargetMajorOptions,
} from "./orval-target-major-writer.js";
export {
  collectZodFiles,
  relaxUuidToGuid,
  camelCaseZodExports,
  restoreV7OptionalDefaults,
  postProcessZodFiles,
} from "./orval-zod-post-process.js";
