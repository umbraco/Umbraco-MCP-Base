/**
 * MCP Inspector E2E tests.
 *
 * Drives the MCP Inspector UI through the full OAuth flow,
 * verifies the tools list, and executes a tool call.
 *
 * Customize the tool lists, credentials, and ports below to match
 * your project. Add more tests for consent screen filtering
 * (modes, slices, readOnly) as needed — see the SDK's test suites
 * in tests/hosted-mcp-e2e/ for comprehensive examples.
 *
 * Prerequisites:
 * - Umbraco running (update UMBRACO_BASE_URL in worker-setup.ts)
 * - Worker and Inspector started automatically in beforeAll
 *
 * Run: npm run test:e2e
 */

import { test, expect } from "@playwright/test";
import { startWorker, stopWorker } from "./helpers/worker-setup.js";
import {
  startInspector, connectInspector, handleOAuthFlow,
  getToolNames, callTool, type InspectorHandle,
} from "@umbraco-cms/mcp-hosted/testing";

// ============================================================================
// Tool list — update with your project's tool names
// ============================================================================

const ALL_TOOLS = [
  "get-example",
  "list-examples",
  "search-examples",
  "create-example",
  "update-example",
  "delete-example",
  "get-widget",
  "list-widgets",
  "create-widget",
  "get-server-info",
];

// ============================================================================
// Tests
// ============================================================================

test.describe("MCP Inspector E2E", () => {
  let workerUrl: string;
  let inspector: InspectorHandle;

  test.beforeAll(async () => {
    workerUrl = await startWorker();
    inspector = await startInspector({ client: 6284, proxy: 6287 });
  });

  test.afterAll(async () => {
    await inspector.stop();
    await stopWorker();
  });

  test.afterEach(async ({ page }) => {
    const disconnectButton = page.getByRole("button", { name: "Disconnect" });
    if (await disconnectButton.isVisible().catch(() => false)) {
      await disconnectButton.click();
    }
  });

  test("connect and list all tools", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage);
    // Pass custom credentials if your Umbraco uses different login:
    // await handleOAuthFlow(page, oauthPage, undefined, {
    //   email: "admin@example.com",
    //   password: "YourPassword",
    // });

    const tools = await getToolNames(page, ALL_TOOLS);
    for (const tool of ALL_TOOLS) {
      expect(tools).toContain(tool);
    }
  });

  test("execute a tool call", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage);

    const tools = await getToolNames(page, ALL_TOOLS);
    expect(tools).toContain("get-server-info");

    // Call a tool and verify the response contains expected text
    const result = await callTool(page, "get-server-info", "assemblyVersion");
    expect(result).toContain("assemblyVersion");
  });

  test("consent screen mode filtering", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example"],
    });

    const tools = await getToolNames(page, ALL_TOOLS);

    // Only example collection tools should be present
    expect(tools).toContain("get-example");
    expect(tools).not.toContain("get-widget");
    expect(tools).not.toContain("get-server-info");
  });

  test("readOnly toggle excludes write tools", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, { checkReadOnly: true });

    const tools = await getToolNames(page, ALL_TOOLS);

    // Write tools should be excluded
    expect(tools).not.toContain("create-example");
    expect(tools).not.toContain("delete-example");

    // Read-only tools should remain
    expect(tools).toContain("get-example");
    expect(tools).toContain("get-server-info");
  });
});
