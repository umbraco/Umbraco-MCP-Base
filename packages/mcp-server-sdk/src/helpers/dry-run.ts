/**
 * Dry-Run Mode
 *
 * Validates requests locally without hitting the API.
 * Prevents data loss from hallucinated parameters by intercepting
 * mutation tools and returning a preview of what would execute.
 *
 * Read-only tools execute normally even in dry-run mode.
 */

import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodRawShape, ZodType } from "zod";
import { ToolDefinition } from "../types/tool-definition.js";
import { createToolResult } from "./tool-result.js";
import { resolveToolCallParams } from "./tool-call-params.js";

/**
 * Module-level dry-run toggle.
 */
let dryRunEnabled = false;

/**
 * Marker set on a tool that `withDryRun` can intercept (mutation tools only).
 * It is an enumerable symbol so it survives the `...tool` spread every other
 * decorator does. `withErrorHandling` reads it to know the tool's
 * `outputSchema` must not be advertised while dry-run is on — the preview
 * doesn't match it, and the MCP SDK rejects a result that doesn't.
 */
export const DRY_RUN_INTERCEPTS = Symbol("umbraco-mcp.dryRunIntercepts");

/**
 * Enable or disable dry-run mode globally.
 * When enabled, mutation tools return a preview instead of executing.
 *
 * @param enabled - Whether dry-run mode should be active
 */
export function configureDryRunMode(enabled: boolean): void {
  dryRunEnabled = enabled;
}

/**
 * Returns whether dry-run mode is currently enabled.
 */
export function isDryRunEnabled(): boolean {
  return dryRunEnabled;
}

/**
 * Decorator that intercepts mutation tools when dry-run mode is active.
 * Read-only tools (those with `readOnlyHint: true`) execute normally.
 * Mutation tools return a structured dry-run response without hitting the API.
 *
 * @param tool - The tool definition to wrap
 * @returns A new tool definition with dry-run support
 */
export function withDryRun<
  Args extends undefined | ZodRawShape,
  OutputArgs extends undefined | ZodRawShape | ZodType = undefined
>(
  tool: ToolDefinition<Args, OutputArgs>
): ToolDefinition<Args, OutputArgs> {
  const originalHandler = tool.handler;

  const wrapped: ToolDefinition<Args, OutputArgs> = {
    ...tool,
    handler: ((...params: any[]) => {
      if (!dryRunEnabled) {
        return originalHandler(...(params as [any, any]));
      }

      // Read-only tools execute normally in dry-run mode
      const isReadOnly = tool.annotations?.readOnlyHint === true;
      if (isReadOnly) {
        return originalHandler(...(params as [any, any]));
      }

      // `args` is `undefined` (not `extra` mis-bound to it) for a schema-less
      // tool — see tool-call-params.ts.
      const { args } = resolveToolCallParams(params);

      // Mutation tool — return dry-run preview
      return createToolResult({
        dryRun: true,
        toolName: tool.name,
        wouldExecute: true,
        inputReceived: args ?? {},
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint ?? false,
          destructiveHint: tool.annotations?.destructiveHint ?? false,
          idempotentHint: tool.annotations?.idempotentHint ?? false,
        },
      });
    }) as ToolCallback<Args>,
  };

  // Read-only tools are never intercepted, so they keep their outputSchema
  if (tool.annotations?.readOnlyHint !== true) {
    Object.defineProperty(wrapped, DRY_RUN_INTERCEPTS, {
      value: true,
      enumerable: true,
    });
  }

  return wrapped;
}
