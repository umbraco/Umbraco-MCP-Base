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

  it("consent page does not show reauth on first authorization", async () => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "http://localhost:9999/callback",
      response_type: "code",
      state: "test-state-buttons",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });

    const response = await workerFetch(`/authorize?${params}`);
    const body = await response.text();
    expect(body).toContain('value="approve"');
    expect(body).toContain('value="deny"');
    // No reauth button on first authorization (no client_authed marker in KV yet)
    expect(body).not.toContain('value="reauth"');
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

describe("Consent flow browser binding", () => {
  let clientId: string;
  const redirectUri = "http://localhost:9999/callback";

  function authorizeParams(state: string): URLSearchParams {
    return new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
    });
  }

  /** Opens the consent screen; returns the form's state and the cookie the browser would store. */
  async function openConsent(params: URLSearchParams) {
    const response = await workerFetch(`/authorize?${params}`);
    expect(response.status).toBe(200);
    const body = await response.text();
    const consentState = body.match(/name="state" value="([^"]+)"/)?.[1];
    expect(consentState).toBeTruthy();
    const setCookie = response.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0];
    return { body, consentState: consentState!, setCookie, cookie };
  }

  function submit(params: URLSearchParams, consentState: string, headers: Record<string, string>) {
    return workerFetch(`/authorize?${params}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams({ state: consentState, action: "approve" }).toString(),
      redirect: "manual",
    });
  }

  beforeAll(async () => {
    await startWorker();
    const regResponse = await workerFetch("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        client_name: "Binding Test Client",
      }),
    });
    expect(regResponse.status).toBe(201);
    clientId = (await regResponse.json()).client_id;
  }, 120_000);

  afterAll(async () => {
    await stopWorker();
  });

  it("shows the client's registered name and redirect host", async () => {
    const { body } = await openConsent(authorizeParams("binding-name"));
    expect(body).toContain("Binding Test Client");
    expect(body).toContain("Name provided by the application");
    expect(body).toContain("<strong>localhost</strong>");
  });

  it("sets a __Host- consent cookie bound to the form's state", async () => {
    const { consentState, setCookie } = await openConsent(authorizeParams("binding-cookie"));
    expect(setCookie).toMatch(/^__Host-mcp_consent_[0-9a-f]{16}=/);
    expect(setCookie).toContain(`=${consentState};`);
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
  });

  it("rejects an approval from a browser without the consent cookie", async () => {
    const params = authorizeParams("binding-no-cookie");
    const { consentState } = await openConsent(params);
    const response = await submit(params, consentState, {});
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
  });

  it("rejects a cross-site approval even with the consent cookie", async () => {
    const params = authorizeParams("binding-cross-site");
    const { consentState, cookie } = await openConsent(params);
    const response = await submit(params, consentState, {
      Cookie: cookie,
      "Sec-Fetch-Site": "cross-site",
    });
    expect(response.status).toBe(403);
  });

  it("accepts an approval from the same browser and sets the state cookie for Umbraco's state", async () => {
    const params = authorizeParams("binding-ok");
    const { consentState, cookie } = await openConsent(params);
    const response = await submit(params, consentState, {
      Cookie: cookie,
      "Sec-Fetch-Site": "same-origin",
    });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toContain("/security/back-office/authorize");
    const umbracoState = location.searchParams.get("state")!;
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`__Host-mcp_state_${umbracoState.slice(0, 16)}=${umbracoState};`);
  });

  it("rejects a callback from a browser without the state cookie", async () => {
    const params = authorizeParams("binding-callback");
    const { consentState, cookie } = await openConsent(params);
    const approval = await submit(params, consentState, {
      Cookie: cookie,
      "Sec-Fetch-Site": "same-origin",
    });
    const umbracoState = new URL(approval.headers.get("location")!).searchParams.get("state")!;

    // A different browser opens the Umbraco authorize link and lands on /callback.
    const response = await workerFetch(`/callback?code=any-code&state=${umbracoState}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("Start the connection again from your AI client");
  });
});
