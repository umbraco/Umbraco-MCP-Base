/**
 * CLI Introspection Integration Tests
 *
 * Tests CLI introspection commands (--list-tools, --describe-tool, --generate-context).
 * These commands run the binary directly (not via MCP protocol) and check stdout.
 */

import { execFileSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entryPoint = resolve(__dirname, "../../../../template/dist/index.js");

const baseEnv = {
  ...process.env,
  USE_MOCK_API: "true",
  UMBRACO_CLIENT_ID: "test-client",
  UMBRACO_CLIENT_SECRET: "test-secret",
  UMBRACO_BASE_URL: "http://localhost:9999",
};

function runCli(args: string[], envOverrides: Record<string, string> = {}): string {
  return execFileSync("node", [entryPoint, ...args], {
    env: { ...baseEnv, ...envOverrides },
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
    const output = runCli(["--describe-tool", "get-example"]);

    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("get-example");
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

describe("CLI Introspection with Filtering", () => {
  it("--list-tools with UMBRACO_READONLY=true should only show read-only tools", () => {
    const output = runCli(["--list-tools"], { UMBRACO_READONLY: "true" });

    // Read-only tools should be present
    expect(output).toContain("get-example");
    expect(output).toContain("list-examples");

    // Mutation tools should be filtered out
    expect(output).not.toContain("delete-example");
    expect(output).not.toContain("create-example");
    expect(output).not.toContain("update-example");
    expect(output).not.toContain("create-widget");
  });

  it("--list-tools with UMBRACO_INCLUDE_TOOL_COLLECTIONS should filter by collection", () => {
    const output = runCli(["--list-tools"], { UMBRACO_INCLUDE_TOOL_COLLECTIONS: "example-2" });

    // example-2 tools should be present
    expect(output).toContain("get-widget");
    expect(output).toContain("list-widgets");

    // example collection tools should be filtered out
    expect(output).not.toContain("get-example");
    expect(output).not.toContain("delete-example");
  });

  it("--list-tools with UMBRACO_EXCLUDE_SLICES should exclude matching tools", () => {
    const output = runCli(["--list-tools"], { UMBRACO_EXCLUDE_SLICES: "delete" });

    expect(output).toContain("get-example");
    expect(output).toContain("create-example");
    expect(output).not.toContain("delete-example");
  });

  it("--describe-tool should return not found for filtered-out tool", () => {
    expect(() => {
      runCli(["--describe-tool", "delete-example"], { UMBRACO_READONLY: "true" });
    }).toThrow();
  });

  it("--describe-tool should work for included tool with filter active", () => {
    const output = runCli(["--describe-tool", "get-example"], { UMBRACO_READONLY: "true" });

    const parsed = JSON.parse(output);
    expect(parsed.name).toBe("get-example");
  });

  it("--generate-context with UMBRACO_READONLY=true should only include read-only tools", () => {
    const output = runCli(["--generate-context"], { UMBRACO_READONLY: "true" });

    expect(output).toContain("get-example");
    expect(output).not.toContain("delete-example");
    expect(output).not.toContain("create-example");
  });
});

describe("CLI Debug Config", () => {
  it("--debug-config should output resolved config as JSON", () => {
    const output = runCli(["--debug-config"]);

    const parsed = JSON.parse(output);
    expect(parsed.auth).toBeDefined();
    expect(parsed.filtering).toBeDefined();
    expect(parsed.resolvedFilterConfig).toBeDefined();
    expect(parsed.filtering.readonly.source).toBe("none");
  });

  it("--debug-config should reflect env vars", () => {
    const output = runCli(["--debug-config"], {
      UMBRACO_READONLY: "true",
      UMBRACO_INCLUDE_SLICES: "read,list",
    });

    const parsed = JSON.parse(output);
    expect(parsed.filtering.readonly.value).toBe(true);
    expect(parsed.filtering.readonly.source).toBe("env");
    expect(parsed.filtering.includeSlices.value).toEqual(["read", "list"]);
    expect(parsed.filtering.includeSlices.source).toBe("env");
    expect(parsed.resolvedFilterConfig.readOnly).toBe(true);
    expect(parsed.resolvedFilterConfig.enabledSlices).toEqual(["read", "list"]);
  });

  it("--debug-config should mask credentials", () => {
    const output = runCli(["--debug-config"]);

    const parsed = JSON.parse(output);
    expect(parsed.auth.clientId.value).not.toBe("test-client");
    expect(parsed.auth.clientSecret.value).not.toBe("test-secret");
  });
});
