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
  setCustomTransport,
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
 * Fetches the current user from Umbraco's Management API.
 * Used to provide per-user tool filtering based on allowed sections.
 */
async function fetchCurrentUser(
  fetchClient: Awaited<ReturnType<typeof createFetchClientFromKV>> & {}
): Promise<Record<string, unknown>> {
  try {
    const user = await fetchClient({
      url: "/umbraco/management/api/v1/user/current",
      method: "GET",
    });
    return (user ?? {}) as Record<string, unknown>;
  } catch {
    // If we can't fetch the user, return empty object (tools will be unfiltered)
    return {};
  }
}

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
  /**
   * Optional factory to create the API client used by tool handlers.
   *
   * Tool handlers call `executeGetApiCall((client) => client.someMethod(...))`.
   * The `client` is whatever this factory returns (via `configureApiClient`).
   *
   * If not provided, the Orval-generated client is used automatically via
   * `setCustomTransport()` — the fetch client replaces Axios as the transport
   * so the Orval client's named methods (e.g., `client.getTreeDataTypeRoot()`)
   * work in the Workers runtime.
   *
   * Only provide this if you need a custom client setup beyond the Orval client.
   */
  clientFactory?: () => unknown;
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

  // Set the fetch client as the transport for UmbracoManagementClient.
  // This makes the Orval-generated API client (with named methods like
  // client.getTreeDataTypeRoot()) use fetch instead of Axios, enabling
  // it to work in the Cloudflare Workers runtime.
  setCustomTransport(fetchClient as any);

  // Configure the API client for tool handlers.
  // If a custom clientFactory is provided, use it; otherwise use the
  // Orval-generated client which now routes through our fetch transport.
  if (options.clientFactory) {
    configureApiClient(options.clientFactory);
  }

  // Fetch current user from Umbraco for per-user tool filtering
  const currentUser = await fetchCurrentUser(fetchClient);

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
    const tools = collection.tools(currentUser);

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
