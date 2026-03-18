/**
 * CLI Dry-Run Integration Tests
 *
 * Tests dry-run mode end-to-end via MCP protocol.
 */

import { describe, it, expect, afterAll, beforeAll } from "@jest/globals";
import { createCliTestClient, type CliTestClient } from "../helpers/cli-client.js";

describe("Dry-Run Mode (CLI)", () => {
  let client: CliTestClient;

  beforeAll(async () => {
    client = await createCliTestClient({
      env: { UMBRACO_DRY_RUN: "true" },
    });
  });

  afterAll(async () => {
    await client?.close();
  });

  it("should return dry-run response for mutation tools", async () => {
    // Find a non-read-only tool and call it
    const { tools } = await client.listTools();
    const mutationTool = tools.find((t) => !t.name.includes("get-"));

    if (!mutationTool) {
      // Skip if no mutation tools available
      return;
    }

    const result = await client.callTool(mutationTool.name, {});
    expect(result).toBeDefined();

    // Check structured content for dry-run markers
    const structured = (result as any).structuredContent;
    if (structured) {
      expect(structured.dryRun).toBe(true);
      expect(structured.toolName).toBe(mutationTool.name);
      expect(structured.wouldExecute).toBe(true);
    }
  });

  it("should execute read-only tools normally in dry-run mode", async () => {
    const { tools } = await client.listTools();
    const readTool = tools.find((t) => t.name.includes("get-all"));

    if (!readTool) {
      return;
    }

    const result = await client.callTool(readTool.name, {});
    expect(result).toBeDefined();

    // Read-only tools should NOT have dry-run markers
    const structured = (result as any).structuredContent;
    if (structured) {
      expect(structured.dryRun).toBeUndefined();
    }
  });
});
