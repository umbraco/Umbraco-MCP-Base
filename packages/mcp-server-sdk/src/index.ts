/**
 * @umbraco-cms/mcp-server-sdk
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
  configureToolResultMode,
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
  type HttpResponse,
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

// Input Sanitization
export {
  rejectControlCharacters,
  rejectPathTraversal,
  rejectEmbeddedQueryParams,
  rejectPreEncodedStrings,
  sanitizeStringInput,
  validateUUID,
  withInputSanitization,
  RAW_FIELD_MARKER,
  type SanitizeStringOptions,
} from "./helpers/input-sanitizer.js";

// Response Trimming
export {
  trimArrayResponse,
  summarizeDeepResponse,
  estimateTokenSize,
  pickFields,
  omitFields,
  type TrimArrayOptions,
  type SummarizeDeepOptions,
} from "./helpers/response-trimmer.js";

// Dry-Run Mode
export {
  configureDryRunMode,
  isDryRunEnabled,
  withDryRun,
} from "./helpers/dry-run.js";

// Server Reference (for tools that need elicitation)
export {
  setServerRef,
  getServerRef,
  clearServerRef,
} from "./helpers/server-ref.js";

// Elicitation Helpers
export {
  confirmAction,
  ElicitationUnsupportedError,
  type ConfirmActionOptions,
} from "./helpers/elicitation.js";

// Chained Result Extraction
export { extractChainedResult } from "./helpers/chained-result.js";

// Cursor-Based Pagination
export {
  withCursorPagination,
  encodeCursor,
  decodeCursor,
  computeNextCursor,
  type CursorPaginationOptions,
  type CursorPaginatedArgs,
} from "./helpers/cursor-pagination.js";

// URL helpers
export { normalizeBaseUrl } from "./helpers/url.js";

// CLI Introspection & Context Generation
export {
  toolToJsonSchema,
  toolToSummary,
  formatToolTable,
  generateContextFile,
  handleCliCommands,
  createPermissiveCodegenUser,
  type ToolSummary,
  type GenerateContextOptions,
  type HandleCliCommandsOptions,
} from "./cli/index.js";

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
} from "./tool-filtering/collection-config-loader.js";

export {
  shouldIncludeTool,
  filterTools,
  type ToolFilterContext,
} from "./tool-filtering/tool-filter.js";

export {
  validateSliceNames,
} from "./tool-filtering/slice-matcher.js";

export {
  validateModeNames,
  expandModesToCollections,
  getModeExpansionSummary,
  type ModeValidationResult,
} from "./tool-filtering/mode-expander.js";

// ============================================================================
// MCP Client (Chaining)
// ============================================================================

export {
  McpClientManager,
  createMcpClientManager,
  discoverProxiedTools,
  isProxiedToolName,
  parseProxiedToolName,
  createProxyHandler,
  proxiedToolsToDefinitions,
  type McpServerConfig,
  type McpClientOptions,
  type FilterConfig,
  type ProxiedTool,
} from "./mcp-client/index.js";

// ============================================================================
// Version Check
// ============================================================================

export {
  VersionCheckService,
  versionCheckService,
  checkUmbracoVersion,
  getVersionCheckMessage,
  clearVersionCheckMessage,
  isToolExecutionBlocked,
  type VersionCheckClient,
  type CheckVersionOptions,
} from "./version-check/check-umbraco-version.js";

// ============================================================================
// Server Configuration
// ============================================================================

export {
  getServerConfig,
  type UmbracoAuthConfig,
  type UmbracoServerConfig,
  type ConfigFieldDefinition,
  type ConfigFieldType,
  type GetServerConfigOptions,
  type GetServerConfigResult,
} from "./config/config.js";

// ============================================================================
// Constants
// ============================================================================

export {
  BLANK_UUID,
  TRANSLATORS_USER_GROUP_ID,
  WRITERS_USER_GROUP_ID,
  Default_Memeber_TYPE_ID,
  TextString_DATA_TYPE_ID,
  MEDIA_PICKER_DATA_TYPE_ID,
  MEMBER_PICKER_DATA_TYPE_ID,
  TAG_DATA_TYPE_ID,
  FOLDER_MEDIA_TYPE_ID,
  IMAGE_MEDIA_TYPE_ID,
  FILE_MEDIA_TYPE_ID,
  VIDEO_MEDIA_TYPE_ID,
  AUDIO_MEDIA_TYPE_ID,
  ARTICLE_MEDIA_TYPE_ID,
  VECTOR_GRAPHICS_MEDIA_TYPE_ID,
  MEDIA_TYPE_FOLDER,
  MEDIA_TYPE_IMAGE,
  MEDIA_TYPE_FILE,
  MEDIA_TYPE_VIDEO,
  MEDIA_TYPE_AUDIO,
  MEDIA_TYPE_ARTICLE,
  MEDIA_TYPE_VECTOR_GRAPHICS,
  STANDARD_MEDIA_TYPES,
} from "./constants/constants.js";

// ============================================================================
// File Utilities
// ============================================================================

export {
  detectFileExtensionFromBuffer,
} from "./file/detect-file-extension.js";

// ============================================================================
// HTTP Utilities
// ============================================================================

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
  // Orval helpers
  orvalImportFixer,
  // Types
  type UmbracoFetchAuthConfig,
  type UmbracoManagementClientOptions,
  type CustomTransport,
  type CreateUmbracoFetchClientOptions,
  type UmbracoFetchClientResult,
} from "./http/index.js";
