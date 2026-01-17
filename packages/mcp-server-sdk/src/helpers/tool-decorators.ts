/**
 * Tool Decorators
 *
 * This module provides decorator functions for wrapping MCP tool handlers
 * with cross-cutting concerns like error handling.
 */

import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodRawShape, ZodType } from "zod";
import { ToolDefinition, ToolAnnotations } from "../types/tool-definition.js";
import { createToolResultError } from "./tool-result.js";
import { UmbracoApiError } from "./api-call-helpers.js";
import { ToolValidationError } from "./tool-validation-error.js";

// Re-export everything from split modules for convenience
export {
  createToolResult,
  createToolResultError,
} from "./tool-result.js";

export { ToolValidationError, type ValidationErrorDetails } from "./tool-validation-error.js";

export {
  CAPTURE_RAW_HTTP_RESPONSE,
  processVoidResponse,
  executeVoidApiCall,
  executeGetApiCall,
  executeGetItemsApiCall,
  executeVoidApiCallWithOptions,
  UmbracoApiError,
  configureApiClient,
  getApiClient,
  type ApiCallOptions,
  type VoidApiCallOptions,
  type ApiCallFn,
  type ClientProvider,
} from "./api-call-helpers.js";

/**
 * Wraps a tool handler with standardized error handling.
 * Catches all errors and converts them to MCP tool error results.
 *
 * Error handling priority:
 * 1. ToolValidationError - Business logic validation errors with context
 * 2. UmbracoApiError - API errors with ProblemDetails (from helpers)
 * 3. Axios errors - Network/HTTP errors with response data
 * 4. Standard errors - JavaScript errors with message
 * 5. Unknown errors - Anything else
 */
export function withErrorHandling<Args extends undefined | ZodRawShape, OutputArgs extends undefined | ZodRawShape | ZodType = undefined>(
  tool: ToolDefinition<Args, OutputArgs>
): ToolDefinition<Args, OutputArgs> {
  const originalHandler = tool.handler;

  return {
    ...tool,
    handler: (async (args: any, context: any) => {
      try {
        return await originalHandler(args, context);
      } catch (error) {
        console.error(`Error in tool ${tool.name}:`, error);

        let errorResult;

        // ToolValidationError - business logic validation errors with context
        if (error instanceof ToolValidationError) {
          errorResult = createToolResultError(error.toProblemDetails());
        }
        // UmbracoApiError - thrown by helpers with ProblemDetails
        else if (error instanceof UmbracoApiError) {
          errorResult = createToolResultError(error.problemDetails);
        }
        // Axios error with response data (network succeeded but got error response)
        else if (error instanceof Error && (error as any).response?.data) {
          errorResult = createToolResultError((error as any).response.data);
        }
        // Standard Error - convert to ProblemDetails format
        else if (error instanceof Error) {
          errorResult = createToolResultError({
            type: "Error",
            title: error.name || "Error",
            detail: error.message,
            status: 500
          });
        }
        // Unknown error type - convert to ProblemDetails format
        else {
          errorResult = createToolResultError({
            type: "Error",
            title: "Unknown Error",
            detail: String(error),
            status: 500
          });
        }

        return errorResult;
      }
    }) as ToolCallback<Args>,
  };
}

/**
 * Hook type for custom pre-execution checks (e.g., version checking).
 * Return undefined to allow execution, or return an error result to block.
 */
export type PreExecutionHook = () => {
  blocked: boolean;
  message?: string;
  clearAfterUse?: () => void;
} | undefined;

// Store for custom pre-execution hooks
let preExecutionHook: PreExecutionHook | null = null;

/**
 * Configures a pre-execution hook that runs before each tool execution.
 * Use this for custom checks like version validation.
 *
 * @param hook - Function that returns blocking info, or undefined to allow
 *
 * @example
 * ```typescript
 * configurePreExecutionHook(() => {
 *   if (isVersionMismatch()) {
 *     return {
 *       blocked: true,
 *       message: "Version mismatch detected",
 *       clearAfterUse: () => clearVersionWarning()
 *     };
 *   }
 *   return undefined;
 * });
 * ```
 */
export function configurePreExecutionHook(hook: PreExecutionHook): void {
  preExecutionHook = hook;
}

/**
 * Wraps a tool handler with pre-execution checks.
 * Uses the configured pre-execution hook to potentially block execution.
 */
export function withPreExecutionCheck<Args extends undefined | ZodRawShape, OutputArgs extends undefined | ZodRawShape | ZodType = undefined>(
  tool: ToolDefinition<Args, OutputArgs>
): ToolDefinition<Args, OutputArgs> {
  const originalHandler = tool.handler;

  return {
    ...tool,
    handler: (async (args: any, context: any) => {
      // Check if there's a pre-execution hook and if it blocks
      if (preExecutionHook) {
        const result = preExecutionHook();
        if (result?.blocked) {
          // Clear after showing the message
          if (result.clearAfterUse) {
            result.clearAfterUse();
          }
          return {
            content: [{
              type: "text" as const,
              text: `${result.message ?? "Execution blocked"}\n\n⚠️ Tool execution paused.\n\nIf you understand the risks and want to proceed anyway, please retry your request.`,
            }],
            isError: true,
          };
        }
      }

      return await originalHandler(args, context);
    }) as ToolCallback<Args>,
  };
}

/**
 * Composes multiple decorator functions together.
 * Decorators are applied from right to left (last decorator applied first).
 *
 * @example
 * compose(withErrorHandling, withPreExecutionCheck)(myTool)
 * // Equivalent to: withErrorHandling(withPreExecutionCheck(myTool))
 */
export function compose<Args extends undefined | ZodRawShape, OutputArgs extends undefined | ZodRawShape | ZodType = undefined>(
  ...decorators: Array<(tool: ToolDefinition<Args, OutputArgs>) => ToolDefinition<Args, OutputArgs>>
): (tool: ToolDefinition<Args, OutputArgs>) => ToolDefinition<Args, OutputArgs> {
  return (tool: ToolDefinition<Args, OutputArgs>) =>
    decorators.reduceRight((decorated, decorator) => decorator(decorated), tool);
}

/**
 * Creates annotations for a tool, ensuring openWorldHint is always true.
 * Tools should explicitly define their annotations with only true values (readOnlyHint, destructiveHint, idempotentHint).
 * This function ensures openWorldHint is set to true and provides defaults for missing values.
 *
 * @param tool - The tool definition
 * @returns Complete annotations object with defaults applied
 */
export function createToolAnnotations(tool: ToolDefinition<any, any>): ToolAnnotations {
  // Tool annotations only contain explicit true values
  const toolAnnotations = tool.annotations || {};

  return {
    readOnlyHint: toolAnnotations.readOnlyHint ?? false,  // Default to false if not specified
    destructiveHint: toolAnnotations.destructiveHint ?? false,  // Default to false if not specified
    idempotentHint: toolAnnotations.idempotentHint ?? false,  // Default to false if not specified
    openWorldHint: true,  // Always true - all tools interact with external API
    ...(toolAnnotations.title && { title: toolAnnotations.title }),  // Include title if provided
  };
}

/**
 * Standard decorator composition for all tools.
 * Applies: withPreExecutionCheck -> withErrorHandling
 *
 * @example
 * export default withStandardDecorators(myTool);
 */
export function withStandardDecorators<Args extends undefined | ZodRawShape, OutputArgs extends undefined | ZodRawShape | ZodType = undefined>(
  tool: ToolDefinition<Args, OutputArgs>
): ToolDefinition<Args, OutputArgs> {
  return compose<Args, OutputArgs>(withErrorHandling, withPreExecutionCheck)(tool);
}
