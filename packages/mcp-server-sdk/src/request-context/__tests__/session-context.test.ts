/**
 * Per-session values in the request-context store (Umbraco-MCP-Base#383).
 *
 * The SDK's module-level slots — `setCustomTransport`, `configureApiClient`,
 * `setServerRef` — are fallbacks for stdio/CLI/tests. Inside a store, the
 * store's values win, so interleaved hosted sessions each use their own.
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import { z } from "zod";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  runWithRequestContext,
  getActiveRequestContext,
  getSessionUmbracoAuth,
  pickCarriedRequestContext,
  requireRequestContext,
  resetRequireRequestContext,
} from "../async-request-context.js";
import { UmbracoManagementClient, setCustomTransport } from "../../http/umbraco-fetch-client.js";
import { configureApiClient, getApiClient } from "../../helpers/api-call-helpers.js";
import { setServerRef, getServerRef, clearServerRef } from "../../helpers/server-ref.js";
import { InProcessConnection } from "../../mcp-client/in-process-connection.js";
import type { ToolCollectionExport } from "../../types/tool-collection.js";

const transportFor = (name: string) =>
  (async () => ({ via: name })) as unknown as <T>(config: { url: string; method: string }) => Promise<T>;

const fakeServer = (name: string) => ({ name }) as unknown as Server;

afterEach(() => {
  resetRequireRequestContext();
  setCustomTransport(null);
  configureApiClient(null as any);
  clearServerRef();
});

describe("session values in the request-context store", () => {
  it("UmbracoManagementClient uses the store's transport over the module one", async () => {
    setCustomTransport(transportFor("module"));
    const inStore = await runWithRequestContext({ transport: transportFor("session") }, () =>
      UmbracoManagementClient({ url: "/x", method: "GET" })
    );
    const outside = await UmbracoManagementClient({ url: "/x", method: "GET" });
    expect(inStore).toEqual({ via: "session" });
    expect(outside).toEqual({ via: "module" });
  });

  it("getApiClient uses the store's provider over the module one", () => {
    configureApiClient(() => "module");
    expect(runWithRequestContext({ apiClientProvider: () => "session" }, () => getApiClient())).toBe("session");
    expect(getApiClient()).toBe("module");
  });

  it("getServerRef uses the store's server over the module one", () => {
    const moduleServer = fakeServer("module");
    const sessionServer = fakeServer("session");
    setServerRef(moduleServer);
    expect(runWithRequestContext({ server: sessionServer }, () => getServerRef())).toBe(sessionServer);
    expect(getServerRef()).toBe(moduleServer);
  });

  it("keeps interleaved sessions on their own transport across an await", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const a = runWithRequestContext({ transport: transportFor("A") }, async () => {
      await gate;
      return UmbracoManagementClient({ url: "/x", method: "GET" });
    });
    const b = runWithRequestContext({ transport: transportFor("B") }, async () => {
      const result = await UmbracoManagementClient({ url: "/x", method: "GET" });
      release();
      return result;
    });

    expect(await Promise.all([a, b])).toEqual([{ via: "A" }, { via: "B" }]);
  });

  it("never copies session values onto a chained call's extra", () => {
    const picked = pickCarriedRequestContext({
      transport: transportFor("A"),
      apiClientProvider: () => "A",
      server: fakeServer("A"),
      umbracoAuth: async () => ({ baseUrl: "https://a", accessToken: "a" }),
    });
    expect(picked).toEqual({});
  });

  it("ignores session keys of the wrong shape", () => {
    runWithRequestContext({ transport: "nope", apiClientProvider: 1, server: "x", umbracoAuth: {} }, () => {
      expect(getActiveRequestContext()).toEqual({});
    });
  });
});

describe("getSessionUmbracoAuth", () => {
  it("returns each interleaved session's own auth", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const a = runWithRequestContext(
      { umbracoAuth: async () => ({ baseUrl: "https://a.example", accessToken: "token-a" }) },
      async () => {
        await gate;
        return getSessionUmbracoAuth();
      }
    );
    const b = runWithRequestContext(
      { umbracoAuth: async () => ({ baseUrl: "https://b.example", accessToken: "token-b" }) },
      async () => {
        const auth = await getSessionUmbracoAuth();
        release();
        return auth;
      }
    );

    expect(await Promise.all([a, b])).toEqual([
      { baseUrl: "https://a.example", accessToken: "token-a" },
      { baseUrl: "https://b.example", accessToken: "token-b" },
    ]);
  });

  it("throws outside a request", async () => {
    await expect(getSessionUmbracoAuth()).rejects.toThrow("Session Umbraco auth not configured");
  });
});

describe("InProcessConnection.callTool and the API client", () => {
  const clientCollection: ToolCollectionExport = {
    metadata: { name: "client", displayName: "Client", description: "" },
    tools: () => [
      {
        name: "which-client",
        description: "Reports which API client the handler sees",
        inputSchema: { _: z.string().optional() },
        slices: ["read"],
        handler: async () => {
          await Promise.resolve();
          return { content: [{ type: "text" as const, text: String(getApiClient()) }] };
        },
      } as any,
    ],
  };

  it("gives a chained server with a clientFactory that factory's client, scoped to the call", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "chained",
      collections: [clientCollection],
      clientFactory: () => "chained-client",
    });

    const result = await runWithRequestContext({ apiClientProvider: () => "caller-client" }, async () => {
      const chained = await connection.callTool("which-client", {});
      // The caller's own client is untouched after the chained call.
      return { chained: chained.content[0].text, after: getApiClient() };
    });

    expect(result).toEqual({ chained: "chained-client", after: "caller-client" });
  });

  it("gives a chained server without a clientFactory the caller's client", async () => {
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "chained",
      collections: [clientCollection],
    });

    const result = await runWithRequestContext({ apiClientProvider: () => "caller-client" }, () =>
      connection.callTool("which-client", {})
    );

    expect(result.content[0].text).toBe("caller-client");
  });

  it("does not swap the module client", async () => {
    configureApiClient(() => "module-client");
    const connection = new InProcessConnection({
      transport: "in-process",
      name: "chained",
      collections: [clientCollection],
      clientFactory: () => "chained-client",
    });

    const pending = connection.callTool("which-client", {});
    // Mid-call, code outside the chained call still sees the module client.
    expect(getApiClient()).toBe("module-client");
    expect((await pending).content[0].text).toBe("chained-client");
    expect(getApiClient()).toBe("module-client");
  });
});

describe("requireRequestContext", () => {
  it("stops the accessors falling back to module values outside a store", async () => {
    setCustomTransport(transportFor("module"));
    configureApiClient(() => ({ via: "module" }));
    setServerRef(fakeServer("module"));
    requireRequestContext();

    expect(() => getApiClient()).toThrow("outside a request context");
    expect(() => getServerRef()).toThrow("outside a request context");
    await expect(UmbracoManagementClient({ url: "/x", method: "GET" })).rejects.toThrow(
      "outside a request context"
    );
  });

  it("also refuses the fallback when the store lacks that key", async () => {
    configureApiClient(() => ({ via: "module" }));
    requireRequestContext();
    expect(() => runWithRequestContext({}, () => getApiClient())).toThrow("outside a request context");
  });

  it("still lets a store's own values through", async () => {
    requireRequestContext();
    const via = await runWithRequestContext({ transport: transportFor("session") }, () =>
      UmbracoManagementClient({ url: "/x", method: "GET" })
    );
    expect(via).toEqual({ via: "session" });
  });

  it("resetRequireRequestContext restores the module fallback", () => {
    configureApiClient(() => ({ via: "module" }));
    setServerRef(fakeServer("module"));
    requireRequestContext();
    expect(() => getApiClient()).toThrow("outside a request context");

    resetRequireRequestContext();

    expect(getApiClient()).toEqual({ via: "module" });
    expect(getServerRef()).toBeDefined();
  });
});
