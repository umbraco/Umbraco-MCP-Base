/**
 * Telemetry Decorator
 *
 * Wraps a tool handler in one span. Applied to every tool via
 * `withStandardDecorators`, so instrumentation is a property of the SDK rather
 * than something each tool author remembers.
 *
 * Position in the chain matters, and is asserted by tests:
 * - **Inside `withErrorHandling`** — that decorator is outermost and converts
 *   thrown errors into tool results, so anything further out would only ever
 *   observe a successful-looking return. Sitting inside it means failures
 *   arrive here as exceptions and can be classified.
 * - **Outside `withDryRun`** — a dry-run call is still a call worth counting,
 *   tagged as such rather than hidden.
 *
 * What this decorator deliberately does *not* record: tool arguments, results,
 * or error messages. Argument values are customer content, and
 * `withErrorHandling` forwards `error.message` and ProblemDetails `detail`
 * verbatim — both routinely carry paths, ids and payloads. Only the error's
 * *category* leaves this module.
 */

import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodRawShape, ZodType } from "zod";
import { ToolDefinition } from "../types/tool-definition.js";
import { ToolValidationError } from "../helpers/tool-validation-error.js";
import { UmbracoApiError } from "../helpers/api-call-helpers.js";
import { isDryRunEnabled } from "../helpers/dry-run.js";
import {
  getTelemetryAdapter,
  type SpanAttributes,
  type TelemetrySpan,
} from "./adapter.js";
import { getToolCollection } from "./tool-collection-registry.js";
import { TelemetryAttributes, TOOLS_CALL_METHOD, type ToolOutcome } from "./attributes.js";

/**
 * Classifies a thrown value, mirroring `withErrorHandling`'s branches so the
 * span outcome and the error the caller receives describe the same event.
 */
function classifyThrown(error: unknown): ToolOutcome {
  if (error instanceof ToolValidationError) {
    return "validation_error";
  }
  if (error instanceof UmbracoApiError) {
    return "api_error";
  }
  if (error instanceof Error) {
    // An error carrying a response body means the API answered — same bucket as
    // UmbracoApiError, which is what `withErrorHandling` effectively does too.
    return (error as { response?: { data?: unknown } }).response?.data !== undefined
      ? "api_error"
      : "handler_error";
  }
  return "unknown_error";
}

/**
 * Classifies a returned result. Inner decorators can signal failure by
 * *returning* `isError: true` instead of throwing — `withPreExecutionCheck`
 * does exactly that when a version mismatch blocks execution — and that must
 * not be counted as a success.
 */
function classifyResult(result: unknown): ToolOutcome {
  const isError =
    typeof result === "object" && result !== null && (result as { isError?: unknown }).isError;
  return isError === true ? "error_result" : "success";
}

/**
 * Wraps a tool handler so each invocation emits one span.
 *
 * @param tool - The tool definition to wrap
 * @returns The same tool with an instrumented handler
 */
export function withTelemetry<
  Args extends undefined | ZodRawShape,
  OutputArgs extends undefined | ZodRawShape | ZodType = undefined
>(tool: ToolDefinition<Args, OutputArgs>): ToolDefinition<Args, OutputArgs> {
  const originalHandler = tool.handler;

  // Everything knowable at decoration time is built once, not per call.
  const spanName = `${TOOLS_CALL_METHOD} ${tool.name}`;
  const staticAttributes: SpanAttributes = {
    [TelemetryAttributes.MCP_METHOD_NAME]: TOOLS_CALL_METHOD,
    [TelemetryAttributes.GEN_AI_TOOL_NAME]: tool.name,
    [TelemetryAttributes.READ_ONLY]: tool.annotations?.readOnlyHint === true,
    [TelemetryAttributes.DESTRUCTIVE]: tool.annotations?.destructiveHint === true,
  };
  if (tool.slices?.length) {
    staticAttributes[TelemetryAttributes.SLICES] = tool.slices.join(",");
  }

  return {
    ...tool,
    handler: (async (args: any, context: any) => {
      const attributes: SpanAttributes = {
        ...staticAttributes,
        // Per-call rather than static: dry-run is a runtime toggle.
        [TelemetryAttributes.DRY_RUN]: isDryRunEnabled(),
      };

      const collection = getToolCollection(tool.name);
      if (collection) {
        attributes[TelemetryAttributes.COLLECTION] = collection;
      }

      const sessionId = context?.sessionId;
      if (typeof sessionId === "string" && sessionId.length > 0) {
        attributes[TelemetryAttributes.MCP_SESSION_ID] = sessionId;
      }

      let handlerStarted = false;
      const run = async (span: TelemetrySpan) => {
        handlerStarted = true;
        try {
          const result = await originalHandler(args, context);
          span.setAttribute(TelemetryAttributes.OUTCOME, classifyResult(result));
          return result;
        } catch (error) {
          span.setAttribute(TelemetryAttributes.OUTCOME, classifyThrown(error));
          // Rethrow untouched — `withErrorHandling` owns turning this into a
          // tool result. Telemetry observes; it never changes the outcome.
          throw error;
        }
      };

      try {
        return await getTelemetryAdapter().startSpan(spanName, attributes, run);
      } catch (error) {
        if (handlerStarted) {
          // The handler ran, so this is its error (or one raised while closing
          // the span afterwards). Either way it belongs to the caller.
          throw error;
        }
        // The adapter failed before the handler ever ran — a misconfigured
        // exporter, say. Run the tool anyway: losing a span is acceptable,
        // failing the call because telemetry is broken is not.
        console.error(
          `[telemetry] adapter failed before invoking ${tool.name}; running without a span:`,
          error
        );
        return await run({ setAttribute() {} });
      }
    }) as ToolCallback<Args>,
  };
}
