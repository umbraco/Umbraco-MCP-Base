#!/usr/bin/env npx tsx
/**
 * Discover MCP Server Tools
 *
 * Runs the CLI introspection commands (--list-tools, --describe-tool, --generate-context)
 * against any Umbraco MCP server built with @umbraco-cms/mcp-server-sdk.
 *
 * Detects the server entry point from the consumer project's package.json (`main` field)
 * and executes the appropriate CLI flag.
 *
 * Environment variables:
 *   PROJECT_ROOT  - Path to the consumer project root (default: cwd)
 *   COMMAND       - One of: list-tools, describe-tool, generate-context (default: list-tools)
 *   TOOL_NAME     - Tool name for --describe-tool command
 *   SERVER_ENTRY  - Override entry point (default: read from package.json `main`)
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

interface PackageJson {
  main?: string;
  bin?: Record<string, string> | string;
  name?: string;
}

function findServerEntry(projectRoot: string): string {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    console.error(`No package.json found at ${projectRoot}`);
    process.exit(1);
  }

  const pkg: PackageJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  // Prefer `main`, fall back to first `bin` entry
  if (pkg.main) {
    return path.resolve(projectRoot, pkg.main);
  }

  if (pkg.bin) {
    const binPath =
      typeof pkg.bin === "string"
        ? pkg.bin
        : Object.values(pkg.bin)[0];
    if (binPath) {
      return path.resolve(projectRoot, binPath);
    }
  }

  console.error(
    "Could not determine server entry point. Set `main` or `bin` in package.json, or pass SERVER_ENTRY env var.",
  );
  process.exit(1);
}

function main() {
  const projectRoot = path.resolve(process.env.PROJECT_ROOT || ".");
  const command = process.env.COMMAND || "list-tools";
  const toolName = process.env.TOOL_NAME;
  const serverEntry =
    process.env.SERVER_ENTRY || findServerEntry(projectRoot);

  if (!fs.existsSync(serverEntry)) {
    console.error(
      `Server entry point not found: ${serverEntry}\nHave you built the project? (npm run build)`,
    );
    process.exit(1);
  }

  // Build the CLI command - all SDK-based servers accept these flags via yargs
  let cliArgs: string;
  switch (command) {
    case "list-tools":
      cliArgs = "--list-tools";
      break;
    case "describe-tool":
      if (!toolName) {
        console.error(
          "TOOL_NAME is required for describe-tool command.\nUsage: COMMAND=describe-tool TOOL_NAME=my-tool npx tsx discover-tools.ts",
        );
        process.exit(1);
      }
      cliArgs = `--describe-tool ${toolName}`;
      break;
    case "generate-context":
      cliArgs = "--generate-context";
      break;
    default:
      console.error(
        `Unknown command: ${command}\nValid commands: list-tools, describe-tool, generate-context`,
      );
      process.exit(1);
  }

  // Dummy auth values - CLI introspection runs before auth validation in the
  // server lifecycle, but yargs still needs them present to pass required checks.
  // These are never sent to any server.
  const dummyAuth = [
    "--umbraco-client-id dummy",
    "--umbraco-client-secret dummy",
    "--umbraco-base-url http://localhost",
  ].join(" ");

  const fullCommand = `node ${serverEntry} ${cliArgs} ${dummyAuth}`;

  try {
    const output = execSync(fullCommand, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30_000,
    });
    console.log(output);
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    // The server calls process.exit(0) after printing — execSync treats this as success
    // but some environments still throw. Check if we got stdout.
    if (execError.stdout) {
      console.log(execError.stdout);
    } else {
      console.error("Failed to run CLI command:");
      if (execError.stderr) {
        console.error(execError.stderr);
      }
      process.exit(1);
    }
  }
}

main();
