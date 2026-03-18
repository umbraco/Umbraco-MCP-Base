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
import type { GetServerConfigResult } from "../config/config.js";
import { toolToJsonSchema, toolToSummary, formatToolTable } from "./introspection.js";
import { generateContextFile } from "./context-generator.js";

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
}

/**
 * Handle CLI introspection commands (--list-tools, --describe-tool, --generate-context).
 *
 * If a CLI flag is active, prints output to stdout and calls `process.exit(0)`.
 * If no CLI flags are active, returns normally so the server can continue starting.
 *
 * @param collections - All tool collections registered in the server
 * @param options - CLI flags and optional server metadata
 */
export function handleCliCommands(
  collections: ToolCollectionExport<any>[],
  options: HandleCliCommandsOptions,
): void {
  const { cliFlags, serverName, serverVersion } = options;

  if (cliFlags?.listTools) {
    const summaries = collections.flatMap((col) =>
      col.tools({}).map((tool) => toolToSummary(tool, col.metadata.name)),
    );
    console.log(formatToolTable(summaries));
    process.exit(0);
  }

  if (cliFlags?.describeTool) {
    const toolName = cliFlags.describeTool;
    for (const col of collections) {
      const tool = col.tools({}).find((t) => t.name === toolName);
      if (tool) {
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
    });
    console.log(context);
    process.exit(0);
  }
}
