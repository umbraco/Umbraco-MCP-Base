/**
 * /info diagnostic endpoint integration tests.
 *
 * Verifies the Worker serves diagnostic info at /info
 * when ENABLE_INFO_ENDPOINT=true is set.
 */

import { startWorker, stopWorker, workerFetch } from "./helpers/worker.js";

describe("/info endpoint", () => {
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

  it("includes server name and version", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    expect(info.name).toBe("my-umbraco-mcp");
    expect(info.version).toBe("1.0.0");
  });

  it("includes transport and MCP endpoint", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    expect(info.transport).toBe("streamable-http");
    expect(info.mcpEndpoint).toBe("/mcp");
  });

  it("lists registered collections", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    expect(info.collections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "example",
          displayName: "Example Tools",
          toolCount: expect.any(Number),
        }),
        expect.objectContaining({
          name: "example-2",
          displayName: "Example-2 Tools",
          toolCount: expect.any(Number),
        }),
      ])
    );
  });

  it("lists available modes", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    expect(info.modes).toEqual(
      expect.arrayContaining(["example", "example-2", "umbraco-server"])
    );
  });

  it("lists available slices without 'other'", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    expect(info.slices).toEqual(expect.arrayContaining(["create", "read", "update", "delete", "list"]));
    expect(info.slices).not.toContain("other");
  });

  it("includes config object", async () => {
    const response = await workerFetch("/info");
    const info = await response.json();
    expect(info).toHaveProperty("config");
    expect(typeof info.config).toBe("object");
  });
});
