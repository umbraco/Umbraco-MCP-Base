/**
 * Register Chained Tools Helper
 *
 * Encapsulates the full in-process chaining flow: fetch user, build filter
 * config from admin env + consent choices, create McpClientManager, discover
 * proxied tools, and register them on the MCP server.
 *
 * Replaces ~60 lines of boilerplate that was duplicated in every worker.ts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createMcpClientManager,
  discoverProxiedTools,
  createProxyHandler,
  expandModesToCollections,
  useDraft202012ToolSchemas,
} from "@umbraco-cms/mcp-server-sdk";

import type { HostedMcpEnv } from "../types/env.js";
import type { AuthProps } from "../types/auth.js";
import type { ChainedServerConsentConfig } from "./worker-entry.js";
import { createFetchClientFromKV } from "../http/umbraco-fetch-client.js";
import { loadWorkerConfig } from "../config/worker-config.js";

/**
 * Options for registering chained tools from another MCP server.
 */
export interface RegisterChainedToolsOptions {
  /** The MCP server to register proxied tools on */
  server: McpServer;
  /** Cloudflare Worker environment bindings */
  env: HostedMcpEnv;
  /** Auth props from the OAuthProvider (per-request, user-specific) */
  props: AuthProps;
  /** Chained server config (from consent screen integration) with optional client factory */
  chainedServer: ChainedServerConsentConfig & {
    /** Factory for the chained server's API client (e.g., `() => CmsClient.getClient()`) */
    clientFactory?: () => unknown;
  };
  /**
   * Whether to fetch the current user for per-user tool filtering.
   * Set to false for test workers that don't have real Umbraco tokens.
   * @default true
   */
  fetchUser?: boolean;
}

/**
 * Registers proxied tools from a chained MCP server onto the main server.
 *
 * This helper encapsulates the full chaining flow:
 * 1. Optionally fetch the current user via `createFetchClientFromKV`
 * 2. Build filter config from admin env vars + user consent choices
 * 3. Expand consent mode selections to collections
 * 4. Handle `["__none__"]` sentinel when no chained modes selected
 * 5. Create `McpClientManager` and register in-process server
 * 6. Discover and register each proxied tool with `z.object({}).passthrough()`
 *
 * Wrapped in try/catch — logs errors but doesn't crash the main server.
 *
 * @returns Number of proxied tools registered (0 on error or no tools)
 */
export async function registerChainedTools(
  options: RegisterChainedToolsOptions,
): Promise<number> {
  const { server, env, props, chainedServer, fetchUser = true } = options;

  try {
    // Fetch the real authenticated user for chained tool filtering
    let currentUser: Record<string, unknown> = {};
    if (fetchUser) {
      const fetchClient = await createFetchClientFromKV(env, props.umbracoTokenKey);
      if (fetchClient) {
        try {
          currentUser = ((await fetchClient({
            url: "/umbraco/management/api/v1/user/current",
            method: "GET",
          })) ?? {}) as Record<string, unknown>;
        } catch {
          // If user fetch fails, tools will be unfiltered
        }
      }
    }

    // Build filter config from admin env vars + user consent choices
    const workerConfig = loadWorkerConfig(env);
    const consent = props.consentChoices;
    const chainedFilterConfig: Record<string, unknown> = {
      slices: workerConfig.includeSlices,
      excludeSlices: workerConfig.excludeSlices,
      modes: workerConfig.toolModes,
      readOnly: workerConfig.readonly,
    };

    // Apply user consent mode/collection selections for this chained server
    const serverName = chainedServer.name;
    if (consent?.chainedModeSelections?.[serverName]) {
      const selectedModes = consent.chainedModeSelections[serverName];
      const modeCollections = expandModesToCollections(
        selectedModes,
        chainedServer.modeRegistry,
      );

      const selectedCollections = consent.chainedCollectionSelections?.[serverName];
      if (selectedCollections) {
        const effective = modeCollections.filter((c) =>
          selectedCollections.includes(c),
        );
        chainedFilterConfig.toolCollections =
          effective.length > 0 ? effective : ["__none__"];
      } else {
        chainedFilterConfig.toolCollections = modeCollections;
      }
    } else if (consent) {
      // No chained modes selected for this server — disable all chained tools
      chainedFilterConfig.toolCollections = ["__none__"];
    }
    if (consent?.readOnly) {
      chainedFilterConfig.readOnly = true;
    }
    if (consent?.selectedSlices?.length) {
      chainedFilterConfig.slices = consent.selectedSlices;
    }

    const manager = createMcpClientManager({
      filterConfig: Object.keys(chainedFilterConfig).some(
        (k) => (chainedFilterConfig as any)[k] !== undefined,
      )
        ? (chainedFilterConfig as any)
        : undefined,
    });

    manager.registerServer({
      transport: "in-process",
      name: serverName,
      collections: chainedServer.collections,
      modeRegistry: chainedServer.modeRegistry,
      allModeNames: chainedServer.allModeNames,
      allSliceNames: chainedServer.allSliceNames,
      proxyTools: true,
      user: currentUser,
      clientFactory: chainedServer.clientFactory,
    });

    // Discover and register proxied tools
    const proxiedTools = await discoverProxiedTools(manager);

    for (const pt of proxiedTools) {
      const handler = createProxyHandler(
        manager,
        pt.serverName,
        pt.originalTool.name,
      );
      server.registerTool(
        pt.prefixedName,
        {
          description: `[Proxied from ${pt.serverName}] ${pt.originalTool.description || "No description"}`,
          inputSchema: z.object({}).passthrough(),
          // Note: outputSchema from chained tools is raw JSON Schema (not Zod),
          // which registerTool doesn't accept. Structured content passthrough
          // requires the MCP SDK to support raw JSON Schema for outputSchema,
          // or tools to define Zod outputSchema directly.
        },
        handler as any,
      );
    }

    // Belt-and-suspenders alongside the call in createPerRequestServer:
    // covers the case where main-collection filtering left zero tools
    // registered (so that call was a no-op — the "tools" capability
    // didn't exist yet), but chained tools registered here bring the
    // total above zero. Safe to call more than once on the same server.
    useDraft202012ToolSchemas(server);

    return proxiedTools.length;
  } catch (error) {
    console.error(
      `Warning: Failed to discover proxied ${chainedServer.name} tools:`,
      error,
    );
    return 0;
  }
}
