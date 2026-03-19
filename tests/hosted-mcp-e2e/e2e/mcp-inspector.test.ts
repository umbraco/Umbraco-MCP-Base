/**
 * MCP Inspector E2E tests.
 *
 * Drives the MCP Inspector UI through the full OAuth flow,
 * verifies the tools list, executes a tool call, and tests
 * tool filtering via consent screen selections.
 *
 * Prerequisites:
 * - Test Umbraco running at https://localhost:5201 / http://localhost:5200
 * - Worker and Inspector started automatically in beforeAll
 */

import { test, expect } from "@playwright/test";
import { startWorker, stopWorker } from "./helpers/worker-setup.js";
import {
  startInspector, connectInspector, handleOAuthFlow,
  getToolNames, callTool, type InspectorHandle,
} from "@umbraco-cms/mcp-hosted/testing";

// ============================================================================
// All 10 tools across 3 collections
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

const ALL_SLICE_NAMES = [
  "read",
  "list",
  "create",
  "update",
  "delete",
  "search",
];

/** Return all slice names except the ones to keep. */
function allSlicesExcept(...keep: string[]): string[] {
  return ALL_SLICE_NAMES.filter((s) => !keep.includes(s));
}

// ============================================================================
// Tests: without tool selection
// ============================================================================

test.describe("MCP Inspector E2E", () => {
  // Disconnect the Inspector after each test so the Worker
  // doesn't log 401 errors during teardown.
  test.afterEach(async ({ page }) => {
    const disconnectButton = page.getByRole("button", { name: "Disconnect" });
    if (await disconnectButton.isVisible().catch(() => false)) {
      await disconnectButton.click();
    }
  });

  test.describe("without tool selection", () => {
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

    test("connect, list all tools, call get-server-info", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage);

      // Verify all 10 tools present
      const tools = await getToolNames(page, ALL_TOOLS);
      for (const tool of ALL_TOOLS) {
        expect(tools).toContain(tool);
      }

      // Call get-server-info to prove the full auth chain works
      const result = await callTool(page, "get-server-info", "assemblyVersion");
      expect(result).toContain("assemblyVersion");
    });

  });

  // ============================================================================
  // Tests: with tool selection
  // ============================================================================

  test.describe("with tool selection", () => {
    let workerUrl: string;
    let inspector: InspectorHandle;

    test.beforeAll(async () => {
      workerUrl = await startWorker({
        ENABLE_CONSENT_TOOL_SELECTION: "true",
      });
      inspector = await startInspector({ client: 6284, proxy: 6287 });
    });

    test.afterAll(async () => {
      await inspector.stop();
      await stopWorker();
    });

    test("default consent (all selected) lists all tools", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage);

      const tools = await getToolNames(page, ALL_TOOLS);
      for (const tool of ALL_TOOLS) {
        expect(tools).toContain(tool);
      }
    });

    test("check only example mode limits to example collection only", async ({
      page,
    }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage, {
        checkModes: ["example"],
      });

      const tools = await getToolNames(page, ALL_TOOLS);

      // Only example collection tools should be present
      const expectedTools = [
        "get-example",
        "list-examples",
        "search-examples",
        "create-example",
        "update-example",
        "delete-example",
      ];
      for (const tool of expectedTools) {
        expect(tools).toContain(tool);
      }

      // These should NOT be present (modes are set, so umbraco-server is excluded too)
      const excludedTools = [
        "get-widget",
        "list-widgets",
        "create-widget",
        "get-server-info",
      ];
      for (const tool of excludedTools) {
        expect(tools).not.toContain(tool);
      }
    });

    test("select only read slice limits to read tools", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);

      await handleOAuthFlow(page, oauthPage, {
        uncheckSlices: allSlicesExcept("read"),
      });

      const tools = await getToolNames(page, ALL_TOOLS);

      // Only read-slice tools should be present
      const expectedTools = ["get-example", "get-widget", "get-server-info"];
      for (const tool of expectedTools) {
        expect(tools).toContain(tool);
      }

      // Non-read tools should not be present
      const excludedTools = [
        "list-examples",
        "search-examples",
        "create-example",
        "update-example",
        "delete-example",
        "list-widgets",
        "create-widget",
      ];
      for (const tool of excludedTools) {
        expect(tools).not.toContain(tool);
      }
    });

    test("readOnly toggle excludes write tools", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage, { checkReadOnly: true });

      const tools = await getToolNames(page, ALL_TOOLS);

      // Write tools should NOT be present
      const excludedTools = [
        "create-example",
        "update-example",
        "delete-example",
        "create-widget",
      ];
      for (const tool of excludedTools) {
        expect(tools).not.toContain(tool);
      }

      // Read-only tools should be present
      const expectedTools = [
        "get-example",
        "list-examples",
        "search-examples",
        "get-widget",
        "list-widgets",
        "get-server-info",
      ];
      for (const tool of expectedTools) {
        expect(tools).toContain(tool);
      }
    });

    test("select only example-2 mode", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage, {
        checkModes: ["example-2"],
      });

      const tools = await getToolNames(page, ALL_TOOLS);

      // Only example-2 collection tools
      const expectedTools = ["get-widget", "list-widgets", "create-widget"];
      for (const tool of expectedTools) {
        expect(tools).toContain(tool);
      }

      // Everything else excluded
      const excludedTools = [
        "get-example",
        "list-examples",
        "search-examples",
        "create-example",
        "update-example",
        "delete-example",
        "get-server-info",
      ];
      for (const tool of excludedTools) {
        expect(tools).not.toContain(tool);
      }
    });

    test("select only create slice", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage, {
        uncheckSlices: allSlicesExcept("create"),
      });

      const tools = await getToolNames(page, ALL_TOOLS);

      // Only create-slice tools
      const expectedTools = ["create-example", "create-widget"];
      for (const tool of expectedTools) {
        expect(tools).toContain(tool);
      }

      // Non-create tools excluded
      const excludedTools = [
        "get-example",
        "list-examples",
        "search-examples",
        "update-example",
        "delete-example",
        "get-widget",
        "list-widgets",
        "get-server-info",
      ];
      for (const tool of excludedTools) {
        expect(tools).not.toContain(tool);
      }
    });

    test("mode + slice cross-filter", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage, {
        checkModes: ["example"],
        uncheckSlices: allSlicesExcept("read"),
      });

      const tools = await getToolNames(page, ALL_TOOLS);

      // example mode + read slice → only get-example
      expect(tools).toContain("get-example");
      expect(tools).toHaveLength(1);
    });

    test("deny consent prevents connection", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);

      // Click deny instead of approve
      const denyButton = oauthPage.locator('button[value="deny"]');
      await denyButton.waitFor({ timeout: 5000 });
      await denyButton.click();

      // If a popup was opened, wait for it to close after the error redirect
      if (oauthPage !== page) {
        await oauthPage.waitForEvent("close", { timeout: 15000 }).catch(() => {});
      }

      // Inspector should show the access_denied error notification
      await expect(page.getByText("access_denied").first()).toBeVisible({
        timeout: 15000,
      });

      // Status should remain "Disconnected" (not "Connected")
      await expect(page.getByText("Disconnected")).toBeVisible();
    });

    test("readOnly + mode filters compose", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage, {
        checkModes: ["example"],
        checkReadOnly: true,
      });

      const tools = await getToolNames(page, ALL_TOOLS);

      // example mode + readOnly → read-only tools from example collection
      const expectedTools = ["get-example", "list-examples", "search-examples"];
      for (const tool of expectedTools) {
        expect(tools).toContain(tool);
      }

      // Write tools excluded by readOnly, widget/server tools excluded by mode
      const excludedTools = [
        "create-example",
        "update-example",
        "delete-example",
        "get-widget",
        "list-widgets",
        "create-widget",
        "get-server-info",
      ];
      for (const tool of excludedTools) {
        expect(tools).not.toContain(tool);
      }
    });

    test("multiple slices (read + list) combine as union", async ({
      page,
    }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage, {
        uncheckSlices: allSlicesExcept("read", "list"),
      });

      const tools = await getToolNames(page, ALL_TOOLS);

      // read + list slices → get-* and list-* tools
      const expectedTools = [
        "get-example",
        "get-widget",
        "get-server-info",
        "list-examples",
        "list-widgets",
      ];
      for (const tool of expectedTools) {
        expect(tools).toContain(tool);
      }

      // Non-read/list tools excluded
      const excludedTools = [
        "search-examples",
        "create-example",
        "update-example",
        "delete-example",
        "create-widget",
      ];
      for (const tool of excludedTools) {
        expect(tools).not.toContain(tool);
      }
    });

    test("tool call works after filtering", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage, {
        uncheckSlices: allSlicesExcept("read"),
      });

      const tools = await getToolNames(page, ALL_TOOLS);
      expect(tools).toContain("get-server-info");

      // Execute get-server-info to prove the auth chain works with filtered token
      const result = await callTool(page, "get-server-info", "assemblyVersion");
      expect(result).toContain("assemblyVersion");
    });

    test("readOnly + mode + slice triple filter", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspector.url);
      await handleOAuthFlow(page, oauthPage, {
        checkModes: ["example"],
        uncheckSlices: allSlicesExcept("list"),
        checkReadOnly: true,
      });

      const tools = await getToolNames(page, ALL_TOOLS);

      // example mode + list slice + readOnly → list-examples only
      expect(tools).toContain("list-examples");
      expect(tools).toHaveLength(1);
    });
  });
});
