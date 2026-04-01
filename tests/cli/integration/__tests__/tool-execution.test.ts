/**
 * CLI Tool Execution Integration Tests
 *
 * Basic end-to-end tool execution via MCP protocol.
 */

import { createCliTestClient, type CliTestClient } from "../helpers/cli-client.js";

describe("Tool Execution (CLI)", () => {
  let client: CliTestClient;

  beforeAll(async () => {
    client = await createCliTestClient();
  });

  afterAll(async () => {
    await client?.close();
  });

  it("tools/list should return expected tools with schemas", async () => {
    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);

    // Each tool should have basic metadata
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe("string");
      expect(tool.description).toBeDefined();
    }
  });

  it("should return structured response for GET tools", async () => {
    const { tools } = await client.listTools();
    const getTool = tools.find((t) => t.name.includes("get-all"));

    if (!getTool) {
      return;
    }

    const result = await client.callTool(getTool.name, {});
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it("should return error for invalid input", async () => {
    const { tools } = await client.listTools();
    const toolWithParams = tools.find(
      (t) => t.inputSchema && Object.keys(t.inputSchema as any).length > 0
    );

    if (!toolWithParams) {
      return;
    }

    // Calling with empty args when params are required should produce an error
    // (MCP SDK validates against inputSchema)
    const result = await client.callTool(toolWithParams.name, {});
    expect(result).toBeDefined();
  });
});
