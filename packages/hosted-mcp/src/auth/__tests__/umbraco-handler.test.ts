import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { HostedMcpEnv, OAuthAuthRequest } from "../../types/env.js";
import type { SiteConfig } from "../../types/multi-site.js";
import type { ConsentChoices } from "../../types/auth.js";

// ============================================================================
// Mocks — jest.unstable_mockModule for ESM + dynamic import
// ============================================================================

const mockStoreOAuthState = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const mockConsumeOAuthState = jest.fn<(...args: unknown[]) => Promise<Record<string, unknown> | null>>();
const mockStoreUmbracoToken = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const mockStoreLogoutRedirect = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const mockConsumeLogoutRedirect = jest.fn<(...args: unknown[]) => Promise<string | null>>();
const mockMarkClientAuthed = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const mockIsClientAuthed = jest.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(false);

jest.unstable_mockModule("../token-storage.js", () => ({
  getBackofficeEndpoints: (baseUrl: string, serverUrl?: string) => {
    const browserBase = baseUrl.replace(/\/$/, "");
    const serverBase = serverUrl ? serverUrl.replace(/\/$/, "") : browserBase;
    return {
      authorization_endpoint: `${browserBase}/umbraco/management/api/v1/security/back-office/authorize`,
      token_endpoint: `${serverBase}/umbraco/management/api/v1/security/back-office/token`,
      signout_endpoint: `${browserBase}/umbraco/management/api/v1/security/back-office/signout`,
    };
  },
  storeOAuthState: mockStoreOAuthState,
  consumeOAuthState: mockConsumeOAuthState,
  storeUmbracoToken: mockStoreUmbracoToken,
  storeLogoutRedirect: mockStoreLogoutRedirect,
  consumeLogoutRedirect: mockConsumeLogoutRedirect,
  markClientAuthed: mockMarkClientAuthed,
  isClientAuthed: mockIsClientAuthed,
}));

const mockConsentResponse = jest.fn<(...args: unknown[]) => Response>();

jest.unstable_mockModule("../consent.js", () => ({
  consentResponse: mockConsentResponse,
}));

// Mock global fetch for token exchange
const mockFetch = jest.fn<typeof fetch>();
(globalThis as any).fetch = mockFetch;

// Dynamic import after mocks are set up
const { createAuthorizeHandler, createCallbackHandler, createLogoutCallbackHandler } =
  await import("../umbraco-handler.js");

// ============================================================================
// Test Helpers
// ============================================================================

function createMockKV() {
  return {
    get: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
    put: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
  };
}

function createMockEnv(overrides: Partial<HostedMcpEnv> = {}): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://umbraco.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test-client-id",
    UMBRACO_OAUTH_CLIENT_SECRET: "test-client-secret",
    COOKIE_ENCRYPTION_KEY: "abc123def456",
    OAUTH_KV: createMockKV() as any,
    MCP_AGENT: {} as any,
    OAUTH_PROVIDER: {} as any,
    ...overrides,
  };
}

function createMockAuthRequest(
  overrides: Partial<OAuthAuthRequest> = {}
): OAuthAuthRequest {
  return {
    responseType: "code",
    clientId: "mcp-client-1",
    redirectUri: "https://client.example.com/callback",
    scope: ["openid", "offline_access"],
    state: "client-state-abc",
    ...overrides,
  };
}

// Fixed consent state token for tests — must match KV setup in each test
const TEST_CONSENT_STATE = "test-consent-state-token";

function createApproveFormBody(
  fields: Record<string, string | string[]> = {}
): FormData {
  const form = new FormData();
  form.set("action", "approve");
  form.set("state", TEST_CONSENT_STATE);
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        form.append(key, v);
      }
    } else {
      form.set(key, value);
    }
  }
  return form;
}

function createJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status < 400 ? "OK" : "Error",
    headers: { "Content-Type": "application/json" },
  });
}

// ============================================================================
// Reset
// ============================================================================

beforeEach(() => {
  mockStoreOAuthState.mockClear();
  mockConsumeOAuthState.mockClear().mockImplementation(async (_kv: unknown, key: string) => {
    // Return valid consent state for CSRF validation on POST
    if (key.startsWith("consent:")) {
      return { clientId: "mcp-client-1" };
    }
    return null;
  });
  mockStoreUmbracoToken.mockClear();
  mockStoreLogoutRedirect.mockClear();
  mockConsumeLogoutRedirect.mockClear();
  mockMarkClientAuthed.mockClear();
  mockIsClientAuthed.mockClear().mockResolvedValue(false);
  mockConsentResponse.mockClear();
  mockFetch.mockReset();

  // Default: consentResponse returns an HTML response
  mockConsentResponse.mockReturnValue(
    new Response("<html>consent</html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    })
  );
});

// ============================================================================
// createAuthorizeHandler
// ============================================================================

describe("createAuthorizeHandler", () => {
  describe("GET (consent screen)", () => {
    it("returns 200 HTML consent response", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "GET",
      });

      const response = await handler(request, createMockAuthRequest());

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/html");
    });

    it("stores consent state in KV with consent: prefix", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "GET",
      });
      const authRequest = createMockAuthRequest();

      await handler(request, authRequest);

      expect(mockStoreOAuthState).toHaveBeenCalledTimes(1);
      const [kv, stateKey, data] = mockStoreOAuthState.mock.calls[0] as [
        any,
        string,
        Record<string, unknown>,
      ];
      expect(kv).toBe(env.OAUTH_KV);
      expect(stateKey).toMatch(/^consent:/);
      expect(data).toEqual({ clientId: authRequest.clientId });
    });

    it("passes correct options to consentResponse", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env, {
        serverName: "My Server",
      });
      const request = new Request(
        "https://worker.example.com/authorize?foo=1",
        { method: "GET" }
      );
      const authRequest = createMockAuthRequest({
        clientId: "my-client",
        scope: ["openid"],
        redirectUri: "https://client.test/cb",
      });

      await handler(request, authRequest);

      expect(mockConsentResponse).toHaveBeenCalledTimes(1);
      const opts = mockConsentResponse.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(opts.clientName).toBe("my-client");
      expect(opts.umbracoBaseUrl).toBe("https://umbraco.example.com");
      expect(opts.scopes).toEqual(["openid"]);
      expect(opts.redirectUri).toBe("https://client.test/cb");
      expect(opts.actionUrl).toBe(
        "https://worker.example.com/authorize?foo=1"
      );
      expect(opts.serverName).toBe("My Server");
    });

    it("uses default scopes when authRequest.scope is empty", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "GET",
      });
      const authRequest = createMockAuthRequest({ scope: [] });

      await handler(request, authRequest);

      const opts = mockConsentResponse.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(opts.scopes).toEqual(["openid", "offline_access"]);
    });
  });

  describe("POST — deny", () => {
    it("redirects to redirectUri with error=access_denied", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const form = new FormData();
      form.set("action", "deny");
      form.set("state", TEST_CONSENT_STATE);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: form,
      });
      const authRequest = createMockAuthRequest({
        redirectUri: "https://client.example.com/cb",
        state: "client-xyz",
      });

      const response = await handler(request, authRequest);

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("Location")!);
      expect(location.origin + location.pathname).toBe(
        "https://client.example.com/cb"
      );
      expect(location.searchParams.get("error")).toBe("access_denied");
      expect(location.searchParams.get("state")).toBe("client-xyz");
    });

    it("omits state param when authRequest.state is empty", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const form = new FormData();
      form.set("action", "deny");
      form.set("state", TEST_CONSENT_STATE);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: form,
      });
      const authRequest = createMockAuthRequest({ state: "" });

      const response = await handler(request, authRequest);

      const location = new URL(response.headers.get("Location")!);
      expect(location.searchParams.has("state")).toBe(false);
    });
  });

  describe("POST — approve (single-site)", () => {
    it("redirects 302 to Umbraco authorize endpoint", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody(),
      });

      const response = await handler(request, createMockAuthRequest());

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("Location")!);
      expect(location.origin).toBe("https://umbraco.example.com");
      expect(location.pathname).toBe(
        "/umbraco/management/api/v1/security/back-office/authorize"
      );
    });

    it("includes required OAuth params in redirect URL", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody(),
      });

      const response = await handler(request, createMockAuthRequest());

      const location = new URL(response.headers.get("Location")!);
      expect(location.searchParams.get("response_type")).toBe("code");
      expect(location.searchParams.get("client_id")).toBe("test-client-id");
      expect(location.searchParams.get("redirect_uri")).toBe(
        "https://worker.example.com/callback"
      );
      expect(location.searchParams.get("scope")).toBe(
        "openid offline_access"
      );
      expect(location.searchParams.get("state")).toBeTruthy();
      expect(location.searchParams.get("code_challenge")).toBeTruthy();
      expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    });

    it("does not set prompt=login on approve redirect", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody(),
      });

      const response = await handler(request, createMockAuthRequest());

      const location = new URL(response.headers.get("Location")!);
      expect(location.searchParams.has("prompt")).toBe(false);
    });

    it("stores state in KV with authRequest, codeVerifier, and site credentials", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const authRequest = createMockAuthRequest();
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody(),
      });

      await handler(request, authRequest);

      expect(mockStoreOAuthState).toHaveBeenCalledTimes(1);
      const [kv, , data] = mockStoreOAuthState.mock.calls[0] as [
        any,
        string,
        Record<string, unknown>,
      ];
      expect(kv).toBe(env.OAUTH_KV);
      expect(data.authRequest).toEqual(authRequest);
      expect(data.codeVerifier).toBeTruthy();
      expect(typeof data.codeVerifier).toBe("string");
      expect(data.siteClientId).toBe("test-client-id");
      expect(data.siteClientSecret).toBe("test-client-secret");
      expect(data.siteBaseUrl).toBe("https://umbraco.example.com");
    });
  });

  describe("POST — reauth", () => {
    it("redirects to Umbraco signout endpoint", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const form = new FormData();
      form.set("action", "reauth");
      form.set("state", TEST_CONSENT_STATE);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: form,
      });

      const response = await handler(request, createMockAuthRequest());

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("Location")!);
      expect(location.origin).toBe("https://umbraco.example.com");
      expect(location.pathname).toBe(
        "/umbraco/management/api/v1/security/back-office/signout"
      );
    });

    it("includes post_logout_redirect_uri, state, and client_id in signout URL", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const form = new FormData();
      form.set("action", "reauth");
      form.set("state", TEST_CONSENT_STATE);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: form,
      });

      const response = await handler(request, createMockAuthRequest());

      const location = new URL(response.headers.get("Location")!);
      expect(location.searchParams.get("post_logout_redirect_uri")).toBe(
        "https://worker.example.com/logout-callback"
      );
      expect(location.searchParams.get("state")).toBeTruthy();
      expect(location.searchParams.get("client_id")).toBe("test-client-id");
    });

    it("stores logout redirect URL in KV", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const form = new FormData();
      form.set("action", "reauth");
      form.set("state", TEST_CONSENT_STATE);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: form,
      });

      await handler(request, createMockAuthRequest());

      expect(mockStoreLogoutRedirect).toHaveBeenCalledTimes(1);
      const [kv, key, url] = mockStoreLogoutRedirect.mock.calls[0] as [
        any,
        string,
        string,
      ];
      expect(kv).toBe(env.OAUTH_KV);
      expect(typeof key).toBe("string");
      expect(url).toContain("/umbraco/management/api/v1/security/back-office/authorize");
    });

    it("stores OAuth state in KV (same as approve)", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const form = new FormData();
      form.set("action", "reauth");
      form.set("state", TEST_CONSENT_STATE);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: form,
      });

      await handler(request, createMockAuthRequest());

      expect(mockStoreOAuthState).toHaveBeenCalledTimes(1);
    });
  });

  describe("GET — showReauthButton", () => {
    it("does not pass showReauthButton when option is not set", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "GET",
      });

      await handler(request, createMockAuthRequest());

      const opts = mockConsentResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(opts.showReauthButton).toBe(false);
    });

    it("passes showReauthButton=true when option is set and client has authed before", async () => {
      const env = createMockEnv();
      mockIsClientAuthed.mockResolvedValue(true);
      const handler = createAuthorizeHandler(env, { showReauthButton: true });
      const request = new Request("https://worker.example.com/authorize", {
        method: "GET",
      });

      await handler(request, createMockAuthRequest());

      const opts = mockConsentResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(opts.showReauthButton).toBe(true);
      expect(mockIsClientAuthed).toHaveBeenCalledWith(env.OAUTH_KV, "mcp-client-1");
    });

    it("passes showReauthButton=false when option is set but client has not authed before", async () => {
      const env = createMockEnv();
      mockIsClientAuthed.mockResolvedValue(false);
      const handler = createAuthorizeHandler(env, { showReauthButton: true });
      const request = new Request("https://worker.example.com/authorize", {
        method: "GET",
      });

      await handler(request, createMockAuthRequest());

      const opts = mockConsentResponse.mock.calls[0][0] as Record<string, unknown>;
      expect(opts.showReauthButton).toBe(false);
    });
  });

  describe("POST — approve with consent choices", () => {
    it("stores selectedModes from form", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({
          "selectedModes[]": ["content", "media"],
        }),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      expect(data.consentChoices).toEqual(
        expect.objectContaining({
          selectedModes: ["content", "media"],
        })
      );
    });

    it("stores readOnly=true from form", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({ readOnly: "true" }),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      expect(data.consentChoices).toEqual(
        expect.objectContaining({ readOnly: true })
      );
    });

    it("stores selectedCollections from form", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({
          "selectedModes[]": ["content"],
          "selectedCollections[]": ["document", "media"],
        }),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      expect(data.consentChoices).toEqual(
        expect.objectContaining({
          selectedCollections: ["document", "media"],
        })
      );
    });

    it("omits selectedCollections when none in form", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({
          "selectedModes[]": ["content"],
        }),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      expect(data.consentChoices).not.toHaveProperty("selectedCollections");
    });

    it("stores selectedSlices from form", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({
          "selectedSlices[]": ["read", "list"],
        }),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      expect(data.consentChoices).toEqual(
        expect.objectContaining({
          selectedSlices: ["read", "list"],
        })
      );
    });

    it("omits selectedSlices when none in form", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({
          "selectedModes[]": ["content"],
        }),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      expect(data.consentChoices).not.toHaveProperty("selectedSlices");
    });

    it("stores consentChoices as undefined when no choices in form", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody(),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      expect(data.consentChoices).toBeUndefined();
    });

    it("splits prefixed modes into chainedModeSelections", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({
          "selectedModes[]": ["content", "demo:alerts", "demo:reporting"],
        }),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      const choices = data.consentChoices as ConsentChoices;
      expect(choices.selectedModes).toEqual(["content"]);
      expect(choices.chainedModeSelections).toEqual({
        demo: ["alerts", "reporting"],
      });
    });

    it("splits prefixed collections into chainedCollectionSelections", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({
          "selectedModes[]": ["demo:alerts"],
          "selectedCollections[]": ["document", "demo:notification"],
        }),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      const choices = data.consentChoices as ConsentChoices;
      expect(choices.selectedCollections).toEqual(["document"]);
      expect(choices.chainedCollectionSelections).toEqual({
        demo: ["notification"],
      });
    });

    it("handles only chained modes with no main modes", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({
          "selectedModes[]": ["demo:alerts"],
        }),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      const choices = data.consentChoices as ConsentChoices;
      expect(choices.selectedModes).toBeUndefined();
      expect(choices.chainedModeSelections).toEqual({
        demo: ["alerts"],
      });
    });

    it("handles multiple chained server prefixes", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({
          "selectedModes[]": ["demo:alerts", "forms:forms"],
        }),
      });

      await handler(request, createMockAuthRequest());

      const data = (
        mockStoreOAuthState.mock.calls[0] as [any, string, Record<string, unknown>]
      )[2];
      const choices = data.consentChoices as ConsentChoices;
      expect(choices.chainedModeSelections).toEqual({
        demo: ["alerts"],
        forms: ["forms"],
      });
    });
  });

  describe("POST — approve (multi-site)", () => {
    const sites: SiteConfig[] = [
      {
        id: "prod",
        displayName: "Production",
        baseUrl: "https://prod.umbraco.com",
        oauthClientId: "prod-client",
        oauthClientSecret: "prod-secret",
      },
      {
        id: "staging",
        displayName: "Staging",
        baseUrl: "https://staging.umbraco.com",
        oauthClientId: "staging-client",
      },
    ];

    it("uses site-specific baseUrl in redirect", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env, { sites });
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({ siteId: "prod" }),
      });

      const response = await handler(request, createMockAuthRequest());

      const location = new URL(response.headers.get("Location")!);
      expect(location.origin).toBe("https://prod.umbraco.com");
    });

    it("uses site-specific oauthClientId as client_id param", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env, { sites });
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({ siteId: "prod" }),
      });

      const response = await handler(request, createMockAuthRequest());

      const location = new URL(response.headers.get("Location")!);
      expect(location.searchParams.get("client_id")).toBe("prod-client");
    });

    it("includes siteId in callback URL path", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env, { sites });
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody({ siteId: "staging" }),
      });

      const response = await handler(request, createMockAuthRequest());

      const location = new URL(response.headers.get("Location")!);
      expect(location.searchParams.get("redirect_uri")).toBe(
        "https://worker.example.com/callback/staging"
      );
    });
  });

  describe("custom scopes", () => {
    it("uses default scopes openid offline_access", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env);
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody(),
      });

      const response = await handler(request, createMockAuthRequest());

      const location = new URL(response.headers.get("Location")!);
      expect(location.searchParams.get("scope")).toBe(
        "openid offline_access"
      );
    });

    it("uses custom scopes from options", async () => {
      const env = createMockEnv();
      const handler = createAuthorizeHandler(env, {
        scopes: ["openid", "profile", "email"],
      });
      const request = new Request("https://worker.example.com/authorize", {
        method: "POST",
        body: createApproveFormBody(),
      });

      const response = await handler(request, createMockAuthRequest());

      const location = new URL(response.headers.get("Location")!);
      expect(location.searchParams.get("scope")).toBe(
        "openid profile email"
      );
    });
  });
});

// ============================================================================
// createCallbackHandler
// ============================================================================

describe("createCallbackHandler", () => {
  /** Builds stored state as returned by consumeOAuthState */
  function makeStoredState(
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      authRequest: createMockAuthRequest(),
      codeVerifier: "test-code-verifier-123",
      siteClientId: "test-client-id",
      siteClientSecret: "test-client-secret",
      siteBaseUrl: "https://umbraco.example.com",
      ...overrides,
    };
  }

  describe("happy path", () => {
    it("exchanges code for tokens and returns props + authRequest", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(makeStoredState());
      mockFetch.mockResolvedValue(
        createJsonResponse(200, {
          access_token: "umbraco-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "umbraco-refresh-token",
        })
      );

      const handler = createCallbackHandler(env);
      const request = new Request(
        "https://worker.example.com/callback?code=auth-code-123&state=test-state"
      );

      const result = await handler(request);

      expect(result.props.umbracoTokenKey).toBeTruthy();
      expect(result.props.userId).toBe("unknown");
      expect(result.authRequest.clientId).toBe("mcp-client-1");
    });

    it("consumes state from KV (get + delete)", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(makeStoredState());
      mockFetch.mockResolvedValue(
        createJsonResponse(200, {
          access_token: "tok",
          token_type: "Bearer",
        })
      );

      const handler = createCallbackHandler(env);
      await handler(
        new Request(
          "https://worker.example.com/callback?code=abc&state=xyz"
        )
      );

      expect(mockConsumeOAuthState).toHaveBeenCalledWith(
        env.OAUTH_KV,
        "xyz"
      );
    });

    it("calls Umbraco token endpoint with correct params", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(makeStoredState());
      mockFetch.mockResolvedValue(
        createJsonResponse(200, {
          access_token: "tok",
          token_type: "Bearer",
        })
      );

      const handler = createCallbackHandler(env);
      await handler(
        new Request(
          "https://worker.example.com/callback?code=my-code&state=my-state"
        )
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://umbraco.example.com/umbraco/management/api/v1/security/back-office/token"
      );
      expect(opts.method).toBe("POST");

      const body = opts.body as string;
      const params = new URLSearchParams(body);
      expect(params.get("grant_type")).toBe("authorization_code");
      expect(params.get("code")).toBe("my-code");
      expect(params.get("client_id")).toBe("test-client-id");
      expect(params.get("code_verifier")).toBe("test-code-verifier-123");
      expect(params.get("redirect_uri")).toBe(
        "https://worker.example.com/callback"
      );
    });

    it("stores tokens in KV with storeUmbracoToken", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(makeStoredState());
      const tokens = {
        access_token: "access-tok",
        token_type: "Bearer",
        expires_in: 3600,
      };
      mockFetch.mockResolvedValue(createJsonResponse(200, tokens));

      const handler = createCallbackHandler(env);
      await handler(
        new Request(
          "https://worker.example.com/callback?code=c&state=s"
        )
      );

      expect(mockStoreUmbracoToken).toHaveBeenCalledTimes(1);
      const [kv, tokenKey, storedTokens] = mockStoreUmbracoToken.mock
        .calls[0] as [any, string, unknown];
      expect(kv).toBe(env.OAUTH_KV);
      expect(typeof tokenKey).toBe("string");
      expect((tokenKey as string).length).toBeGreaterThan(0);
      expect(storedTokens).toEqual(tokens);
    });
  });

  describe("confidential client", () => {
    it("includes client_secret in token exchange", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(
        makeStoredState({ siteClientSecret: "the-secret" })
      );
      mockFetch.mockResolvedValue(
        createJsonResponse(200, {
          access_token: "tok",
          token_type: "Bearer",
        })
      );

      const handler = createCallbackHandler(env);
      await handler(
        new Request(
          "https://worker.example.com/callback?code=c&state=s"
        )
      );

      const body = (mockFetch.mock.calls[0] as [string, RequestInit])[1]
        .body as string;
      const params = new URLSearchParams(body);
      expect(params.get("client_secret")).toBe("the-secret");
    });
  });

  describe("public client", () => {
    it("omits client_secret when not present in state", async () => {
      const env = createMockEnv({ UMBRACO_OAUTH_CLIENT_SECRET: undefined });
      mockConsumeOAuthState.mockResolvedValue(
        makeStoredState({ siteClientSecret: undefined })
      );
      mockFetch.mockResolvedValue(
        createJsonResponse(200, {
          access_token: "tok",
          token_type: "Bearer",
        })
      );

      const handler = createCallbackHandler(env);
      await handler(
        new Request(
          "https://worker.example.com/callback?code=c&state=s"
        )
      );

      const body = (mockFetch.mock.calls[0] as [string, RequestInit])[1]
        .body as string;
      const params = new URLSearchParams(body);
      expect(params.has("client_secret")).toBe(false);
    });
  });

  describe("consent choices passthrough", () => {
    it("returns consentChoices from stored state in props", async () => {
      const choices: ConsentChoices = {
        selectedModes: ["content"],
        readOnly: true,
      };
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(
        makeStoredState({ consentChoices: choices })
      );
      mockFetch.mockResolvedValue(
        createJsonResponse(200, {
          access_token: "tok",
          token_type: "Bearer",
        })
      );

      const handler = createCallbackHandler(env);
      const result = await handler(
        new Request(
          "https://worker.example.com/callback?code=c&state=s"
        )
      );

      expect(result.props.consentChoices).toEqual(choices);
    });

    it("returns undefined consentChoices when not present in state", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(
        makeStoredState({ consentChoices: undefined })
      );
      mockFetch.mockResolvedValue(
        createJsonResponse(200, {
          access_token: "tok",
          token_type: "Bearer",
        })
      );

      const handler = createCallbackHandler(env);
      const result = await handler(
        new Request(
          "https://worker.example.com/callback?code=c&state=s"
        )
      );

      expect(result.props.consentChoices).toBeUndefined();
    });
  });

  describe("multi-site callback", () => {
    it("uses site-specific credentials from state for token exchange", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(
        makeStoredState({
          siteClientId: "prod-client",
          siteClientSecret: "prod-secret",
          siteBaseUrl: "https://prod.umbraco.com",
          consentChoices: { siteId: "prod" } as ConsentChoices,
        })
      );
      mockFetch.mockResolvedValue(
        createJsonResponse(200, {
          access_token: "tok",
          token_type: "Bearer",
        })
      );

      const handler = createCallbackHandler(env);
      await handler(
        new Request(
          "https://worker.example.com/callback/prod?code=c&state=s"
        )
      );

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "https://prod.umbraco.com/umbraco/management/api/v1/security/back-office/token"
      );

      const body = (mockFetch.mock.calls[0] as [string, RequestInit])[1]
        .body as string;
      const params = new URLSearchParams(body);
      expect(params.get("client_id")).toBe("prod-client");
      expect(params.get("client_secret")).toBe("prod-secret");
    });

    it("uses siteId in callback redirect_uri when consent choices have one", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(
        makeStoredState({
          consentChoices: { siteId: "staging" } as ConsentChoices,
        })
      );
      mockFetch.mockResolvedValue(
        createJsonResponse(200, {
          access_token: "tok",
          token_type: "Bearer",
        })
      );

      const handler = createCallbackHandler(env);
      await handler(
        new Request(
          "https://worker.example.com/callback/staging?code=c&state=s"
        )
      );

      const body = (mockFetch.mock.calls[0] as [string, RequestInit])[1]
        .body as string;
      const params = new URLSearchParams(body);
      expect(params.get("redirect_uri")).toBe(
        "https://worker.example.com/callback/staging"
      );
    });
  });

  describe("error paths", () => {
    it("throws with Umbraco error when error query param is present", async () => {
      const env = createMockEnv();
      const handler = createCallbackHandler(env);

      await expect(
        handler(
          new Request(
            "https://worker.example.com/callback?error=invalid_scope&error_description=Bad+scope"
          )
        )
      ).rejects.toThrow("Umbraco authorization error: invalid_scope");
    });

    it("throws 'Missing code or state' when code is missing", async () => {
      const env = createMockEnv();
      const handler = createCallbackHandler(env);

      await expect(
        handler(
          new Request("https://worker.example.com/callback?state=s")
        )
      ).rejects.toThrow("Missing code or state");
    });

    it("throws 'Missing code or state' when state is missing", async () => {
      const env = createMockEnv();
      const handler = createCallbackHandler(env);

      await expect(
        handler(
          new Request("https://worker.example.com/callback?code=c")
        )
      ).rejects.toThrow("Missing code or state");
    });

    it("throws 'Invalid or expired' when KV state is null", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(null);
      const handler = createCallbackHandler(env);

      await expect(
        handler(
          new Request(
            "https://worker.example.com/callback?code=c&state=expired"
          )
        )
      ).rejects.toThrow("Invalid or expired");
    });

    it("throws 'missing authRequest' when authRequest not in state", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue({
        codeVerifier: "cv",
      });
      const handler = createCallbackHandler(env);

      await expect(
        handler(
          new Request(
            "https://worker.example.com/callback?code=c&state=s"
          )
        )
      ).rejects.toThrow("missing authRequest");
    });

    it("throws 'missing codeVerifier' when codeVerifier not in state", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue({
        authRequest: createMockAuthRequest(),
      });
      const handler = createCallbackHandler(env);

      await expect(
        handler(
          new Request(
            "https://worker.example.com/callback?code=c&state=s"
          )
        )
      ).rejects.toThrow("missing codeVerifier");
    });

    it("throws 'Token exchange failed' with status on non-2xx", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(makeStoredState());
      mockFetch.mockResolvedValue(
        new Response("invalid_grant: code expired", {
          status: 400,
          statusText: "Bad Request",
        })
      );

      const handler = createCallbackHandler(env);

      await expect(
        handler(
          new Request(
            "https://worker.example.com/callback?code=c&state=s"
          )
        )
      ).rejects.toThrow("Token exchange failed: 400");
    });
  });

  describe("client auth marker", () => {
    it("marks client as authed after successful token exchange", async () => {
      const env = createMockEnv();
      mockConsumeOAuthState.mockResolvedValue(makeStoredState());
      mockFetch.mockResolvedValue(
        createJsonResponse(200, {
          access_token: "tok",
          token_type: "Bearer",
        })
      );

      const handler = createCallbackHandler(env);
      await handler(
        new Request(
          "https://worker.example.com/callback?code=c&state=s"
        )
      );

      expect(mockMarkClientAuthed).toHaveBeenCalledTimes(1);
      expect(mockMarkClientAuthed).toHaveBeenCalledWith(
        env.OAUTH_KV,
        "mcp-client-1"
      );
    });
  });
});

// ============================================================================
// createLogoutCallbackHandler
// ============================================================================

describe("createLogoutCallbackHandler", () => {
  it("redirects to stored authorize URL on valid state", async () => {
    const env = createMockEnv();
    mockConsumeLogoutRedirect.mockResolvedValue(
      "https://umbraco.example.com/umbraco/management/api/v1/security/back-office/authorize?client_id=test"
    );

    const handler = createLogoutCallbackHandler(env);
    const response = await handler(
      new Request("https://worker.example.com/logout-callback?state=abc123")
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://umbraco.example.com/umbraco/management/api/v1/security/back-office/authorize?client_id=test"
    );
    expect(mockConsumeLogoutRedirect).toHaveBeenCalledWith(env.OAUTH_KV, "abc123");
  });

  it("returns 400 when state parameter is missing", async () => {
    const env = createMockEnv();
    const handler = createLogoutCallbackHandler(env);
    const response = await handler(
      new Request("https://worker.example.com/logout-callback")
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Missing state parameter" });
  });

  it("returns 400 when state is expired or invalid", async () => {
    const env = createMockEnv();
    mockConsumeLogoutRedirect.mockResolvedValue(null);

    const handler = createLogoutCallbackHandler(env);
    const response = await handler(
      new Request("https://worker.example.com/logout-callback?state=expired")
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: "Invalid or expired logout state" });
  });
});
