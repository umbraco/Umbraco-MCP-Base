/**
 * MCP Inspector E2E tests for chained MCP.
 *
 * Drives the MCP Inspector UI through the full OAuth flow with a Worker
 * that has both main collections (10 tools) and chained demo MCP (5 tools).
 * Verifies tool listing, consent screen chained mode filtering, read-only
 * toggle, slice filtering, and tool execution across servers.
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
// Tool lists
// ============================================================================

/** Main server tools (10 from template collections) */
const MAIN_TOOLS = [
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

/** Chained demo tools (6, proxied with demo-- prefix) */
const CHAINED_TOOLS = [
  "demo--get-notification",
  "demo--list-notifications",
  "demo--send-notification",
  "demo--get-analytics-summary",
  "demo--list-analytics-events",
  "demo--get-server-version",
];

/** All tools combined */
const ALL_TOOLS = [...MAIN_TOOLS, ...CHAINED_TOOLS];

/** Notification collection chained tools (alerts mode) */
const NOTIFICATION_TOOLS = [
  "demo--get-notification",
  "demo--list-notifications",
  "demo--send-notification",
];

/** Analytics collection chained tools (reporting mode) */
const ANALYTICS_TOOLS = [
  "demo--get-analytics-summary",
  "demo--list-analytics-events",
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
// Consent screen expectations
// ============================================================================

/** Main server mode checkboxes (value → display name) */
const MAIN_MODES = {
  example: "Example Tools",
  "example-2": "Example-2 Tools",
  "umbraco-server": "Umbraco Server",
};

/** Chained server mode checkboxes (value → display name) */
const CHAINED_MODES = {
  "demo:alerts": "Alerts & Notifications",
  "demo:reporting": "Reporting",
};

/** All mode checkboxes */
const ALL_MODES_MAP = { ...MAIN_MODES, ...CHAINED_MODES };

// ============================================================================
// Tests
// ============================================================================

test.describe("Chained MCP Inspector E2E", () => {
  let workerUrl: string;
  let inspector: InspectorHandle;

  test.beforeAll(async () => {
    workerUrl = await startWorker();
    inspector = await startInspector({ client: 6294, proxy: 6297 });
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

  test("list all tools — 16 total: 10 main + 6 chained", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example", "example-2", "umbraco-server", "demo:alerts", "demo:reporting"],
    });

    const tools = await getToolNames(page, ALL_TOOLS);

    // All 10 main tools
    for (const tool of MAIN_TOOLS) {
      expect(tools).toContain(tool);
    }
    // All 6 chained tools
    for (const tool of CHAINED_TOOLS) {
      expect(tools).toContain(tool);
    }
    expect(tools).toHaveLength(16);
  });

  test("select only demo:alerts — only 3 notification tools", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["demo:alerts"],
    });

    const tools = await getToolNames(page, ALL_TOOLS);

    // Only notification tools should be present (proxied, so unfiltered by main mode)
    for (const tool of NOTIFICATION_TOOLS) {
      expect(tools).toContain(tool);
    }

    // Analytics tools should not be present
    for (const tool of ANALYTICS_TOOLS) {
      expect(tools).not.toContain(tool);
    }

    // Main tools should not be present (no main modes checked)
    for (const tool of MAIN_TOOLS) {
      expect(tools).not.toContain(tool);
    }
  });

  test("select example + demo:reporting — 6 example + 3 reporting", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example", "demo:reporting"],
    });

    const tools = await getToolNames(page, ALL_TOOLS);

    // Example tools present
    const exampleTools = [
      "get-example", "list-examples", "search-examples",
      "create-example", "update-example", "delete-example",
    ];
    for (const tool of exampleTools) {
      expect(tools).toContain(tool);
    }

    // Analytics + umbraco tools present (both in reporting mode)
    for (const tool of ANALYTICS_TOOLS) {
      expect(tools).toContain(tool);
    }
    expect(tools).toContain("demo--get-server-version");

    // Widget, server-info, and notification tools NOT present
    const excluded = [
      "get-widget", "list-widgets", "create-widget", "get-server-info",
      ...NOTIFICATION_TOOLS,
    ];
    for (const tool of excluded) {
      expect(tools).not.toContain(tool);
    }

    expect(tools).toHaveLength(9);
  });

  test("readOnly toggle excludes demo--send-notification", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example", "example-2", "umbraco-server", "demo:alerts", "demo:reporting"],
      checkReadOnly: true,
    });

    const tools = await getToolNames(page, ALL_TOOLS);

    // Write tools excluded (main + chained)
    const excludedWriteTools = [
      "create-example", "update-example", "delete-example",
      "create-widget",
      "demo--send-notification",
    ];
    for (const tool of excludedWriteTools) {
      expect(tools).not.toContain(tool);
    }

    // Read-only tools present (main + chained)
    const expectedReadOnly = [
      "get-example", "list-examples", "search-examples",
      "get-widget", "list-widgets",
      "get-server-info",
      "demo--get-notification", "demo--list-notifications",
      "demo--get-analytics-summary", "demo--list-analytics-events",
      "demo--get-server-version",
    ];
    for (const tool of expectedReadOnly) {
      expect(tools).toContain(tool);
    }
  });

  test("read-only slice filter — only read tools from both servers", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example", "example-2", "umbraco-server", "demo:alerts", "demo:reporting"],
      uncheckSlices: allSlicesExcept("read"),
    });

    const tools = await getToolNames(page, ALL_TOOLS);

    // Only read-slice tools from both servers
    const expectedTools = [
      "get-example",
      "get-widget",
      "get-server-info",
      "demo--get-notification",
      "demo--get-analytics-summary",
      "demo--get-server-version",
    ];
    for (const tool of expectedTools) {
      expect(tools).toContain(tool);
    }

    // Non-read tools excluded
    const excludedTools = [
      "list-examples", "search-examples",
      "create-example", "update-example", "delete-example",
      "list-widgets", "create-widget",
      "demo--list-notifications", "demo--send-notification",
      "demo--list-analytics-events",
    ];
    for (const tool of excludedTools) {
      expect(tools).not.toContain(tool);
    }
  });

  test("call demo--list-notifications returns static mock data", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["demo:alerts"],
    });

    const tools = await getToolNames(page, ALL_TOOLS);
    expect(tools).toContain("demo--list-notifications");

    const result = await callTool(page, "demo--list-notifications", "Welcome");
    expect(result).toContain("Welcome");
    expect(result).toContain("Update Available");
  });

  test("call demo--get-server-version returns real Umbraco version via fetch", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["demo:reporting"],
    });

    const tools = await getToolNames(page, ALL_TOOLS);
    expect(tools).toContain("demo--get-server-version");

    // Call the tool — it hits the real Umbraco management API via the SDK fetch client
    const result = await callTool(page, "demo--get-server-version", "version");
    // Should contain a semver-like version string from the real Umbraco instance
    expect(result).toMatch(/\d+\.\d+\.\d+/);
  });

  // ==========================================================================
  // Consent screen content tests
  // ==========================================================================

  test("consent screen shows chained mode checkboxes alongside main modes", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    const approveButton = oauthPage.locator('button[value="approve"]');
    await approveButton.waitFor();

    // Verify all main mode checkboxes exist with correct display names
    for (const [value, displayName] of Object.entries(MAIN_MODES)) {
      const checkbox = oauthPage.locator(`.mode-checkbox[value="${value}"]`);
      await expect(checkbox).toBeVisible();
      // The first label in the mode-item is the mode label (second may be a collection label)
      const label = oauthPage.locator(`.mode-item[data-mode="${value}"] > label`);
      await expect(label).toContainText(displayName);
    }

    // Verify chained mode checkboxes exist with prefixed values and correct display names
    for (const [value, displayName] of Object.entries(CHAINED_MODES)) {
      const checkbox = oauthPage.locator(`.mode-checkbox[value="${value}"]`);
      await expect(checkbox).toBeVisible();
      const label = oauthPage.locator(`.mode-item[data-mode="${value}"] > label`);
      await expect(label).toContainText(displayName);
    }

    // All mode checkboxes should be unchecked by default
    for (const value of Object.keys(ALL_MODES_MAP)) {
      const checkbox = oauthPage.locator(`.mode-checkbox[value="${value}"]`);
      expect(await checkbox.isChecked()).toBe(false);
    }

    // Approve without changes to clean up
    await approveButton.click();
    await oauthPage.waitForURL(
      (url) => url.hostname === "localhost" && url.pathname.includes("/umbraco"),
      { timeout: 15000 },
    );
  });

  test("checking a chained mode reveals its collection checkboxes", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    const approveButton = oauthPage.locator('button[value="approve"]');
    await approveButton.waitFor();

    // Before checking demo:alerts, its collection checkboxes exist but are disabled
    const notificationCb = oauthPage.locator('.collection-checkbox[value="demo:notification"]');
    await expect(notificationCb).toBeAttached();
    expect(await notificationCb.isDisabled()).toBe(true);

    // Check demo:alerts mode
    const alertsCheckbox = oauthPage.locator('.mode-checkbox[value="demo:alerts"]');
    await alertsCheckbox.check();

    // Now the notification collection checkbox should be visible, enabled, and checked
    await expect(notificationCb).toBeVisible();
    expect(await notificationCb.isDisabled()).toBe(false);
    expect(await notificationCb.isChecked()).toBe(true);

    // Analytics collection under demo:reporting should still be disabled (hidden)
    const analyticsCb = oauthPage.locator('.collection-checkbox[value="demo:analytics"]');
    expect(await analyticsCb.isDisabled()).toBe(true);

    // Check demo:reporting too
    const reportingCheckbox = oauthPage.locator('.mode-checkbox[value="demo:reporting"]');
    await reportingCheckbox.check();
    await expect(analyticsCb).toBeVisible();
    expect(await analyticsCb.isDisabled()).toBe(false);
    expect(await analyticsCb.isChecked()).toBe(true);

    // Approve without changes to clean up
    await approveButton.click();
    await oauthPage.waitForURL(
      (url) => url.hostname === "localhost" && url.pathname.includes("/umbraco"),
      { timeout: 15000 },
    );
  });

  test("uncheck chained collection — demo:alerts with notification unchecked yields no tools", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["demo:alerts"],
      uncheckCollections: ["demo:notification"],
    });

    // With demo:alerts checked but its only collection unchecked and no main modes,
    // the server has zero tools. MCP Inspector shows "does not support any MCP capabilities".
    await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText("does not support any MCP capabilities"),
    ).toBeVisible({ timeout: 10000 });
  });

  test("select demo:alerts + example, uncheck demo:notification — only example tools", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["demo:alerts", "example"],
      uncheckCollections: ["demo:notification"],
    });

    const tools = await getToolNames(page, ALL_TOOLS);

    // Example tools should be present
    const exampleTools = [
      "get-example", "list-examples", "search-examples",
      "create-example", "update-example", "delete-example",
    ];
    for (const tool of exampleTools) {
      expect(tools).toContain(tool);
    }

    // No notification tools (collection unchecked)
    for (const tool of NOTIFICATION_TOOLS) {
      expect(tools).not.toContain(tool);
    }

    // No analytics tools (mode not checked)
    for (const tool of ANALYTICS_TOOLS) {
      expect(tools).not.toContain(tool);
    }

    expect(tools).toHaveLength(6);
  });

  test("no chained modes selected — only main tools appear", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspector.url);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example"],
    });

    const tools = await getToolNames(page, ALL_TOOLS);

    // Main example tools present
    const exampleTools = [
      "get-example", "list-examples", "search-examples",
      "create-example", "update-example", "delete-example",
    ];
    for (const tool of exampleTools) {
      expect(tools).toContain(tool);
    }

    // No chained tools (no chained modes were selected)
    for (const tool of CHAINED_TOOLS) {
      expect(tools).not.toContain(tool);
    }

    expect(tools).toHaveLength(6);
  });
});
