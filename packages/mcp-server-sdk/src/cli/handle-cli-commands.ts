/**
 * CLI Command Handler
 *
 * One-call helper that handles all CLI introspection commands
 * (--list-tools, --describe-tool, --generate-context).
 *
 * Consumers call this once after loading config and collections.
 * If a CLI flag is active, the function prints to stdout, waits for stdout/stderr
 * to flush completely, then calls process.exit (0 on success, 1 on error).
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

import { z, ZodType } from "zod";
import type { ToolCollectionExport } from "../types/tool-collection.js";
import type { GetServerConfigResult, UmbracoServerConfig } from "../config/config.js";
import type { CollectionConfiguration } from "../types/collection-configuration.js";
import { toolToJsonSchema, toolToSummary, formatToolTable } from "./introspection.js";
import { generateContextFile } from "./context-generator.js";
import { shouldIncludeTool } from "../tool-filtering/tool-filter.js";
import { UMBRACO_VERSION_CONTEXT_KEY } from "../umbraco-version/request-context.js";

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
  /**
   * Raw version string of the connected Umbraco site, when there is one.
   * Passed to collection `tools()` (and attached to `--call`'s handler
   * context) so version-gated tools match that site. Omit when no site is
   * connected — collections then list their oldest variants.
   */
  umbracoVersion?: string;
}

/**
 * Wait until everything written to a stream so far has been handed to the OS.
 * Writes to pipes are asynchronous on POSIX, so exiting right after console.log
 * truncates output larger than the pipe buffer (64 KB).
 *
 * Only waits when bytes are still buffered: the callback of the empty write is
 * not guaranteed to fire in every host (it never fires under Jest on Linux), so
 * an unconditional wait can hang when there is nothing to flush.
 */
function drain(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.writableLength === 0) return Promise.resolve();
  return new Promise((resolve) => {
    stream.write("", () => resolve());
  });
}

/** Flush stdout and stderr completely, then exit with the given code. */
async function exitAfterFlush(code: number): Promise<never> {
  await Promise.all([drain(process.stdout), drain(process.stderr)]);
  process.exit(code);
}

/**
 * Get tools from a collection, using the provided user if available.
 * Falls back to undefined and catches errors from collections that
 * require a valid user object.
 */
function getToolsForCli(
  col: ToolCollectionExport<any>,
  user?: unknown,
  umbracoVersion?: string,
): ReturnType<ToolCollectionExport<any>["tools"]> {
  try {
    return col.tools(user, { umbracoVersion });
  } catch {
    return [];
  }
}

export async function handleCliCommands(
  collections: ToolCollectionExport<any>[],
  options: HandleCliCommandsOptions,
): Promise<void> {
  const { cliFlags, serverName, serverVersion, user, filterConfig, serverConfig, umbracoVersion } = options;

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
    await exitAfterFlush(0);
  }

  if (cliFlags?.listTools) {
    const summaries = collections.flatMap((col) =>
      getToolsForCli(col, user, umbracoVersion)
        .filter((tool) => !filterConfig || shouldIncludeTool(tool, { collectionName: col.metadata.name, config: filterConfig }))
        .map((tool) => toolToSummary(tool, col.metadata.name)),
    );
    console.log(formatToolTable(summaries));
    await exitAfterFlush(0);
  }

  if (cliFlags?.describeTool) {
    const toolName = cliFlags.describeTool;
    for (const col of collections) {
      const tool = getToolsForCli(col, user, umbracoVersion).find((t) => t.name === toolName);
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
        await exitAfterFlush(0);
      }
    }
    console.error(
      `Tool '${toolName}' not found. Use --list-tools to see available tools.`,
    );
    await exitAfterFlush(1);
  }

  if (cliFlags?.generateContext) {
    const context = generateContextFile(collections, {
      serverName,
      serverVersion,
      user,
      filterConfig,
      umbracoVersion,
    });
    console.log(context);
    await exitAfterFlush(0);
  }

  if (cliFlags?.callTool) {
    const toolName = cliFlags.callTool;

    // Find the tool across all collections
    for (const col of collections) {
      const tool = getToolsForCli(col, user, umbracoVersion).find((t) => t.name === toolName);
      if (tool) {
        if (filterConfig && !shouldIncludeTool(tool, { collectionName: col.metadata.name, config: filterConfig })) {
          break; // Tool exists but is filtered out
        }

        // Parse arguments
        let args: Record<string, unknown> = {};
        if (cliFlags.callToolArgs && cliFlags.callToolArgsFile) {
          console.error("Cannot use --call-args and --call-args-file together. Choose one.");
          await exitAfterFlush(1);
          return; // unreachable but satisfies TS
        } else if (cliFlags.callToolArgsFile !== undefined) {
          if (cliFlags.callToolArgsFile === "") {
            console.error("--call-args-file was provided but is empty. Pass a file path.");
            await exitAfterFlush(1);
            return; // unreachable but satisfies TS
          }
          let fileContents: string;
          try {
            const { readFileSync } = await import("node:fs");
            const raw = readFileSync(cliFlags.callToolArgsFile, "utf-8");
            fileContents = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
          } catch (error: any) {
            console.error(`Could not read --call-args-file '${cliFlags.callToolArgsFile}': ${error.message}`);
            await exitAfterFlush(1);
            return; // unreachable but satisfies TS
          }
          try {
            args = JSON.parse(fileContents);
          } catch (error: any) {
            console.error(`Invalid JSON in --call-args-file '${cliFlags.callToolArgsFile}': ${error.message}`);
            await exitAfterFlush(1);
            return; // unreachable but satisfies TS
          }
        } else if (cliFlags.callToolArgs) {
          try {
            args = JSON.parse(cliFlags.callToolArgs);
          } catch {
            console.error(`Invalid JSON for --call-args: ${cliFlags.callToolArgs}`);
            await exitAfterFlush(1);
            return; // unreachable but satisfies TS
          }
        }

        // Validate against the input schema as the MCP path does, so defaults and
        // transforms apply and bad args fail here rather than reaching the API
        if (tool.inputSchema) {
          const schema = tool.inputSchema instanceof ZodType ? tool.inputSchema : z.object(tool.inputSchema);
          const parsed = await schema.safeParseAsync(args);
          if (!parsed.success) {
            console.error(`Input validation error: Invalid arguments for tool ${toolName}: ${parsed.error.message}`);
            await exitAfterFlush(1);
            return; // unreachable but satisfies TS
          }
          args = parsed.data as Record<string, unknown>;
        }

        // Call the tool handler and print result
        const extra = {
          signal: new AbortController().signal,
          ...(umbracoVersion ? { [UMBRACO_VERSION_CONTEXT_KEY]: umbracoVersion } : {}),
        } as any;
        let result: any;
        try {
          result = await Promise.resolve(tool.handler(args as any, extra));
        } catch (error: any) {
          console.error(`Tool '${toolName}' failed: ${error.message}`);
          await exitAfterFlush(1);
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

        await exitAfterFlush(result.isError ? 1 : 0);
        return;
      }
    }

    console.error(
      `Tool '${toolName}' not found. Use --list-tools to see available tools.`,
    );
    await exitAfterFlush(1);
  }
}
