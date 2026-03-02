/**
 * Landing page integration tests.
 *
 * Verifies the Worker serves a landing page at / with
 * the correct server name and basic structure.
 */

import { startWorker, stopWorker, workerFetch } from "./helpers/worker.js";

describe("Landing page", () => {
  beforeAll(async () => {
    await startWorker();
  }, 120_000);

  afterAll(async () => {
    await stopWorker();
  });

  it("returns 200 with HTML content", async () => {
    const response = await workerFetch("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
  });

  it("contains the server name", async () => {
    const response = await workerFetch("/");
    const body = await response.text();
    expect(body).toContain("my-umbraco-mcp");
  });

  it("contains the MCP endpoint path", async () => {
    const response = await workerFetch("/");
    const body = await response.text();
    expect(body).toContain("/mcp");
  });

  it("sets X-Frame-Options header", async () => {
    const response = await workerFetch("/");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });
});
