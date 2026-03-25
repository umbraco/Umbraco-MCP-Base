import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ToolCollectionExport, ToolDefinition, ToolModeDefinition } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../../types/env.js";
import type { AuthProps, ConsentChoices } from "../../types/auth.js";

// ============================================================================
// Mocks
// ============================================================================

// Mock createFetchClientFromKV
const mockFetchClient = jest.fn<any>();
jest.unstable_mockModule("../../http/umbraco-fetch-client.js", () => ({
  createFetchClientFromKV: jest.fn<any>().mockResolvedValue(mockFetchClient),
  createUmbracoFetchClient: jest.fn<any>(),
  CAPTURE_RAW_HTTP_RESPONSE: { returnFullResponse: true },
}));

// Mock loadWorkerConfig
jest.unstable_mockModule("../../config/worker-config.js", () => ({
  loadWorkerConfig: jest.fn<any>().mockReturnValue({}),
  loadSiteConfig: jest.fn<any>(),
}));

// Track registered tools on the mock server
let registeredTools: Array<{ name: string; description: string }> = [];

function createMockServer() {
  registeredTools = [];
  return {
    registerTool: jest.fn<any>().mockImplementation((name: string, config: any) => {
      registeredTools.push({ name, description: config.description });
    }),
  };
}

function createMockTool(name: string, slices: string[] = ["read"]): ToolDefinition<any, any> {
  return {
    name,
    description: `Test tool: ${name}`,
    slices,
    handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
  };
}

function createMockCollection(
  name: string,
  tools: ToolDefinition<any, any>[],
): ToolCollectionExport {
  return {
    metadata: {
      name,
      displayName: name,
      description: `Collection: ${name}`,
    },
    tools: () => tools,
  };
}

function createMockEnv(): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://test.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test-client",
    COOKIE_ENCRYPTION_KEY: "0".repeat(64),
  } as unknown as HostedMcpEnv;
}

function createMockProps(overrides?: Partial<AuthProps>): AuthProps {
  return {
    umbracoTokenKey: "test-token-key",
    userId: "test-user",
    userName: "Test User",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("registerChainedTools", () => {
  let registerChainedTools: typeof import("../register-chained-tools.js").registerChainedTools;

  beforeEach(async () => {
    jest.clearAllMocks();
    registeredTools = [];
    mockFetchClient.mockResolvedValue({ sub: "test-user", name: "Test" });

    const mod = await import("../register-chained-tools.js");
    registerChainedTools = mod.registerChainedTools;
  });

  const notificationTool = createMockTool("get-notification");
  const analyticsTool = createMockTool("get-analytics-summary");

  const notificationCollection = createMockCollection("notification", [notificationTool]);
  const analyticsCollection = createMockCollection("analytics", [analyticsTool]);

  const demoModes: ToolModeDefinition[] = [
    { name: "alerts", displayName: "Alerts", description: "Notifications", collections: ["notification"] },
    { name: "reporting", displayName: "Reporting", description: "Analytics", collections: ["analytics"] },
  ];

  const chainedServer = {
    name: "demo",
    displayName: "Demo Add-On",
    modeRegistry: demoModes,
    collections: [notificationCollection, analyticsCollection],
    allModeNames: ["alerts", "reporting"] as readonly string[],
    allSliceNames: ["read", "list"] as readonly string[],
  };

  it("registers proxied tools from a chained server", async () => {
    const server = createMockServer();
    const count = await registerChainedTools({
      server: server as any,
      env: createMockEnv(),
      props: createMockProps(),
      chainedServer,
      fetchUser: false,
    });

    expect(count).toBe(2);
    expect(server.registerTool).toHaveBeenCalledTimes(2);
    expect(registeredTools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["demo--get-notification", "demo--get-analytics-summary"]),
    );
  });

  it("filters by consent mode selections", async () => {
    const server = createMockServer();
    const consent: ConsentChoices = {
      chainedModeSelections: { demo: ["alerts"] },
    };

    const count = await registerChainedTools({
      server: server as any,
      env: createMockEnv(),
      props: createMockProps({ consentChoices: consent }),
      chainedServer,
      fetchUser: false,
    });

    // Only notification collection is in "alerts" mode
    expect(count).toBe(1);
    expect(registeredTools[0].name).toBe("demo--get-notification");
  });

  it("returns 0 when no chained modes selected", async () => {
    const server = createMockServer();
    const consent: ConsentChoices = {
      selectedModes: ["content"],
      // No chainedModeSelections for "demo" → sentinel __none__
    };

    const count = await registerChainedTools({
      server: server as any,
      env: createMockEnv(),
      props: createMockProps({ consentChoices: consent }),
      chainedServer,
      fetchUser: false,
    });

    expect(count).toBe(0);
    expect(server.registerTool).not.toHaveBeenCalled();
  });

  it("returns 0 on error without crashing", async () => {
    const server = createMockServer();
    // Pass a broken chainedServer with collections that will throw
    const brokenServer = {
      ...chainedServer,
      collections: [{
        metadata: { name: "broken", displayName: "Broken", description: "Broken" },
        tools: () => { throw new Error("Kaboom"); },
      }] as any,
    };

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const count = await registerChainedTools({
      server: server as any,
      env: createMockEnv(),
      props: createMockProps(),
      chainedServer: brokenServer,
      fetchUser: false,
    });

    expect(count).toBe(0);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("skips user fetch when fetchUser is false", async () => {
    const { createFetchClientFromKV } = await import("../../http/umbraco-fetch-client.js");
    const server = createMockServer();

    await registerChainedTools({
      server: server as any,
      env: createMockEnv(),
      props: createMockProps(),
      chainedServer,
      fetchUser: false,
    });

    expect(createFetchClientFromKV).not.toHaveBeenCalled();
  });

  it("fetches user by default", async () => {
    const { createFetchClientFromKV } = await import("../../http/umbraco-fetch-client.js");
    const server = createMockServer();

    await registerChainedTools({
      server: server as any,
      env: createMockEnv(),
      props: createMockProps(),
      chainedServer,
    });

    expect(createFetchClientFromKV).toHaveBeenCalledWith(
      expect.anything(),
      "test-token-key",
    );
  });

  it("passes clientFactory to in-process server registration", async () => {
    const server = createMockServer();
    const mockClientFactory = jest.fn(() => ({ someClient: true }));

    const count = await registerChainedTools({
      server: server as any,
      env: createMockEnv(),
      props: createMockProps(),
      chainedServer: { ...chainedServer, clientFactory: mockClientFactory },
      fetchUser: false,
    });

    // Tools should still be registered (clientFactory is passed through, not called here)
    expect(count).toBe(2);
  });
});
