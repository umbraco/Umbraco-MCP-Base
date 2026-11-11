/**
 * The /callback route returns a 403 page, never a redirect to the MCP client,
 * when the browser doesn't carry the state cookie set at consent approval.
 */

import { describe, expect, it } from "@jest/globals";
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
