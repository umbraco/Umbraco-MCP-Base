/**
 * Cursor-Based Pagination
 *
 * Transforms tools with skip/take pagination into cursor-based pagination.
 * Applied as a decorator at tool registration time — the LLM sees an opaque
 * cursor parameter instead of skip/take.
 *
 * The Umbraco API still uses skip/take internally; this module wraps it
 * transparently.
 */

import { z, type ZodRawShape, type ZodType } from "zod";
import type { ToolDefinition } from "../types/tool-definition.js";
import { createToolResultError } from "./tool-result.js";


// ============================================================================
// Cursor State
// ============================================================================

/** Internal cursor state — encoded as base64url JSON. */
interface CursorState {
  /** skip value */
  s: number;
  /** take value */
  t: number;
}

/** Default page size when no tool-specific override is set. */
const DEFAULT_PAGE_SIZE = 50;

// ============================================================================
// Cursor Encoding/Decoding
// ============================================================================

/**
 * Encodes pagination state into an opaque cursor string.
 * Uses base64url to avoid characters that confuse LLMs (+, /, =).
 */
export function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

/**
 * Decodes an opaque cursor string back into pagination state.
 * Throws on invalid input.
 */
export function decodeCursor(cursor: string): CursorState {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(json);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.s !== "number" ||
      typeof parsed.t !== "number" ||
      parsed.s < 0 ||
      parsed.t < 1
    ) {
      throw new Error("Invalid cursor structure");
    }

    return { s: parsed.s, t: parsed.t };
  } catch {
    throw new Error(
      "Invalid pagination cursor. Use the nextCursor value from a previous response."
    );
  }
}

/**
 * Computes the nextCursor for the response, or null if this is the last page.
 */
export function computeNextCursor(
  skip: number,
  take: number,
  total: number,
  itemsReturned: number
): string | null {
  const nextSkip = skip + itemsReturned;
  if (nextSkip >= total || itemsReturned === 0) return null;
  return encodeCursor({ s: nextSkip, t: take });
}

// ============================================================================
// Schema Helpers
// ============================================================================

/**
 * Extracts the default value from a Zod schema, if one is defined.
 * Handles chained schemas (e.g., z.coerce.number().default(100)).
 */
function extractZodDefault(schema: ZodType): number | undefined {
  const def = (schema as any)?._def;
  if (!def) return undefined;

  // Check for defaultValue (function or direct value)
  if (def.defaultValue !== undefined) {
    const val =
      typeof def.defaultValue === "function"
        ? def.defaultValue()
        : def.defaultValue;
    if (typeof val === "number") return val;
  }

  // Walk inner types (ZodOptional wraps ZodDefault, etc.)
  if (def.innerType) {
    return extractZodDefault(def.innerType);
  }

  return undefined;
}

// ============================================================================
// Decorator Options
// ============================================================================

export interface CursorPaginationOptions {
  /** Default page size for tools without an explicit pageSize (default: 50) */
  defaultPageSize?: number;
}

// ============================================================================
// Decorator
// ============================================================================

/**
 * Transforms a paginated tool's input/output for cursor-based pagination.
 *
 * - **Detection**: Only transforms tools whose inputSchema has both `skip` and `take`
 * - **Input**: Removes `skip`/`take`, adds optional `cursor` string
 * - **Handler**: Decodes cursor → skip/take, injects into args, calls original handler
 * - **Response**: Adds `nextCursor` to structuredContent and content fallback
 * - **Output schema**: Adds `nextCursor` field
 *
 * Pass-through for tools without skip/take — returns them unchanged.
 *
 * @param tool - The tool definition to transform
 * @param options - Optional configuration
 * @returns Transformed tool definition (or original if not paginated)
 */
export function withCursorPagination<
  InputArgs extends ZodRawShape,
  OutputArgs extends undefined | ZodRawShape | ZodType,
>(
  tool: ToolDefinition<InputArgs, OutputArgs>,
  options?: CursorPaginationOptions
): ToolDefinition<ZodRawShape, OutputArgs> {
  // Detection: only apply if inputSchema has both skip and take
  if (
    !tool.inputSchema ||
    !("skip" in tool.inputSchema) ||
    !("take" in tool.inputSchema)
  ) {
    return tool;
  }

  const defaultPageSize = options?.defaultPageSize ?? DEFAULT_PAGE_SIZE;

  // Read the tool's explicit pageSize or extract from zod schema or fall back to default
  const toolPageSize =
    (tool as any).pageSize ??
    extractZodDefault(tool.inputSchema.take as ZodType) ??
    defaultPageSize;

  // Build new input schema: remove skip/take, add cursor
  const { skip: _skip, take: _take, ...restInput } = tool.inputSchema;
  const newInputSchema: ZodRawShape = {
    ...restInput,
    cursor: z
      .string()
      .optional()
      .describe(
        "Pagination cursor from a previous response's nextCursor field. Omit for the first page."
      ),
  };

  // Build new output schema: add nextCursor
  const nextCursorSchema = z
    .string()
    .nullish()
    .describe(
      "Cursor for the next page. Pass as the cursor parameter to fetch more results. Absent when on the last page."
    );

  let newOutputSchema = tool.outputSchema;
  if (tool.outputSchema && typeof tool.outputSchema === "object") {
    if ("_def" in tool.outputSchema) {
      // It's a ZodType (e.g. z.object({...})) — extend it
      const zodObj = tool.outputSchema as z.ZodObject<any>;
      if (typeof zodObj.extend === "function") {
        newOutputSchema = zodObj.extend({ nextCursor: nextCursorSchema }) as any;
      }
    } else {
      // It's a ZodRawShape (plain object), add nextCursor field
      newOutputSchema = {
        ...(tool.outputSchema as ZodRawShape),
        nextCursor: nextCursorSchema,
      } as any;
    }
  }

  return {
    ...tool,
    inputSchema: newInputSchema,
    outputSchema: newOutputSchema,
    handler: async (args: any, extra: any) => {
      // Decode cursor or use defaults
      const { cursor, ...restArgs } = args;
      let skipVal = 0;
      let takeVal = toolPageSize;

      if (cursor) {
        try {
          const state = decodeCursor(cursor);
          skipVal = state.s;
          takeVal = state.t;
        } catch (err: any) {
          return createToolResultError({
            type: "Error",
            title: "Invalid Cursor",
            status: 400,
            detail: err.message,
          });
        }
      }

      // Call original handler with skip/take injected
      const result = await (tool.handler as Function)(
        { ...restArgs, skip: skipVal, take: takeVal },
        extra
      );

      // Add nextCursor to structuredContent
      if (
        result.structuredContent &&
        typeof result.structuredContent === "object"
      ) {
        const sc = result.structuredContent as Record<string, unknown>;
        const total = sc.total;
        const items = sc.items;
        if (typeof total === "number" && Array.isArray(items)) {
          const nextCursor = computeNextCursor(
            skipVal,
            takeVal,
            total,
            items.length
          );
          result.structuredContent = {
            ...sc,
            nextCursor: nextCursor ?? undefined,
          };
        }
      }

      // Also update the text content fallback if present
      if (result.content?.[0]?.text) {
        try {
          const parsed = JSON.parse(result.content[0].text);
          if (parsed && typeof parsed === "object" && typeof parsed.total === "number") {
            const nextCursor = computeNextCursor(
              skipVal,
              takeVal,
              parsed.total,
              parsed.items?.length ?? 0
            );
            if (nextCursor) {
              parsed.nextCursor = nextCursor;
            }
            result.content[0].text = JSON.stringify(parsed);
          }
        } catch {
          /* ignore non-JSON content */
        }
      }

      return result;
    },
  };
}
