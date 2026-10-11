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
 * error messages, or ProblemDetails `detail` and `type`. Argument values are
 * customer content, and `withErrorHandling` forwards `error.message` and
 * `detail` verbatim — both routinely carry paths, ids and payloads. Only the
 * error's *category*, problem `title`, `status` and `operationStatus` leave
 * this module. The last three are exported as received (a chained or remote
 * side chooses them), so each is type-checked and length-capped, and
 * `operationStatus` must also look like an enum name.
 */

import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodRawShape, ZodType } from "zod";
import { ToolDefinition } from "../types/tool-definition.js";
import { ToolValidationError } from "../helpers/tool-validation-error.js";
import { UmbracoApiError } from "../helpers/api-call-helpers.js";
import { isDryRunEnabled } from "../helpers/dry-run.js";
import { resolveToolCallParams } from "../helpers/tool-call-params.js";
import {
  getTelemetryAdapter,
  type SpanAttributes,
  type TelemetrySpan,
} from "./adapter.js";
import { getToolCollection } from "./tool-collection-registry.js";
import { applyRequestTelemetryAttributes } from "./request-context.js";
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

/** Longest error title / operationStatus value exported on a span. */
const MAX_ERROR_VALUE_LENGTH = 100;

/** Umbraco's `operationStatus` values are enum names; anything else is dropped. */
const OPERATION_STATUS_PATTERN = /^[A-Za-z]+$/;

interface ProblemFields {
  title?: string;
  status?: number;
  operationStatus?: string;
}

/**
 * Extracts the exportable problem fields from a thrown error or a parsed
 * problem-details object. Never reads `detail`, `type`, the message or
 * anything else — adding a field here is a privacy decision.
 */
function problemFields(value: unknown): ProblemFields {
  if (typeof value !== "object" || value === null) {
    return {};
  }

  let problem: Record<string, unknown> = value as Record<string, unknown>;
  let fallbackTitle: string | undefined;
  let fallbackStatus: unknown;

  if (value instanceof ToolValidationError) {
    problem = value.details as unknown as Record<string, unknown>;
  } else if (value instanceof UmbracoApiError) {
    problem = value.problemDetails as Record<string, unknown>;
  } else if (value instanceof Error) {
    const response = (value as { response?: { data?: unknown; status?: unknown } }).response;
    problem =
      typeof response?.data === "object" && response.data !== null
        ? (response.data as Record<string, unknown>)
        : {};
    fallbackTitle = value.name;
    fallbackStatus = response?.status;
  }

  const fields: ProblemFields = {};

  const title = typeof problem.title === "string" ? problem.title : fallbackTitle;
  if (title) {
    fields.title = title.slice(0, MAX_ERROR_VALUE_LENGTH);
  }

  const status = typeof problem.status === "number" ? problem.status : fallbackStatus;
  if (typeof status === "number" && Number.isFinite(status)) {
    fields.status = status;
  }

  const operationStatus = problem.operationStatus;
  if (typeof operationStatus === "string" && OPERATION_STATUS_PATTERN.test(operationStatus)) {
    fields.operationStatus = operationStatus.slice(0, MAX_ERROR_VALUE_LENGTH);
  }

  return fields;
}

/**
 * Problem fields for a returned `isError` result. The text is whatever the
 * inner decorators produced — for a chained Umbraco 400 it is the
 * JSON-stringified problem details — so a non-JSON body yields nothing.
 */
function problemFieldsFromResult(result: unknown): ProblemFields {
  try {
    const text = (result as { content?: Array<{ text?: unknown }> }).content?.[0]?.text;
    return typeof text === "string" ? problemFields(JSON.parse(text)) : {};
  } catch {
    return {};
  }
}

function setProblemAttributes(span: TelemetrySpan, fields: ProblemFields): void {
  if (fields.title !== undefined) {
    span.setAttribute(TelemetryAttributes.ERROR_TITLE, fields.title);
  }
  if (fields.status !== undefined) {
    span.setAttribute(TelemetryAttributes.ERROR_STATUS, fields.status);
  }
  if (fields.operationStatus !== undefined) {
    span.setAttribute(TelemetryAttributes.ERROR_OPERATION_STATUS, fields.operationStatus);
  }
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
    handler: (async (...params: any[]) => {
      const { context } = resolveToolCallParams(params) as { context: any };

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

      // Tenant / region / login session, read fresh off this call's own
      // context for the same reason `sessionId` is: the active adapter is
      // module-scoped and shared by every Durable Object in the isolate, so
      // nothing request-shaped may be closed over there. See
      // `request-context.ts`.
      applyRequestTelemetryAttributes(attributes, context);

      let handlerStarted = false;
      const run = async (span: TelemetrySpan) => {
        handlerStarted = true;
        try {
          const result = await (originalHandler as (...a: any[]) => any)(...params);
          const outcome = classifyResult(result);
          span.setAttribute(TelemetryAttributes.OUTCOME, outcome);
          if (outcome === "error_result") {
            setProblemAttributes(span, problemFieldsFromResult(result));
          }
          return result;
        } catch (error) {
          span.setAttribute(TelemetryAttributes.OUTCOME, classifyThrown(error));
          setProblemAttributes(span, problemFields(error));
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
