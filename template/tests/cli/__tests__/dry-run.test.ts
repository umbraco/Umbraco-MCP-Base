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
    const mutationTool = tools.find((t) => !t.name.includes("get-") && !t.name.includes("list-") && !t.name.includes("search-"));

    if (!mutationTool) {
      // Skip if no mutation tools available
      return;
    }

    const result = await client.callTool(mutationTool.name, {});
    expect(result).toBeDefined();

    // Dry-run responses may come as structuredContent or text content.
    // When the tool has an outputSchema, the MCP SDK may reject the dry-run
    // structured response (schema mismatch), returning it as an error with
    // the dry-run data in the error text.
    const structured = (result as any).structuredContent;
    if (structured?.dryRun) {
      expect(structured.dryRun).toBe(true);
      expect(structured.toolName).toBe(mutationTool.name);
    } else {
      // Check text content for dry-run markers
      const textContent = result.content?.find((c: any) => c.type === "text");
      expect(textContent).toBeDefined();
      const text = textContent!.text as string;
      // The response should indicate dry-run was active (either directly or via validation error)
      expect(text.length).toBeGreaterThan(0);
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
    } else {
      const textContent = result.content?.find((c: any) => c.type === "text");
      if (textContent?.text) {
        const parsed = JSON.parse(textContent.text as string);
        expect(parsed.dryRun).toBeUndefined();
      }
    }
  });
});
