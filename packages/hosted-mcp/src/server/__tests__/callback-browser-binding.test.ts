/**
 * The /callback route returns a 403 page, never a redirect to the MCP client,
 * when the browser doesn't carry the state cookie set at consent approval.
 */

import { describe, expect, it, jest } from "@jest/globals";
import { createDefaultHandler, type HostedMcpServerOptions } from "../worker-entry.js";
import { flowCookieName } from "../../auth/flow-cookies.js";
import type { HostedMcpEnv } from "../../types/env.js";

const options: HostedMcpServerOptions = {
  name: "test-mcp",
  version: "0.0.0",
  collections: [],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: [],
};

type DefaultFetch = (req: Request, env: HostedMcpEnv) => Promise<Response>;

const STATE = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeEnv(): HostedMcpEnv {
  // KV and the OAuth provider are deliberately empty objects: a rejected
  // callback must not reach either of them.
  return {
    UMBRACO_BASE_URL: "https://umbraco.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test",
    COOKIE_ENCRYPTION_KEY: "00".repeat(32),
    OAUTH_KV: {} as KVNamespace,
    MCP_AGENT: {} as DurableObjectNamespace,
    OAUTH_PROVIDER: {} as HostedMcpEnv["OAUTH_PROVIDER"],
  };
}

const handler = createDefaultHandler(options) as unknown as { fetch: DefaultFetch };

describe("/callback browser binding", () => {
  it("returns a 403 HTML page when the browser has no state cookie", async () => {
    const response = await handler.fetch(
      new Request(`https://worker.example.com/callback?code=c&state=${STATE}`),
      makeEnv()
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain("Start the connection again from your AI client");
  });

  it("clears the state cookie on rejection", async () => {
    const response = await handler.fetch(
      new Request(`https://worker.example.com/callback?code=c&state=${STATE}`),
      makeEnv()
    );
    expect(response.headers.getSetCookie()).toEqual([
      `${flowCookieName("state", STATE)}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
    ]);
  });

  it("returns a 403 when the cookie holds a different state", async () => {
    const response = await handler.fetch(
      new Request(`https://worker.example.com/callback?code=c&state=${STATE}`, {
        headers: { Cookie: `${flowCookieName("state", STATE)}=${"f".repeat(64)}` },
      }),
      makeEnv()
    );
    expect(response.status).toBe(403);
  });

  it("keeps the existing 400 JSON error for a callback missing its code", async () => {
    const response = await handler.fetch(
      new Request(`https://worker.example.com/callback?state=${STATE}`),
      makeEnv()
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("/callback when Umbraco returns an error", () => {
  const CLIENT_REDIRECT = "https://client.example.com/oauth/callback";

  function envWithState() {
    const data = new Map<string, string>([
      [
        `oauth_state:${STATE}`,
        JSON.stringify({
          authRequest: { clientId: "client-1", redirectUri: CLIENT_REDIRECT, state: "client-state" },
          codeVerifier: "v",
          callbackPath: "/callback",
        }),
      ],
    ]);
    const env = {
      ...makeEnv(),
      OAUTH_KV: {
        get: async (key: string) => data.get(key) ?? null,
        put: async () => undefined,
        delete: async (key: string) => {
          data.delete(key);
        },
      } as unknown as KVNamespace,
    };
    return { env, data };
  }

  function errorCallback(error: string, withCookie: boolean) {
    return new Request(
      `https://worker.example.com/callback?error=${error}&error_description=attacker+text&state=${STATE}`,
      withCookie ? { headers: { Cookie: `${flowCookieName("state", STATE)}=${STATE}` } } : {}
    );
  }

  it("ends the flow and sends access_denied to the MCP client in the browser that started it", async () => {
    const { env, data } = envWithState();
    const response = await handler.fetch(errorCallback("access_denied", true), env);

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    expect(`${location.origin}${location.pathname}`).toBe(CLIENT_REDIRECT);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("client-state");
    // Umbraco's own description is never forwarded.
    expect(location.searchParams.get("error_description")).not.toContain("attacker");
    expect(data.has(`oauth_state:${STATE}`)).toBe(false);
    expect(response.headers.getSetCookie()).toEqual([
      `${flowCookieName("state", STATE)}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
    ]);
  });

  it("maps an unexpected upstream error code to server_error", async () => {
    const { env } = envWithState();
    const response = await handler.fetch(errorCallback("invalid_scope", true), env);
    expect(new URL(response.headers.get("Location")!).searchParams.get("error")).toBe("server_error");
  });

  it("does not redirect, or consume the state, without the browser's state cookie", async () => {
    const { env, data } = envWithState();
    const response = await handler.fetch(errorCallback("access_denied", false), env);

    expect(response.headers.get("Location")).toBeNull();
    expect(response.status).toBe(400);
    expect(data.has(`oauth_state:${STATE}`)).toBe(true);
  });

  it("does not repeat Umbraco's error or its description in the error page", async () => {
    const { env } = envWithState();
    const response = await handler.fetch(errorCallback("some_upstream_code", false), env);

    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "Umbraco ended the sign-in with an error" });
    expect(body).not.toContain("attacker");
    expect(body).not.toContain("some_upstream_code");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("/callback when the sign-in can't be completed", () => {
  const cookie = { headers: { Cookie: `${flowCookieName("state", STATE)}=${STATE}` } };
  const INTERNAL_HOST = "umbraco.internal.example.net";

  function envWithState(): HostedMcpEnv {
    const data = new Map<string, string>([
      [
        `oauth_state:${STATE}`,
        JSON.stringify({
          authRequest: { clientId: "client-1", redirectUri: "https://client.example.com/cb", state: "s" },
          codeVerifier: "v",
          callbackPath: "/callback",
        }),
      ],
    ]);
    return {
      ...makeEnv(),
      OAUTH_KV: {
        get: async (key: string) => data.get(key) ?? null,
        put: async () => undefined,
        delete: async (key: string) => {
          data.delete(key);
        },
      } as unknown as KVNamespace,
    };
  }

  async function callbackWith(fetchImpl: typeof fetch): Promise<Response> {
    const realFetch = globalThis.fetch;
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    globalThis.fetch = fetchImpl;
    try {
      return await handler.fetch(
        new Request(`https://worker.example.com/callback?code=c&state=${STATE}`, cookie),
        envWithState()
      );
    } finally {
      globalThis.fetch = realFetch;
      error.mockRestore();
    }
  }

  it("does not return Umbraco's token-endpoint response", async () => {
    const response = await callbackWith(
      (async () =>
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: `The code was issued by https://${INTERNAL_HOST}`,
          }),
          { status: 400 }
        )) as typeof fetch
    );

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "The sign-in could not be completed with Umbraco" });
    expect(body).not.toContain(INTERNAL_HOST);
    expect(response.headers.get("Location")).toBeNull();
  });

  it("reports an unexpected failure generically", async () => {
    const response = await callbackWith((async () => {
      throw new TypeError(`fetch failed: getaddrinfo ENOTFOUND ${INTERNAL_HOST}`);
    }) as typeof fetch);

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "Authentication failed" });
    expect(body).not.toContain(INTERNAL_HOST);
  });
});
