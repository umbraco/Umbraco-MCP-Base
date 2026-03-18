/**
 * CLI Introspection Integration Tests
 *
 * Tests CLI introspection commands (--list-tools, --describe-tool, --generate-context).
 * These commands run the binary directly (not via MCP protocol) and check stdout.
 */

import { describe, it, expect } from "@jest/globals";
import { execFileSync } from "child_process";
import { resolve } from "path";

const projectRoot = resolve(import.meta.dirname, "../../..");
const entryPoint = resolve(projectRoot, "dist/index.js");

const baseEnv = {
  ...process.env,
  USE_MOCK_API: "true",
  UMBRACO_CLIENT_ID: "test-client",
  UMBRACO_CLIENT_SECRET: "test-secret",
  UMBRACO_BASE_URL: "http://localhost:9999",
};

function runCli(args: string[]): string {
  return execFileSync("node", [entryPoint, ...args], {
    env: baseEnv,
    timeout: 15000,
    encoding: "utf-8",
  });
}

describe("CLI Introspection Commands", () => {
  it("--list-tools should output a table of all tools", () => {
    const output = runCli(["--list-tools"]);

    // Should contain table headers
    expect(output).toContain("Name");
    expect(output).toContain("Collection");
    expect(output).toContain("Slices");

    // Should contain at least one tool
    expect(output).toContain("example");
  });

  it("--describe-tool should output JSON for a specific tool", () => {
    const output = runCli(["--describe-tool", "example-get-all-examples"]);

    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("example-get-all-examples");
    expect(parsed.collection).toBeDefined();
    expect(parsed.description).toBeDefined();
    expect(parsed.inputSchema).toBeDefined();
  });

  it("--describe-tool with unknown tool should exit with error", () => {
    expect(() => {
      runCli(["--describe-tool", "nonexistent-tool"]);
    }).toThrow();
  });

  it("--generate-context should output valid markdown", () => {
    const output = runCli(["--generate-context"]);

    // Should be markdown content
    expect(output).toContain("# ");
    expect(output).toContain("## Collections");
    expect(output).toContain("## Workflows");
    expect(output).toContain("## Invariants");
  });
});
