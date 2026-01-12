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
