import * as fs from "node:fs";
import * as path from "node:path";

export function removeChaining(projectDir: string): number {
  let changes = 0;

  // Remove chaining-related files
  const filesToRemove = [
    path.join(projectDir, "src", "config", "mcp-servers.ts"),
    path.join(projectDir, "src", "umbraco-api", "mcp-client.ts"),
    path.join(projectDir, "src", "testing", "mock-mcp-server.ts"),
  ];

  for (const filePath of filesToRemove) {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
      changes++;
    }
  }

  // Remove chained tools directory
  const chainedToolsDir = path.join(
    projectDir,
    "src",
    "umbraco-api",
    "tools",
    "chained"
  );
  if (fs.existsSync(chainedToolsDir)) {
    fs.rmSync(chainedToolsDir, { recursive: true, force: true });
    changes++;
  }

  // Clean up empty testing directory
  const testingDir = path.join(projectDir, "src", "testing");
  if (fs.existsSync(testingDir)) {
    const files = fs.readdirSync(testingDir);
    if (files.length === 0) {
      fs.rmdirSync(testingDir);
      changes++;
    }
  }

  // Update src/index.ts - remove chaining imports and code
  const indexTsPath = path.join(projectDir, "src", "index.ts");
  if (fs.existsSync(indexTsPath)) {
    let content = fs.readFileSync(indexTsPath, "utf-8");
    const original = content;

    // Remove chained collection import
    content = content.replace(
      /^import chainedCollection from ["']\.\/umbraco-api\/tools\/chained\/index\.js["'];?\s*\n/m,
      ""
    );

    // Remove mcpClientManager import
    content = content.replace(
      /^import \{ mcpClientManager \} from ["']\.\/umbraco-api\/mcp-client\.js["'];?\s*\n/m,
      ""
    );

    // Remove mcpServers import
    content = content.replace(
      /^import \{ mcpServers \} from ["']\.\/config\/mcp-servers\.js["'];?\s*\n/m,
      ""
    );

    // Remove SDK imports related to chaining
    content = content.replace(/,?\s*discoverProxiedTools/g, "");
    content = content.replace(/,?\s*parseProxiedToolName/g, "");

    // Remove chainedCollection from collections array
    content = content.replace(/,?\s*chainedCollection/g, "");

    // Remove chaining-related comment lines
    content = content.replace(
      /\/\/\s*Import MCP client manager[^\n]*\n(?=\/\/|import \{|\n)/g,
      ""
    );
    content = content.replace(
      /\/\/\s*Import MCP server chain configuration[^\n]*\n(?=\/\/|import \{|\n)/g,
      ""
    );

    // Remove CallToolResult type import if present
    content = content.replace(
      /^import type \{ CallToolResult \} from ["']@modelcontextprotocol\/sdk\/types\.js["'];?\s*\n/m,
      ""
    );

    // Remove proxied tools discovery block
    const proxyBlockRegex =
      /\/\/\s*Discover and register proxied tools[\s\S]*?(?=const transport|\/\/\s*Start|async function main)/;
    content = content.replace(proxyBlockRegex, "");

    // Remove chainingEnabled variable
    content = content.replace(
      /^\s*const chainingEnabled\s*=[\s\S]*?;\s*\n/m,
      ""
    );

    // Remove if (chainingEnabled) block
    content = content.replace(
      /\s*if\s*\(chainingEnabled\)\s*\{[\s\S]*?\}\s*(?=\n\s*const transport)/,
      ""
    );

    // Remove cleanup handlers for mcpClientManager
    content = content.replace(
      /^\s*await mcpClientManager\.disconnectAll\(\);?\s*\n/gm,
      ""
    );

    // Simplify process.on handlers
    content = content.replace(
      /process\.on\(["']SIGINT["'],\s*async\s*\(\)\s*=>\s*\{\s*process\.exit\(0\);\s*\}\);/g,
      'process.on("SIGINT", () => process.exit(0));'
    );
    content = content.replace(
      /process\.on\(["']SIGTERM["'],\s*async\s*\(\)\s*=>\s*\{\s*process\.exit\(0\);\s*\}\);/g,
      'process.on("SIGTERM", () => process.exit(0));'
    );

    // Clean up potential double commas or empty imports
    content = content.replace(/,\s*,/g, ",");
    content = content.replace(/\{\s*,/g, "{");
    content = content.replace(/,\s*\}/g, "}");
    content = content.replace(/\[\s*,/g, "[");
    content = content.replace(/,\s*\]/g, "]");

    if (content !== original) {
      fs.writeFileSync(indexTsPath, content);
      changes++;
    }
  }

  // Update src/config/index.ts - remove mcp-servers export
  const configIndexPath = path.join(projectDir, "src", "config", "index.ts");
  if (fs.existsSync(configIndexPath)) {
    let content = fs.readFileSync(configIndexPath, "utf-8");
    const original = content;

    content = content.replace(
      /^export \* from ["']\.\/mcp-servers\.js["'];?\s*\n/m,
      ""
    );
    content = content.replace(
      /^export \{ mcpServers \} from ["']\.\/mcp-servers\.js["'];?\s*\n/m,
      ""
    );

    if (content !== original) {
      fs.writeFileSync(configIndexPath, content);
      changes++;
    }
  }

  return changes;
}
