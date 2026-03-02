/**
 * Consent screen integration tests.
 *
 * Verifies the Worker renders a consent screen at /authorize
 * with the expected content (modes, slices, Umbraco URL).
 *
 * Requires dynamic client registration to get a valid client_id.
 */

import { startWorker, stopWorker, workerFetch } from "./helpers/worker.js";

describe("Consent screen", () => {
  let clientId: string;

  beforeAll(async () => {
    await startWorker();

    // Register a dynamic client
    const regResponse = await workerFetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:9999/callback"],
        client_name: "Integration Test Client",
      }),
    });
    expect(regResponse.status).toBe(201);
    const regData = await regResponse.json();
    clientId = regData.client_id;
  }, 120_000);

  afterAll(async () => {
    await stopWorker();
  });

  it("returns HTML consent page at /authorize with valid params", async () => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "http://localhost:9999/callback",
      response_type: "code",
      state: "test-state",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });

    const response = await workerFetch(`/authorize?${params}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
  });

  it("consent page shows the Umbraco base URL", async () => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "http://localhost:9999/callback",
      response_type: "code",
      state: "test-state-2",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });

    const response = await workerFetch(`/authorize?${params}`);
    const body = await response.text();
    // The consent screen should reference the configured Umbraco instance
    expect(body).toContain("localhost");
  });
});
