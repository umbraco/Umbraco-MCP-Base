/**
 * Consent screen tests for chained MCP modes.
 *
 * Verifies the consent screen HTML contains chained server mode checkboxes
 * with prefixed values and correct display names.
 */

import { startWorker, stopWorker, workerFetch } from "./helpers/worker.js";

describe("Consent screen with chained modes", () => {
  let clientId: string;

  beforeAll(async () => {
    await startWorker();

    // Register a dynamic client
    const regResponse = await workerFetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:9999/callback"],
        client_name: "Chained Integration Test Client",
      }),
    });
    expect(regResponse.status).toBe(201);
    const regData = await regResponse.json();
    clientId = regData.client_id;
  }, 120_000);

  afterAll(async () => {
    await stopWorker();
  });

  function authorizeUrl(): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "http://localhost:9999/callback",
      response_type: "code",
      state: "test-chained-state",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });
    return `/authorize?${params}`;
  }

  it("renders consent page with tool selection enabled", async () => {
    const response = await workerFetch(authorizeUrl());
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("my-umbraco-mcp-chained");
  });

  it("includes main server mode checkboxes", async () => {
    const response = await workerFetch(authorizeUrl());
    const body = await response.text();
    // Main mode values are unprefixed
    expect(body).toContain('value="example"');
    expect(body).toContain("Example Tools");
  });

  it("includes chained demo:alerts mode checkbox with prefixed value", async () => {
    const response = await workerFetch(authorizeUrl());
    const body = await response.text();
    expect(body).toContain('value="demo:alerts"');
    expect(body).toContain("Alerts &amp; Notifications");
    // Group header for chained server with add-on badge
    expect(body).toContain("Demo Add-On");
    expect(body).toContain("addon-badge");
  });

  it("includes chained demo:reporting mode checkbox with prefixed value", async () => {
    const response = await workerFetch(authorizeUrl());
    const body = await response.text();
    expect(body).toContain('value="demo:reporting"');
    expect(body).toContain("Reporting");
  });

  it("includes chained collection checkboxes with prefixed values", async () => {
    const response = await workerFetch(authorizeUrl());
    const body = await response.text();
    expect(body).toContain('value="demo:notification"');
    expect(body).toContain('value="demo:analytics"');
  });

  it("includes deduplicated slices from both servers", async () => {
    const response = await workerFetch(authorizeUrl());
    const body = await response.text();
    // Slices from main server
    expect(body).toContain('value="read"');
    expect(body).toContain('value="create"');
    expect(body).toContain('value="update"');
    expect(body).toContain('value="delete"');
    expect(body).toContain('value="list"');
    // 'other' should not appear
    expect(body).not.toContain('value="other"');
  });

  it("shows read-only toggle", async () => {
    const response = await workerFetch(authorizeUrl());
    const body = await response.text();
    expect(body).toContain('name="readOnly"');
    expect(body).toContain("Read-only mode");
  });
});
