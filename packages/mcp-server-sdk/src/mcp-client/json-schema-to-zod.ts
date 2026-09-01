/**
 * JSON Schema -> Zod Conversion
 *
 * Chained MCP servers advertise tool parameters as JSON Schema (the wire
 * format), but `McpServer.registerTool()` requires a Zod schema. Without
 * converting the two, a proxied tool has to fall back to a schema with no
 * declared properties — which advertises zero parameters to the calling
 * client, so it never sends any arguments and the tool silently no-ops.
 *
 * Delegates to Zod v4's own `z.fromJSONSchema()` — already a direct
 * dependency, and a real runtime function that returns an actual Zod
 * schema instance. This must work inside a Cloudflare Worker, where
 * `eval`/`new Function` are unavailable, which rules out codegen-style
 * libraries (e.g. the now-deprecated `json-schema-to-zod`) that only
 * emit Zod as generated source code.
 */

import { z } from "zod";

/** A JSON Schema fragment, as returned by a chained server's `tools/list`. */
export type JsonSchema = Record<string, unknown>;

/**
 * Converts a proxied tool's JSON Schema `inputSchema` into a Zod schema
 * for `registerTool()`. Falls back to an empty object schema when no
 * schema was provided (a legitimately zero-argument tool).
 */
export function jsonSchemaObjectToZodObject(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.object({});
  }
  return z.fromJSONSchema(schema as JsonSchema);
}
