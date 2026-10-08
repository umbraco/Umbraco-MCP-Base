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
 *
 * v2: the v2 SDK (@modelcontextprotocol/server) converts every schema to
 * draft 2020-12 itself (`JSON_SCHEMA_CONVERSION_TARGET`), so this ListTools
 * override can be deleted when we migrate. Opening output schemas
 * (`openPlainOutputObjects`) must NOT be dropped with it — see the v2 note
 * there.
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

/**
 * Output-schema override: leaves plain `z.object`s open to unknown fields.
 *
 * With `io: "output"`, Zod emits `additionalProperties: false` for every
 * plain `z.object` (whose runtime parse just strips unknown keys). Handlers
 * pass API responses through unchanged, so a field added in an Umbraco or
 * add-on minor release would make every validating client reject the
 * result. Only objects with no explicit catchall are opened — a deliberate
 * `z.strictObject` (catchall `never`) stays closed. Input schemas are not
 * affected.
 *
 * v2: still needed. v2 converts output schemas through Standard Schema
 * (`~standard.jsonSchema.output`), which emits the same
 * `additionalProperties: false` for a plain `z.object`, and its converter
 * takes no `override`. After migrating, keep this behaviour by wrapping each
 * tool's output schema at registration so its `~standard.jsonSchema.output`
 * applies this function, rather than overriding ListTools.
 *
 * @see https://github.com/umbraco/Umbraco-MCP-Base/issues/343
 */
function openPlainOutputObjects({
  zodSchema,
  jsonSchema,
}: {
  zodSchema: unknown;
  jsonSchema: Record<string, unknown>;
}): void {
  const def = (zodSchema as { _zod?: { def?: { type?: string; catchall?: unknown } } })._zod?.def;
  if (def?.type === "object" && def.catchall === undefined && jsonSchema.additionalProperties === false) {
    delete jsonSchema.additionalProperties;
  }
}

function toJsonSchema(schema: unknown, io: "input" | "output"): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  const zodSchema = isZodSchema(schema) ? (schema as z.ZodTypeAny) : z.object(schema as z.ZodRawShape);
  return z.toJSONSchema(zodSchema, {
    target: "draft-2020-12",
    io,
    ...(io === "output" ? { override: openPlainOutputObjects } : {}),
  }) as Record<string, unknown>;
}

/**
 * Patches an `McpServer` instance so every tool it lists advertises JSON
 * Schema draft 2020-12 instead of draft-7, with output schemas left open
 * to additive response fields (see `openPlainOutputObjects`).
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
