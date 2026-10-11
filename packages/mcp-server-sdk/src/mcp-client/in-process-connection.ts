/**
 * In-Process MCP Connection
 *
 * Calls tool handlers directly without spawning a child process.
 * Suitable for environments where node:child_process is unavailable
 * (e.g., Cloudflare Workers).
 *
 * Filters collections using the same tool-filtering infrastructure
 * as the main server, then invokes handlers with a minimal stub context.
 *
 * The tool list is rebuilt on every call from its arguments — the user, the
 * filter config and the caller's Umbraco version — and never cached, because
 * one connection can serve requests for sites on different versions.
 *
 * Request-scoped values (Umbraco version, telemetry) reach the chained
 * handler's `extra` from the caller's explicit `context` when given, else
 * from the active `runWithRequestContext` store. Only those two namespaced
 * keys are copied — never the caller's abort signal or request id.
 */

import { z, type ZodRawShape } from "zod";
import type { ToolDefinition } from "../types/tool-definition.js";
import type { CollectionConfiguration } from "../types/collection-configuration.js";
import { DEFAULT_COLLECTION_CONFIG } from "../types/collection-configuration.js";
import { shouldIncludeTool } from "../tool-filtering/tool-filter.js";
import { createCollectionConfigLoader } from "../tool-filtering/collection-config-loader.js";
import { configureApiClient, getApiClient } from "../helpers/api-call-helpers.js";
import type { McpConnection, McpInProcessServerConfig, FilterConfig } from "./types.js";
import { getUmbracoVersion } from "../umbraco-version/request-context.js";
import {
  getActiveRequestContext,
  pickCarriedRequestContext,
  runWithRequestContext,
  type CarriedRequestContext,
} from "../request-context/async-request-context.js";

interface ResolvedTool {
  tool: ToolDefinition<any, any, any>;
  collectionName: string;
}

export class InProcessConnection implements McpConnection {
  private config: McpInProcessServerConfig;
  private filterConfig: FilterConfig | undefined;

  constructor(config: McpInProcessServerConfig, filterConfig?: FilterConfig) {
    this.config = config;
    this.filterConfig = filterConfig;
  }

  async listTools(context?: unknown): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  }> {
    const carried = resolveCarriedRequestContext(context);
    const tools = this.getFilteredTools(getUmbracoVersion(carried));

    return {
      tools: tools.map(({ tool }) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
          ? (z.toJSONSchema(z.object(tool.inputSchema as ZodRawShape)) as Record<string, unknown>)
          : { type: "object", properties: {} },
      })),
    };
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    context?: unknown,
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }> {
    const carried = resolveCarriedRequestContext(context);
    const tools = this.getFilteredTools(getUmbracoVersion(carried));
    const match = tools.find(({ tool }) => tool.name === name);

    if (!match) {
      throw new Error(
        `Tool not found: ${name}. Available tools: ${tools.map(({ tool }) => tool.name).join(", ")}`,
      );
    }

    const extra = {
      ...carried,
      signal: new AbortController().signal,
      requestId: "in-process",
      sendNotification: async () => {},
      sendRequest: async () => ({}) as any,
    };

    // If this server has its own clientFactory, temporarily swap the global
    // API client so the chained tool's handler gets the right Orval client.
    let previousClient: unknown = null;
    let hadPreviousClient = false;
    if (this.config.clientFactory) {
      try {
        previousClient = getApiClient();
        hadPreviousClient = true;
      } catch {
        // No previous client configured — that's fine
      }
      configureApiClient(this.config.clientFactory);
    }

    try {
      // Re-enter the store with the merged values so a chain made from inside
      // this handler sees them, not an outer store that may differ.
      const result = await runWithRequestContext(carried, () =>
        match.tool.handler(args, extra as any),
      );
      return result as {
        content: Array<{ type: string; text?: string }>;
        structuredContent?: unknown;
        isError?: boolean;
      };
    } finally {
      // Restore the previous API client
      if (this.config.clientFactory && hadPreviousClient) {
        configureApiClient(() => previousClient);
      }
    }
  }

  async close(): Promise<void> {
    // No-op — no child process to terminate
  }

  private getFilteredTools(umbracoVersion: string | undefined): ResolvedTool[] {
    const collectionConfig = this.buildCollectionConfig();
    const allTools: ResolvedTool[] = [];

    for (const collection of this.config.collections) {
      const tools = collection.tools(this.config.user, { umbracoVersion });
      for (const tool of tools) {
        if (
          shouldIncludeTool(tool, {
            collectionName: collection.metadata.name,
            config: collectionConfig,
          })
        ) {
          allTools.push({ tool, collectionName: collection.metadata.name });
        }
      }
    }

    return allTools;
  }

  private buildCollectionConfig(): CollectionConfiguration {
    if (!this.filterConfig && !this.config.modeRegistry) {
      return DEFAULT_COLLECTION_CONFIG;
    }

    // If we have a mode registry, use the full config loader
    if (this.config.modeRegistry) {
      const loader = createCollectionConfigLoader({
        modeRegistry: this.config.modeRegistry,
        allModeNames: this.config.allModeNames ?? this.config.modeRegistry.map((m) => m.name),
        allSliceNames: this.config.allSliceNames,
      });

      return loader.loadFromConfig({
        includeTools: this.filterConfig?.tools,
        includeToolCollections: this.filterConfig?.toolCollections,
        includeSlices: this.filterConfig?.slices,
        excludeSlices: this.filterConfig?.excludeSlices,
        toolModes: this.filterConfig?.modes,
        readonly: this.filterConfig?.readOnly,
      });
    }

    // Simple filter without mode expansion
    return {
      ...DEFAULT_COLLECTION_CONFIG,
      enabledTools: this.filterConfig?.tools ?? [],
      enabledCollections: this.filterConfig?.toolCollections ?? [],
      enabledSlices: this.filterConfig?.slices ?? [],
    };
  }
}

/**
 * The carried request values for a chained call: the explicit caller
 * `context` when one is given, otherwise the active async store, otherwise
 * nothing. Always a fresh object holding only the namespaced keys.
 */
function resolveCarriedRequestContext(context: unknown): CarriedRequestContext {
  // Per key: an explicit value wins, the store fills whatever it lacks. A
  // proxy handler always forwards the parent `extra`, which may carry neither
  // key when the host only entered the store.
  return {
    ...pickCarriedRequestContext(getActiveRequestContext()),
    ...pickCarriedRequestContext(context),
  };
}
