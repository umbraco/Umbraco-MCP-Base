/**
 * CLI Command Handler
 *
 * One-call helper that handles all CLI introspection commands
 * (--list-tools, --describe-tool, --generate-context).
 *
 * Consumers call this once after loading config and collections.
 * If a CLI flag is active, the function prints to stdout and calls process.exit(0).
 * If no CLI flags are active, it returns normally so the server can start.
 *
 * @example
 * ```typescript
 * import { handleCliCommands } from "@umbraco-cms/mcp-server-sdk";
 *
 * const serverConfig = loadServerConfig(true);
 * const collections = [exampleCollection, otherCollection];
 *
 * // If a CLI flag is set, this prints output and exits.
 * // Otherwise it returns and the server continues to start.
 * handleCliCommands(collections, {
 *   cliFlags: serverConfig.cliFlags,
 *   serverName: "my-umbraco-mcp",
 *   serverVersion: packageJson.version,
 * });
 * ```
 */

import type { ToolCollectionExport } from "../types/tool-collection.js";
import type { GetServerConfigResult, UmbracoServerConfig } from "../config/config.js";
import type { CollectionConfiguration } from "../types/collection-configuration.js";
import { toolToJsonSchema, toolToSummary, formatToolTable } from "./introspection.js";
import { generateContextFile } from "./context-generator.js";
import { shouldIncludeTool } from "../tool-filtering/tool-filter.js";

/**
 * Options for handleCliCommands.
 */
export interface HandleCliCommandsOptions {
  /** CLI introspection flags from getServerConfig() */
  cliFlags: GetServerConfigResult["cliFlags"];
  /** Server name used in context generation (defaults to "Umbraco MCP Server") */
  serverName?: string;
  /** Server version used in context generation */
  serverVersion?: string;
  /** Optional user object to pass to collection tools() for authorization-aware listing */
  user?: unknown;
  /** Optional filter configuration — when provided, CLI output only includes matching tools */
  filterConfig?: CollectionConfiguration;
  /** Optional server config — used by --debug-config to show resolved values and sources */
  serverConfig?: UmbracoServerConfig;
}

/**
 * Get tools from a collection, using the provided user if available.
 * Falls back to undefined and catches errors from collections that
 * require a valid user object.
 */
function getToolsForCli(col: ToolCollectionExport<any>, user?: unknown): ReturnType<ToolCollectionExport<any>["tools"]> {
  try {
    return col.tools(user);
  } catch {
    return [];
  }
}

export async function handleCliCommands(
  collections: ToolCollectionExport<any>[],
  options: HandleCliCommandsOptions,
): Promise<void> {
  const { cliFlags, serverName, serverVersion, user, filterConfig, serverConfig } = options;

  if (cliFlags?.debugConfig) {
    const debug: Record<string, unknown> = {};

    if (serverConfig) {
      const { auth, configSources, ...rest } = serverConfig;
      debug.envFile = { source: configSources.envFile };
      debug.auth = {
        baseUrl: { value: auth.baseUrl, source: configSources.baseUrl },
        clientId: { value: auth.clientId ? "(set)" : "(not set)", source: configSources.clientId },
        clientSecret: { value: auth.clientSecret ? "(set)" : "(not set)", source: configSources.clientSecret },
      };
      debug.filtering = {
        toolModes: { value: rest.toolModes ?? [], source: configSources.toolModes },
        includeToolCollections: { value: rest.includeToolCollections ?? [], source: configSources.includeToolCollections },
        excludeToolCollections: { value: rest.excludeToolCollections ?? [], source: configSources.excludeToolCollections },
        includeSlices: { value: rest.includeSlices ?? [], source: configSources.includeSlices },
        excludeSlices: { value: rest.excludeSlices ?? [], source: configSources.excludeSlices },
        includeTools: { value: rest.includeTools ?? [], source: configSources.includeTools },
        excludeTools: { value: rest.excludeTools ?? [], source: configSources.excludeTools },
        readonly: { value: rest.readonly ?? false, source: configSources.readonly },
      };
      debug.other = {
        dryRun: { value: rest.dryRun ?? false, source: configSources.dryRun },
        disableOutputCompatibilityMode: { value: rest.disableOutputCompatibilityMode ?? false, source: configSources.disableOutputCompatibilityMode },
        allowedMediaPaths: { value: rest.allowedMediaPaths ?? [], source: configSources.allowedMediaPaths },
      };
    } else {
      debug.error = "serverConfig not passed to handleCliCommands — pass it to see resolved values";
    }

    if (filterConfig) {
      debug.resolvedFilterConfig = filterConfig;
    }

    console.log(JSON.stringify(debug, null, 2));
    process.exit(0);
  }

  if (cliFlags?.listTools) {
    const summaries = collections.flatMap((col) =>
      getToolsForCli(col, user)
        .filter((tool) => !filterConfig || shouldIncludeTool(tool, { collectionName: col.metadata.name, config: filterConfig }))
        .map((tool) => toolToSummary(tool, col.metadata.name)),
    );
    console.log(formatToolTable(summaries));
    process.exit(0);
  }

  if (cliFlags?.describeTool) {
    const toolName = cliFlags.describeTool;
    for (const col of collections) {
      const tool = getToolsForCli(col, user).find((t) => t.name === toolName);
      if (tool) {
        if (filterConfig && !shouldIncludeTool(tool, { collectionName: col.metadata.name, config: filterConfig })) {
          break; // Tool exists but is filtered out — fall through to "not found"
        }
        const schema = toolToJsonSchema(tool);
        console.log(
          JSON.stringify(
            {
              name: tool.name,
              collection: col.metadata.name,
              description: tool.description,
              slices: tool.slices,
              annotations: tool.annotations ?? {},
              inputSchema: schema,
            },
            null,
            2,
          ),
        );
        process.exit(0);
      }
    }
    console.error(
      `Tool '${toolName}' not found. Use --list-tools to see available tools.`,
    );
    process.exit(1);
  }

  if (cliFlags?.generateContext) {
    const context = generateContextFile(collections, {
      serverName,
      serverVersion,
      user,
      filterConfig,
    });
    console.log(context);
    process.exit(0);
  }

  if (cliFlags?.callTool) {
    const toolName = cliFlags.callTool;

    // Find the tool across all collections
    for (const col of collections) {
      const tool = getToolsForCli(col, user).find((t) => t.name === toolName);
      if (tool) {
        if (filterConfig && !shouldIncludeTool(tool, { collectionName: col.metadata.name, config: filterConfig })) {
          break; // Tool exists but is filtered out
        }

        // Parse arguments
        let args: Record<string, unknown> = {};
        if (cliFlags.callToolArgs) {
          try {
            args = JSON.parse(cliFlags.callToolArgs);
          } catch {
            console.error(`Invalid JSON for --call-args: ${cliFlags.callToolArgs}`);
            process.exit(1);
          }
        }

        // Call the tool handler and print result
        const extra = { signal: new AbortController().signal } as any;
        let result: any;
        try {
          result = await Promise.resolve(tool.handler(args as any, extra));
        } catch (error: any) {
          console.error(`Tool '${toolName}' failed: ${error.message}`);
          process.exit(1);
          return; // unreachable but satisfies TS
        }

        if (result.structuredContent) {
          console.log(JSON.stringify(result.structuredContent, null, 2));
        } else if (result.content) {
          for (const item of result.content) {
            if (item.type === "text") {
              try {
                console.log(JSON.stringify(JSON.parse(item.text), null, 2));
              } catch {
                console.log(item.text);
              }
            }
          }
        }

        process.exit(result.isError ? 1 : 0);
        return;
      }
    }

    console.error(
      `Tool '${toolName}' not found. Use --list-tools to see available tools.`,
    );
    process.exit(1);
  }
}
