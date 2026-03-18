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

import { test, expect, type Page } from "@playwright/test";
import { startWorker, stopWorker } from "./helpers/worker-setup.js";
import { startInspector, stopInspector } from "./helpers/inspector-setup.js";

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

/** Chained collection checkboxes (value → display name) */
const CHAINED_COLLECTIONS = {
  "demo:notification": "notification",
  "demo:analytics": "analytics",
  "demo:umbraco": "umbraco",
};

// ============================================================================
// Shared helpers
// ============================================================================

async function connectInspector(
  page: Page,
  workerUrl: string,
  inspectorUrl: string,
): Promise<Page> {
  await page.goto(inspectorUrl);
  await page.waitForLoadState("networkidle");

  const transportCombo = page.getByRole("combobox", { name: "Transport Type" });
  await transportCombo.click();
  await page.getByRole("option", { name: "Streamable HTTP" }).click();

  const urlInput = page.getByRole("textbox", { name: "URL" });
  await urlInput.waitFor({ timeout: 5000 });
  await urlInput.clear();
  await urlInput.fill(workerUrl);

  const connectionTypeCombo = page.getByRole("combobox", { name: "Connection Type" });
  await connectionTypeCombo.click();
  await page.getByRole("option", { name: "Direct" }).click();

  const isAuthorizeUrl = (url: URL) =>
    url.pathname === "/authorize" || url.pathname.includes("authorize") || url.pathname.includes("/umbraco");

  const popupPromise = page.context().waitForEvent("page").catch(() => null);
  const navigationPromise = page.waitForURL(isAuthorizeUrl).then(() => null as Page | null);

  await page.getByRole("button", { name: "Connect" }).click();

  const popup = await Promise.race([popupPromise, navigationPromise]);
  const oauthPage = popup ?? page;

  if (popup) {
    await popup.waitForURL(isAuthorizeUrl, { timeout: 15000 });
  }

  return oauthPage;
}

async function handleOAuthFlow(
  _mainPage: Page,
  oauthPage: Page,
  consentOptions?: {
    checkModes?: string[];
    uncheckModes?: string[];
    uncheckCollections?: string[];
    uncheckSlices?: string[];
    checkReadOnly?: boolean;
  },
): Promise<void> {
  const approveButton = oauthPage.locator('button[value="approve"]');
  await approveButton.waitFor();

  if (consentOptions) {
    if (consentOptions.checkModes) {
      for (const mode of consentOptions.checkModes) {
        const checkbox = oauthPage.locator(`.mode-checkbox[value="${mode}"]`);
        if (!(await checkbox.isChecked())) await checkbox.check();
      }
    }

    if (consentOptions.uncheckModes) {
      for (const mode of consentOptions.uncheckModes) {
        const checkbox = oauthPage.locator(`.mode-checkbox[value="${mode}"]`);
        if (await checkbox.isChecked()) await checkbox.uncheck();
      }
    }

    if (consentOptions.uncheckCollections) {
      for (const name of consentOptions.uncheckCollections) {
        const checkboxes = oauthPage.locator(`.collection-checkbox[value="${name}"]`);
        const count = await checkboxes.count();
        for (let i = 0; i < count; i++) {
          const cb = checkboxes.nth(i);
          if (await cb.isEnabled() && await cb.isChecked()) await cb.uncheck();
        }
      }
    }

    if (consentOptions.uncheckSlices) {
      for (const slice of consentOptions.uncheckSlices) {
        const checkbox = oauthPage.locator(`.slice-checkbox[value="${slice}"]`);
        if (await checkbox.isChecked()) await checkbox.uncheck();
      }
    }

    if (consentOptions.checkReadOnly) {
      const readOnlyCheckbox = oauthPage.locator('input[name="readOnly"]');
      if (!(await readOnlyCheckbox.isChecked())) await readOnlyCheckbox.check();
    }
  }

  await approveButton.click();

  // Umbraco login page
  await oauthPage.waitForURL(
    (url) => url.hostname === "localhost" && url.pathname.includes("/umbraco"),
    { timeout: 15000 },
  );

  const emailInput = oauthPage.getByRole("textbox").first();
  await emailInput.waitFor({ timeout: 10000 });
  await emailInput.fill("admin@admin.com");
  await oauthPage.getByRole("textbox").nth(1).fill("1234567890");
  await oauthPage.getByRole("button", { name: "Login" }).click();
}

/**
 * Navigate to the Tools tab, click List Tools, and extract tool names.
 * Checks for both main and chained tools.
 */
async function getToolNames(page: Page): Promise<string[]> {
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 15000 });

  const toolsTab = page.getByRole("tab", { name: /Tools/i });
  await toolsTab.waitFor({ timeout: 10000 });
  await toolsTab.click();

  const listToolsButton = page.getByRole("button", { name: /List Tools/i });
  await listToolsButton.waitFor({ timeout: 10000 });
  await listToolsButton.click();

  // Wait for at least one known tool to appear
  await expect(
    page.locator(ALL_TOOLS.map((t) => `:text-is("${t}")`).join(", ")).first(),
  ).toBeVisible({ timeout: 10000 });

  const visibleTools: string[] = [];
  for (const tool of ALL_TOOLS) {
    const isVisible = await page
      .getByText(tool, { exact: true })
      .first()
      .isVisible()
      .catch(() => false);
    if (isVisible) visibleTools.push(tool);
  }
  return visibleTools;
}

/**
 * Click a tool in the list, run it, and return the result text.
 */
async function callTool(page: Page, toolName: string, resultMarker: string): Promise<string> {
  await page.getByText(toolName).click();

  const runButton = page.getByRole("button", { name: /Run|Execute/i });
  await runButton.waitFor({ timeout: 5000 });
  await runButton.click();

  await expect(page.getByText(resultMarker).first()).toBeVisible({
    timeout: 10000,
  });

  return (await page.locator("body").textContent()) ?? "";
}

// ============================================================================
// Tests
// ============================================================================

test.describe("Chained MCP Inspector E2E", () => {
  let workerUrl: string;
  let inspectorUrl: string;

  test.beforeAll(async () => {
    workerUrl = await startWorker();
    inspectorUrl = await startInspector();
  });

  test.afterAll(async () => {
    await stopInspector();
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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example", "example-2", "umbraco-server", "demo:alerts", "demo:reporting"],
    });

    const tools = await getToolNames(page);

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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["demo:alerts"],
    });

    const tools = await getToolNames(page);

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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example", "demo:reporting"],
    });

    const tools = await getToolNames(page);

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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example", "example-2", "umbraco-server", "demo:alerts", "demo:reporting"],
      checkReadOnly: true,
    });

    const tools = await getToolNames(page);

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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example", "example-2", "umbraco-server", "demo:alerts", "demo:reporting"],
      uncheckSlices: allSlicesExcept("read"),
    });

    const tools = await getToolNames(page);

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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["demo:alerts"],
    });

    const tools = await getToolNames(page);
    expect(tools).toContain("demo--list-notifications");

    const result = await callTool(page, "demo--list-notifications", "Welcome");
    expect(result).toContain("Welcome");
    expect(result).toContain("Update Available");
  });

  test("call demo--get-server-version returns real Umbraco version via fetch", async ({ page }) => {
    test.setTimeout(120000);

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["demo:reporting"],
    });

    const tools = await getToolNames(page);
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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["demo:alerts", "example"],
      uncheckCollections: ["demo:notification"],
    });

    const tools = await getToolNames(page);

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

    const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
    await handleOAuthFlow(page, oauthPage, {
      checkModes: ["example"],
    });

    const tools = await getToolNames(page);

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
