/**
 * In-Process MCP Connection
 *
 * Calls tool handlers directly without spawning a child process.
 * Suitable for environments where node:child_process is unavailable
 * (e.g., Cloudflare Workers).
 *
 * Filters collections using the same tool-filtering infrastructure
 * as the main server, then invokes handlers with a minimal stub context.
 */

import { z, type ZodRawShape } from "zod";
import type { ToolDefinition } from "../types/tool-definition.js";
import type { CollectionConfiguration } from "../types/collection-configuration.js";
import { DEFAULT_COLLECTION_CONFIG } from "../types/collection-configuration.js";
import { shouldIncludeTool } from "../tool-filtering/tool-filter.js";
import { createCollectionConfigLoader } from "../tool-filtering/collection-config-loader.js";
import type { McpConnection, McpInProcessServerConfig, FilterConfig } from "./types.js";

interface ResolvedTool {
  tool: ToolDefinition<any, any, any>;
  collectionName: string;
}

export class InProcessConnection implements McpConnection {
  private resolvedTools: ResolvedTool[] | undefined;
  private config: McpInProcessServerConfig;
  private filterConfig: FilterConfig | undefined;

  constructor(config: McpInProcessServerConfig, filterConfig?: FilterConfig) {
    this.config = config;
    this.filterConfig = filterConfig;
  }

  async listTools(): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  }> {
    const tools = this.getFilteredTools();

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
  ): Promise<{
    content: Array<{ type: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  }> {
    const tools = this.getFilteredTools();
    const match = tools.find(({ tool }) => tool.name === name);

    if (!match) {
      throw new Error(
        `Tool not found: ${name}. Available tools: ${tools.map(({ tool }) => tool.name).join(", ")}`,
      );
    }

    const extra = {
      signal: new AbortController().signal,
      requestId: "in-process",
      sendNotification: async () => {},
      sendRequest: async () => ({}) as any,
    };

    const result = await match.tool.handler(args, extra as any);
    return result as {
      content: Array<{ type: string; text?: string }>;
      structuredContent?: unknown;
      isError?: boolean;
    };
  }

  async close(): Promise<void> {
    // No-op — no child process to terminate
  }

  private getFilteredTools(): ResolvedTool[] {
    if (this.resolvedTools) {
      return this.resolvedTools;
    }

    const collectionConfig = this.buildCollectionConfig();
    const allTools: ResolvedTool[] = [];

    for (const collection of this.config.collections) {
      const tools = collection.tools(this.config.user);
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

    this.resolvedTools = allTools;
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
        toolModes: this.filterConfig?.modes,
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
