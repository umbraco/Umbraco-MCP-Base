/**
 * Strict JSON Schema (Draft 2020-12) Tool Schemas
 *
 * `@modelcontextprotocol/sdk`'s `McpServer` always advertises tool
 * input/output schemas as JSON Schema draft-7, even on the latest
 * published SDK version. Its `ListTools` handler calls
 * `toJsonSchemaCompat()` without a `target`, which falls back to
 * `'draft-7'` — even though Zod v4's own `toJSONSchema()` already
 * defaults to `'draft-2020-12'`. There's no `ServerOptions`/`registerTool`
 * option to change it, and no Zod-side global config reaches it either:
 * the SDK's fallback is hardcoded in its own internal compat layer, on a
 * separate module (`zod/v4-mini`) from the one tools are defined with.
 *
 * Any MCP client that validates strictly against 2020-12 rejects every
 * tool with a schema outright, with no indication why — it just refuses
 * to call the tool. This is an upstream SDK bug (see
 * umbraco/Umbraco-MCP-Base for the report and repro), not something we
 * can fix in the dependency without patch-package. Instead, we override
 * the `ListTools` handler ourselves using the officially supported
 * `Server.setRequestHandler` ("this will replace any previous request
 * handler for the same method") and Zod v4's own correctly-defaulted
 * `toJSONSchema()`.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const EMPTY_OBJECT_JSON_SCHEMA = { type: "object" as const, properties: {} };

/** The shape of an entry in McpServer's internal `_registeredTools` registry. */
interface RegisteredToolLike {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
  execution?: unknown;
  _meta?: Record<string, unknown>;
  enabled: boolean;
}

/**
 * True for any Zod v4 schema instance — classic (`zod`) or Mini
 * (`zod/v4-mini`). Both flavors share the same `_zod` core marker; a raw
 * `ZodRawShape` (a plain `{ key: ZodType }` object) does not have it.
 * `McpServer` normalizes a raw shape into a `zod/v4-mini` object at
 * registration time, so `_registeredTools[name].inputSchema` is a Mini
 * instance even when `registerTool` was called with a raw shape —
 * `instanceof z.ZodType` (the classic-only class) would miss that case.
 */
function isZodSchema(value: unknown): boolean {
  return !!(value as { _zod?: unknown } | null)?._zod;
}

function toJsonSchema(schema: unknown, io: "input" | "output"): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  const zodSchema = isZodSchema(schema) ? (schema as z.ZodTypeAny) : z.object(schema as z.ZodRawShape);
  return z.toJSONSchema(zodSchema, { target: "draft-2020-12", io }) as Record<string, unknown>;
}

/**
 * Patches an `McpServer` instance so every tool it lists advertises JSON
 * Schema draft 2020-12 instead of draft-7.
 *
 * Reads the server's own live tool registry on every `ListTools` request
 * (rather than snapshotting it), so it stays correct regardless of
 * registration order — including tools registered after this call, or
 * later enabled/disabled/updated/removed via the handles `registerTool`
 * returns.
 *
 * Call once, after at least one `registerTool` call has already
 * succeeded on this server (`McpServer` only advertises the `tools`
 * capability — required before `ListTools` can be overridden at all —
 * once a tool has been registered). If no tool was ever registered,
 * this is a no-op: there is no `tools` capability to override, matching
 * the SDK's own default behaviour for a tool-less server.
 */
export function useDraft202012ToolSchemas(server: McpServer): void {
  try {
    server.server.setRequestHandler(ListToolsRequestSchema, () => {
      const registeredTools = (
        server as unknown as { _registeredTools: Record<string, RegisteredToolLike> }
      )._registeredTools;

      return {
        tools: Object.entries(registeredTools)
          .filter(([, tool]) => tool.enabled)
          .map(([name, tool]) => ({
            name,
            title: tool.title,
            description: tool.description,
            inputSchema: toJsonSchema(tool.inputSchema, "input") ?? EMPTY_OBJECT_JSON_SCHEMA,
            ...(tool.outputSchema ? { outputSchema: toJsonSchema(tool.outputSchema, "output") } : {}),
            annotations: tool.annotations,
            execution: tool.execution,
            _meta: tool._meta,
          })),
      };
    });
  } catch {
    // No tool was ever registered on this server, so the SDK never
    // advertised the "tools" capability — nothing to override.
  }
}
