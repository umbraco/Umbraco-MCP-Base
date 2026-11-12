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

  it("advertises S256 as the only PKCE method", async () => {
    const response = await workerFetch("/.well-known/oauth-authorization-server");
    const metadata = await response.json();
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
  });

  describe("PKCE enforcement at /authorize", () => {
    let clientId: string;
    const redirectUri = "http://localhost:9999/callback";

    beforeAll(async () => {
      const registration = await workerFetch("/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "PKCE Test Client" }),
      });
      expect(registration.status).toBe(201);
      clientId = (await registration.json()).client_id;
    });

    function authorize(extra: Record<string, string>) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        state: "pkce-test",
        ...extra,
      });
      return workerFetch(`/authorize?${params}`);
    }

    it("rejects an authorization request without PKCE", async () => {
      const response = await authorize({});
      expect(response.status).toBe(400);
    });

    it("rejects the plain PKCE method", async () => {
      const response = await authorize({
        code_challenge: "plain-challenge-value-that-is-long-enough-0123456789",
        code_challenge_method: "plain",
      });
      expect(response.status).toBe(400);
    });

    it("accepts S256", async () => {
      const response = await authorize({
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
      });
      expect(response.status).toBe(200);
    });
  });
});
