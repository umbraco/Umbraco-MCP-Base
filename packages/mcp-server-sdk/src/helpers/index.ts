/**
 * MCP Toolkit Helpers
 *
 * This module exports all helper functions for building MCP tools.
 */

// Tool decorators and error handling
export {
  withErrorHandling,
  withPreExecutionCheck,
  compose,
  createToolAnnotations,
  withStandardDecorators,
  configurePreExecutionHook,
  type PreExecutionHook,
} from "./tool-decorators.js";

// API call helpers
export {
  UmbracoApiError,
  CAPTURE_RAW_HTTP_RESPONSE,
  processVoidResponse,
  executeVoidApiCall,
  executeGetApiCall,
  executeGetItemsApiCall,
  executeVoidApiCallWithOptions,
  configureApiClient,
  getApiClient,
  type ApiCallFn,
  type ApiCallOptions,
  type VoidApiCallOptions,
  type ClientProvider,
} from "./api-call-helpers.js";

// Tool result helpers
export {
  configureToolResultMode,
  createToolResult,
  createToolResultError,
} from "./tool-result.js";

// Validation error
export {
  ToolValidationError,
  type ValidationErrorDetails,
} from "./tool-validation-error.js";

// Problem details type
export { type ProblemDetails } from "./problem-details.js";

// Input sanitization
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
} from "./input-sanitizer.js";

// Response trimming
export {
  trimArrayResponse,
  summarizeDeepResponse,
  estimateTokenSize,
  pickFields,
  omitFields,
  type TrimArrayOptions,
  type SummarizeDeepOptions,
} from "./response-trimmer.js";

// Dry-run mode
export {
  configureDryRunMode,
  isDryRunEnabled,
  withDryRun,
} from "./dry-run.js";

// Server reference (for tools that need elicitation)
export {
  setServerRef,
  getServerRef,
  clearServerRef,
} from "./server-ref.js";

// Elicitation helpers
export {
  confirmAction,
  type ConfirmActionOptions,
} from "./elicitation.js";

// Chained result extraction
export { extractChainedResult } from "./chained-result.js";

// Cursor-based pagination
export {
  withCursorPagination,
  encodeCursor,
  decodeCursor,
  computeNextCursor,
  type CursorPaginationOptions,
} from "./cursor-pagination.js";
