/**
 * /info endpoint tests for chained MCP server.
 *
 * Verifies the /info endpoint includes both main server collections
 * and chained server info (name, displayName, collections, modes).
 */

import { startWorker, stopWorker, workerFetch } from "./helpers/worker.js";

describe("/info endpoint with chained servers", () => {
  beforeAll(async () => {
    await startWorker();
  }, 120_000);

  afterAll(async () => {
    await stopWorker();
  });

  it("returns 200 with JSON content", async () => {
    const response = await workerFetch("/info");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("includes server name for the chained worker", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    expect(info.name).toBe("my-umbraco-mcp-chained");
  });

  it("lists main server collections", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    expect(info.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "example",
          displayName: "Example Tools",
        }),
      ]),
    );
  });

  it("includes chainedServers array", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    expect(info.chainedServers).toBeDefined();
    expect(info.chainedServers).toHaveLength(1);
  });

  it("includes demo chained server with correct metadata", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    const demo = info.chainedServers[0];
    expect(demo.name).toBe("demo");
    expect(demo.displayName).toBe("Demo Add-On");
  });

  it("includes chained server collections with tool counts", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    const demo = info.chainedServers[0];
    expect(demo.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "notification",
          displayName: "Notifications",
          toolCount: 3,
        }),
        expect.objectContaining({
          name: "analytics",
          displayName: "Analytics",
          toolCount: 2,
        }),
      ]),
    );
  });

  it("includes chained server modes", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    const demo = info.chainedServers[0];
    expect(demo.modes).toEqual(expect.arrayContaining(["alerts", "reporting"]));
  });

  it("main server modes are unchanged", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    expect(info.modes).toEqual(
      expect.arrayContaining(["example", "example-2", "umbraco-server"]),
    );
    // Main modes should NOT contain prefixed chained modes
    expect(info.modes).not.toContain("demo:alerts");
  });
});
