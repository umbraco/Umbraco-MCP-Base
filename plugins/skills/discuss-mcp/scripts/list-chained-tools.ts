#!/usr/bin/env npx tsx
/**
 * List Chained MCP Server Tools
 *
 * Imports the consumer project's mcp-servers.ts configuration, connects to
 * each configured chained MCP server, and lists all available tools grouped
 * by server. Used by the discuss-mcp skill to understand what building blocks
 * are available for composite tool design.
 *
 * Environment variables:
 *   PROJECT_ROOT      - Consumer project root (default: ".")
 *   MCP_SERVERS_PATH  - Override config file path (default: "src/config/mcp-servers.ts")
 *   SHOW_SCHEMAS      - Include input schemas in output (default: "false")
 */

import { createMcpClientManager } from '@umbraco-cms/mcp-server-sdk';
import type { McpServerConfig } from '@umbraco-cms/mcp-server-sdk';
import { pathToFileURL } from 'url';
import * as path from 'path';
import * as fs from 'fs';

interface ToolInfo {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

interface ServerToolReport {
  serverName: string;
  commandSummary: string;
  tools: ToolInfo[];
  error?: string;
}

/**
 * Build a human-readable command summary from an McpServerConfig.
 */
function commandSummary(config: McpServerConfig): string {
  const parts = [config.command, ...(config.args || [])];
  return parts.join(' ');
}

/**
 * Format the report output.
 */
function formatReport(reports: ServerToolReport[], showSchemas: boolean): string {
  const lines: string[] = [];

  lines.push('Chained MCP Server Tools');
  lines.push('='.repeat(70));
  lines.push('');

  let totalTools = 0;
  let serverCount = 0;

  for (const report of reports) {
    lines.push(`Server: ${report.serverName} (${report.commandSummary})`);
    lines.push('-'.repeat(70));

    if (report.error) {
      lines.push(`  ERROR: ${report.error}`);
      lines.push('');
      serverCount++;
      continue;
    }

    lines.push(`  Tools: ${report.tools.length}`);
    lines.push('');

    for (const tool of report.tools) {
      const desc = tool.description || '(no description)';
      lines.push(`  ${tool.name.padEnd(30)} ${desc}`);

      if (showSchemas && tool.inputSchema) {
        const schemaStr = JSON.stringify(tool.inputSchema, null, 2);
        const indented = schemaStr.split('\n').map(line => `      ${line}`).join('\n');
        lines.push(indented);
        lines.push('');
      }
    }

    lines.push('');
    totalTools += report.tools.length;
    serverCount++;
  }

  lines.push('='.repeat(70));
  lines.push(`Total: ${totalTools} tools across ${serverCount} server(s)`);

  return lines.join('\n');
}

/**
 * Main function
 */
async function main() {
  const projectRoot = path.resolve(process.env.PROJECT_ROOT || '.');
  const mcpServersPath = process.env.MCP_SERVERS_PATH || 'src/config/mcp-servers.ts';
  const showSchemas = process.env.SHOW_SCHEMAS === 'true';

  // Resolve the config file path
  const configPath = path.resolve(projectRoot, mcpServersPath);

  if (!fs.existsSync(configPath)) {
    console.error(`Config file not found: ${configPath}`);
    console.error('');
    console.error('Check that MCP_SERVERS_PATH is correct or run from the project root.');
    console.error(`  PROJECT_ROOT=${projectRoot}`);
    console.error(`  MCP_SERVERS_PATH=${mcpServersPath}`);
    process.exit(1);
  }

  // Dynamically import the config file
  const configUrl = pathToFileURL(configPath).href;
  let mcpServers: McpServerConfig[];

  try {
    const configModule = await import(configUrl);
    mcpServers = configModule.mcpServers;

    if (!Array.isArray(mcpServers)) {
      console.error(`Expected "mcpServers" export from ${configPath} to be an array.`);
      console.error('The file should export: export const mcpServers: McpServerConfig[] = [...]');
      process.exit(1);
    }
  } catch (error) {
    console.error(`Failed to import config file: ${configPath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (mcpServers.length === 0) {
    console.log(`No chained MCP servers configured in ${configPath}`);
    process.exit(0);
  }

  // Create manager and register servers
  const manager = createMcpClientManager();
  for (const config of mcpServers) {
    manager.registerServer(config);
  }

  // Connect to each server and list tools
  const reports: ServerToolReport[] = [];

  for (const config of mcpServers) {
    const report: ServerToolReport = {
      serverName: config.name,
      commandSummary: commandSummary(config),
      tools: [],
    };

    try {
      // 30s timeout per server connection
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Connection timed out after 30s')), 30000)
      );

      const listPromise = manager.listTools(config.name);
      const { tools } = await Promise.race([listPromise, timeoutPromise]);

      report.tools = tools.map(tool => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema,
      }));
    } catch (error) {
      // Log error per server but continue to next server
      const message = error instanceof Error ? error.message : String(error);
      report.error = message;
      console.error(`Failed to connect to ${config.name}: ${message}`);
    }

    reports.push(report);
  }

  // Format and output report
  const output = formatReport(reports, showSchemas);
  console.log(output);

  // Disconnect all servers
  await manager.disconnectAll();
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
