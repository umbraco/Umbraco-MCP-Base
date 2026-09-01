/**
 * Strict JSON Schema (Draft 2020-12) Tool Schemas
 *
 * `@modelcontextprotocol/sdk`'s `McpServer` always advertises tool
 * input/output schemas as JSON Schema draft-7, even on the latest
 * published SDK version. Its `ListTools` handler calls
 * `toJsonSchemaCompat()` without a `target`, which falls back to
 * `'draft-7'` — even though Zod v4's own `toJSONSchema()` already
 * defaults to `'draft-2020-12'`. There's no `ServerOptions`/`registerTool`
 * option to change it.
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

interface TrackedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: unknown;
  _meta?: Record<string, unknown>;
}

function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { parse?: unknown }).parse === "function"
  );
}

function toJsonSchema(schema: unknown, io: "input" | "output"): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  const zodSchema = isZodSchema(schema) ? schema : z.object(schema as z.ZodRawShape);
  return z.toJSONSchema(zodSchema, { target: "draft-2020-12", io }) as Record<string, unknown>;
}

/**
 * Patches an `McpServer` instance so every tool it lists advertises JSON
 * Schema draft 2020-12 instead of draft-7.
 *
 * Wraps `registerTool` so every registration — from any call site, at any
 * point during server setup — re-derives the `ListTools` response from
 * the same Zod schemas already passed to `registerTool`, with the
 * correct target. Actual tool execution (argument validation, handler
 * invocation) is untouched; only the advertised schema changes.
 *
 * Call once, immediately after constructing the server and before any
 * `registerTool` calls.
 */
export function useDraft202012ToolSchemas(server: McpServer): void {
  const tracked = new Map<string, TrackedTool>();
  const originalRegisterTool = server.registerTool.bind(server);

  (server as { registerTool: unknown }).registerTool = (
    name: string,
    config: Omit<TrackedTool, "name">,
    handler: unknown,
  ) => {
    tracked.set(name, { name, ...config });
    const registered = (originalRegisterTool as (...args: unknown[]) => unknown)(
      name,
      config,
      handler,
    );

    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: Array.from(tracked.values()).map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: toJsonSchema(tool.inputSchema, "input") ?? EMPTY_OBJECT_JSON_SCHEMA,
        ...(tool.outputSchema ? { outputSchema: toJsonSchema(tool.outputSchema, "output") } : {}),
        annotations: tool.annotations,
        _meta: tool._meta,
      })),
    }));

    return registered;
  };
}
