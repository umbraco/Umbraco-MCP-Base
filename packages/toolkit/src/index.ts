/**
 * @umbraco-cms/mcp-toolkit
 *
 * Umbraco-specific MCP infrastructure and patterns for building MCP servers
 * that expose Umbraco APIs.
 *
 * @packageDocumentation
 */

// ============================================================================
// Tool Creation Helpers
// ============================================================================

export {
  createToolResult,
  createToolResultError,
} from "./helpers/tool-result.js";

export {
  withErrorHandling,
  withPreExecutionCheck,
  compose,
  createToolAnnotations,
  withStandardDecorators,
  configurePreExecutionHook,
  type PreExecutionHook,
} from "./helpers/tool-decorators.js";

export {
  executeVoidApiCall,
  executeGetApiCall,
  executeGetItemsApiCall,
  executeVoidApiCallWithOptions,
  processVoidResponse,
  CAPTURE_RAW_HTTP_RESPONSE,
  UmbracoApiError,
  configureApiClient,
  getApiClient,
  type ApiCallFn,
  type ApiCallOptions,
  type VoidApiCallOptions,
  type ClientProvider,
} from "./helpers/api-call-helpers.js";

export {
  ToolValidationError,
  type ValidationErrorDetails,
} from "./helpers/tool-validation-error.js";

export {
  type ProblemDetails,
} from "./helpers/problem-details.js";

// ============================================================================
// Types
// ============================================================================

export {
  type ToolDefinition,
  type ToolAnnotations,
  type UserModel,
  type BaseSliceName,
  baseSliceNames,
  allBaseSliceNames,
} from "./types/tool-definition.js";

export {
  type ToolCollectionMetadata,
  type ToolCollectionExport,
} from "./types/tool-collection.js";

export {
  type CollectionConfiguration,
  DEFAULT_COLLECTION_CONFIG,
} from "./types/collection-configuration.js";

export {
  type ToolModeDefinition,
} from "./types/tool-mode.js";

// ============================================================================
// Configuration
// ============================================================================

export {
  createCollectionConfigLoader,
  type ServerConfigForCollections,
  type CollectionConfigLoaderOptions,
} from "./config/collection-config-loader.js";

export {
  validateSliceNames,
} from "./config/slice-matcher.js";

export {
  validateModeNames,
  expandModesToCollections,
  getModeExpansionSummary,
  type ModeValidationResult,
} from "./config/mode-expander.js";
