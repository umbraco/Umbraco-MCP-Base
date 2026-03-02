/**
 * MCP protocol integration tests.
 *
 * Verifies the Worker's /mcp endpoint enforces authentication
 * and responds correctly to unauthenticated requests.
 */

import { startWorker, stopWorker, workerFetch } from "./helpers/worker.js";

describe("MCP protocol", () => {
  beforeAll(async () => {
    await startWorker();
  }, 120_000);

  afterAll(async () => {
    await stopWorker();
  });

  it("returns 401 for unauthenticated POST to /mcp", async () => {
    const response = await workerFetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0" },
        },
      }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 401 for GET to /mcp without auth", async () => {
    const response = await workerFetch("/mcp", {
      method: "GET",
      headers: { Accept: "text/event-stream" },
    });
    expect(response.status).toBe(401);
  });
});
