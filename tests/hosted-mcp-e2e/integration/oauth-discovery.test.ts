/**
 * OAuth discovery integration tests.
 *
 * Verifies the Worker exposes the standard OAuth metadata
 * endpoint at /.well-known/oauth-authorization-server.
 */

import { startWorker, stopWorker, workerFetch } from "./helpers/worker.js";

describe("OAuth discovery", () => {
  beforeAll(async () => {
    await startWorker();
  }, 120_000);

  afterAll(async () => {
    await stopWorker();
  });

  it("returns JSON at .well-known/oauth-authorization-server", async () => {
    const response = await workerFetch("/.well-known/oauth-authorization-server");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("includes authorization_endpoint", async () => {
    const response = await workerFetch("/.well-known/oauth-authorization-server");
    const metadata = await response.json();
    expect(metadata).toHaveProperty("authorization_endpoint");
    expect(metadata.authorization_endpoint).toContain("/authorize");
  });

  it("includes token_endpoint", async () => {
    const response = await workerFetch("/.well-known/oauth-authorization-server");
    const metadata = await response.json();
    expect(metadata).toHaveProperty("token_endpoint");
    expect(metadata.token_endpoint).toContain("/token");
  });

  it("includes registration_endpoint", async () => {
    const response = await workerFetch("/.well-known/oauth-authorization-server");
    const metadata = await response.json();
    expect(metadata).toHaveProperty("registration_endpoint");
    expect(metadata.registration_endpoint).toContain("/register");
  });
});
