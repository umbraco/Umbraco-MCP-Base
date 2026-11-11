/**
 * Outside siteRouting, /authorize defaults `resource` to the Worker's origin,
 * so every grant (and so every access token) is audience-bound.
 */

import { describe, expect, it } from "@jest/globals";
import {
  createDefaultHandler,
  withDefaultResource,
  type HostedMcpServerOptions,
} from "../worker-entry.js";
import type { HostedMcpEnv } from "../../types/env.js";

type DefaultFetch = (req: Request, env: HostedMcpEnv) => Promise<Response>;

const baseOptions: HostedMcpServerOptions = {
  name: "test-mcp",
  version: "0.0.0",
  collections: [],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: [],
};

/** Captures the request the OAuth provider is asked to parse, then stops. */
function envCapturing(seen: Request[]): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://umbraco.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test",
    COOKIE_ENCRYPTION_KEY: "00".repeat(32),
    OAUTH_KV: {} as KVNamespace,
    MCP_AGENT: {} as DurableObjectNamespace,
    OAUTH_PROVIDER: {
      parseAuthRequest: async (request: Request) => {
        seen.push(request);
        throw new Error("stop here");
      },
    } as unknown as HostedMcpEnv["OAUTH_PROVIDER"],
  };
}

describe("withDefaultResource", () => {
  it("adds the Worker origin as resource when the client sent none", () => {
    const request = withDefaultResource(new Request("https://worker.example.com/authorize?client_id=c"));
    expect(new URL(request.url).searchParams.getAll("resource")).toEqual(["https://worker.example.com"]);
  });

  it("leaves a resource the client sent unchanged", () => {
    const original = new Request("https://worker.example.com/authorize?resource=https%3A%2F%2Fworker.example.com%2Fmcp");
    expect(withDefaultResource(original)).toBe(original);
  });

  it("keeps the method, headers and body of a consent form submission", async () => {
    const request = withDefaultResource(
      new Request("https://worker.example.com/authorize?client_id=c", {
        method: "POST",
        headers: { Cookie: "a=1", "Content-Type": "application/x-www-form-urlencoded" },
        body: "action=approve&state=s",
      })
    );
    expect(request.method).toBe("POST");
    expect(request.headers.get("Cookie")).toBe("a=1");
    expect(await request.text()).toBe("action=approve&state=s");
  });
});

describe("/authorize resource default by mode", () => {
  it("single-site: the provider sees the Worker origin as resource", async () => {
    const seen: Request[] = [];
    const handler = createDefaultHandler(baseOptions) as unknown as { fetch: DefaultFetch };
    await handler.fetch(new Request("https://worker.example.com/authorize?client_id=c"), envCapturing(seen));
    expect(new URL(seen[0].url).searchParams.get("resource")).toBe("https://worker.example.com");
  });

  it("static multi-site: the provider sees the Worker origin as resource", async () => {
    const seen: Request[] = [];
    const handler = createDefaultHandler({
      ...baseOptions,
      multiSite: {
        sites: [{ id: "a", displayName: "A", baseUrl: "https://a.example.com", oauthClientId: "a" }],
      },
    } as HostedMcpServerOptions) as unknown as { fetch: DefaultFetch };
    await handler.fetch(new Request("https://worker.example.com/authorize?client_id=c"), envCapturing(seen));
    expect(new URL(seen[0].url).searchParams.get("resource")).toBe("https://worker.example.com");
  });
});
