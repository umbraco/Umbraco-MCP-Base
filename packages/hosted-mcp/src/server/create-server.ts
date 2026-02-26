/**
 * Per-Request McpServer Factory
 *
 * Creates a fresh McpServer instance per request to prevent response data
 * leakage between clients (required by MCP SDK 1.26.0+).
 *
 * Reuses SDK components for tool filtering, annotations, and decorators.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  shouldIncludeTool,
  createToolAnnotations,
  configureApiClient,
  createCollectionConfigLoader,
  type ToolCollectionExport,
  type ToolModeDefinition,
  type CollectionConfiguration,
} from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../types/env.js";
import { loadWorkerConfig } from "../config/worker-config.js";
import { createFetchClientFromKV } from "../http/umbraco-fetch-client.js";
import type { AuthProps } from "../auth/umbraco-handler.js";

/**
 * Options for creating a per-request McpServer.
 */
export interface CreateServerOptions {
  /** Server name */
  name: string;
  /** Server version */
  version: string;
  /** Tool collections to register */
  collections: ToolCollectionExport[];
  /** Mode registry for tool filtering */
  modeRegistry: ToolModeDefinition[];
  /** All valid mode names */
  allModeNames: readonly string[];
  /** All valid slice names */
  allSliceNames: readonly string[];
}

/**
 * Creates a per-request McpServer with tools registered and API client configured.
 *
 * This factory is called for each incoming MCP request to ensure:
 * - No response data leakage between clients
 * - API client is configured with the correct user's Umbraco token
 * - Tool filtering is applied from Worker env config
 *
 * @param options - Server configuration (constant across requests)
 * @param env - Cloudflare Worker environment bindings
 * @param props - Auth props from the OAuthProvider (per-request, user-specific)
 * @returns Configured McpServer ready to handle the request
 */
export async function createPerRequestServer(
  options: CreateServerOptions,
  env: HostedMcpEnv,
  props: AuthProps
): Promise<McpServer> {
  const server = new McpServer({
    name: options.name,
    version: options.version,
  });

  // Create fetch-based API client with this user's stored Umbraco token
  const fetchClient = await createFetchClientFromKV(env, props.umbracoTokenKey);
  if (!fetchClient) {
    throw new Error("Umbraco token not found or expired. Re-authentication required.");
  }

  // Configure the API client for this request's tool handlers
  configureApiClient(() => fetchClient);

  // Load tool filtering config from Worker env
  const workerConfig = loadWorkerConfig(env);
  const configLoader = createCollectionConfigLoader({
    modeRegistry: options.modeRegistry,
    allModeNames: options.allModeNames,
    allSliceNames: options.allSliceNames,
  });
  const filterConfig: CollectionConfiguration =
    configLoader.loadFromConfig(workerConfig);

  // Register tools from all collections (with filtering)
  for (const collection of options.collections) {
    const collectionName = collection.metadata.name;
    const tools = collection.tools({});

    for (const tool of tools) {
      if (!shouldIncludeTool(tool, { collectionName, config: filterConfig })) {
        continue;
      }

      const annotations = createToolAnnotations(tool);

      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
          annotations,
        },
        tool.handler
      );
    }
  }

  return server;
}
