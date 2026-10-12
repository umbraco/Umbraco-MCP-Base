import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { isAtLeast, type ToolCollectionExport, type ToolDefinition } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../../types/env.js";
import type { AuthProps } from "../../types/auth.js";

// The session wrapper and `getServerSessionContext` are deliberately the real
// ones here (unlike register-chained-tools.test.ts): this file covers how the
// connected Umbraco version reaches a chained in-process collection.
jest.unstable_mockModule("../../http/umbraco-fetch-client.js", () => ({
  createFetchClientFromKV: jest.fn<any>().mockResolvedValue(jest.fn()),
  createUmbracoFetchClient: jest.fn<any>(),
  CAPTURE_RAW_HTTP_RESPONSE: { returnFullResponse: true },
}));
jest.unstable_mockModule("../../config/worker-config.js", () => ({
  loadWorkerConfig: jest.fn<any>().mockReturnValue({}),
  loadSiteConfig: jest.fn<any>(),
}));

// Per-test session values, standing in for what `createPerRequestServer` stores.
let sessionValues: Record<string, unknown> | undefined;
const actualCreateServer = await import("../create-server.js");
jest.unstable_mockModule("../create-server.js", () => ({
  ...actualCreateServer,
  getServerSessionContext: () => sessionValues,
}));

const gatedTool: ToolDefinition<any, any> = {
  name: "save-and-publish",
  description: "Gated on 17.6",
  slices: ["read"],
  inputSchema: {},
  handler: async () => ({ content: [{ type: "text" as const, text: "published" }] }),
};

const gatedCollection: ToolCollectionExport = {
  metadata: { name: "document", displayName: "Document", description: "Documents" },
  tools: (_user, options) => (isAtLeast(options?.umbracoVersion, 17, 6) ? [gatedTool] : []),
};

const chainedServer = {
  name: "demo",
  displayName: "Demo",
  modeRegistry: [{ name: "docs", displayName: "Docs", description: "Docs", collections: ["document"] }],
  collections: [gatedCollection],
  allModeNames: ["docs"] as readonly string[],
  allSliceNames: ["read"] as readonly string[],
};

const props: AuthProps = { umbracoTokenKey: "k", userId: "u", userName: "User" };
const env = {
  UMBRACO_BASE_URL: "https://test.example.com",
  UMBRACO_OAUTH_CLIENT_ID: "c",
  COOKIE_ENCRYPTION_KEY: "0".repeat(64),
} as unknown as HostedMcpEnv;

describe("registerChainedTools: connected Umbraco version", () => {
  let registerChainedTools: typeof import("../register-chained-tools.js").registerChainedTools;

  beforeEach(async () => {
    jest.clearAllMocks();
    registerChainedTools = (await import("../register-chained-tools.js")).registerChainedTools;
  });

  /** Registers the chained server on a mock server whose session carries `version`. */
  async function register(version: string | undefined) {
    const registered = new Map<string, (...args: any[]) => Promise<any>>();
    const server = {
      registerTool: jest.fn<any>().mockImplementation((name: string, _config: any, handler: any) => {
        registered.set(name, handler);
      }),
    };
    sessionValues = version ? { umbracoVersion: version } : {};
    const count = await registerChainedTools({
      server: server as any,
      env,
      props,
      chainedServer,
      fetchUser: false,
    });
    return { count, registered };
  }

  it.each(["17.6.0", "17.6.0-rc.1"])("registers and serves the gated tool for a %s site", async (version) => {
    const { count, registered } = await register(version);

    expect(count).toBe(1);
    const handler = registered.get("demo--save-and-publish");
    expect(handler).toBeDefined();
    const result = await handler!({}, {});
    expect(result.content[0].text).toBe("published");
  });

  it("does not list or serve the gated tool for a 17.5 site", async () => {
    const { count, registered } = await register("17.5.3");

    expect(count).toBe(0);
    expect(registered.has("demo--save-and-publish")).toBe(false);
  });

  it("treats an unknown version as the oldest and hides the gated tool", async () => {
    const { count } = await register(undefined);

    expect(count).toBe(0);
  });
});
