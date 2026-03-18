/**
 * In-process MCP chaining with real Umbraco API calls.
 *
 * Proves that chained tools can make real fetch-based API calls to Umbraco
 * when running in-process — the scenario that motivated the Axios→fetch migration.
 *
 * Unlike other integration tests that use wrangler/miniflare, this test runs
 * directly in Node.js to exercise the full chain:
 *   proxy handler → McpClientManager → InProcessConnection → tool handler
 *   → UmbracoManagementClient (fetch) → real Umbraco API
 */

import {
  initializeUmbracoFetch,
  createMcpClientManager,
  discoverProxiedTools,
  createProxyHandler,
} from "@umbraco-cms/mcp-server-sdk";

import {
  collections,
  allModes,
  allModeNames,
  allSliceNames,
} from "../demo-chained-mcp/index.js";

// Skip if no Umbraco instance available
const UMBRACO_BASE_URL = process.env.UMBRACO_BASE_URL || "https://localhost:44391";
const UMBRACO_CLIENT_ID = process.env.UMBRACO_CLIENT_ID || "umbraco-back-office-mcp";
const UMBRACO_CLIENT_SECRET = process.env.UMBRACO_CLIENT_SECRET || "1234567890";

describe("in-process MCP chaining with real Umbraco API", () => {
  let proxiedTools: Awaited<ReturnType<typeof discoverProxiedTools>>;
  let manager: ReturnType<typeof createMcpClientManager>;

  beforeAll(async () => {
    // Initialize fetch client
    initializeUmbracoFetch({
      baseUrl: UMBRACO_BASE_URL,
      clientId: UMBRACO_CLIENT_ID,
      clientSecret: UMBRACO_CLIENT_SECRET,
    });

    // Set up in-process chaining
    manager = createMcpClientManager({});

    manager.registerServer({
      transport: "in-process",
      name: "demo",
      collections,
      modeRegistry: allModes,
      allModeNames,
      allSliceNames,
    });

    proxiedTools = await discoverProxiedTools(manager);
  });

  it("discovers the get-server-version tool", () => {
    const tool = proxiedTools.find(
      (t) => t.originalTool.name === "get-server-version",
    );
    expect(tool).toBeDefined();
    expect(tool!.prefixedName).toBe("demo--get-server-version");
  });

  it("calls get-server-version through the proxy chain and gets real data", async () => {
    const handler = createProxyHandler(manager, "demo", "get-server-version");
    const result = await handler({});

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);

    const text = result.content[0].text!;
    const data = JSON.parse(text);

    // Real Umbraco returns a version string like "17.2.2+11a412c"
    expect(data.version).toBeDefined();
    expect(data.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("can also call mock tools in the same chained server", async () => {
    const handler = createProxyHandler(manager, "demo", "list-notifications");
    const result = await handler({});

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);

    const data = JSON.parse(result.content[0].text!);
    expect(data.items).toBeDefined();
    expect(data.items.length).toBeGreaterThan(0);
  });
});
