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

import { test, expect, type Page } from "@playwright/test";
import { startWorker, stopWorker } from "./helpers/worker-setup.js";
import { startInspector, stopInspector } from "./helpers/inspector-setup.js";

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
// Shared helpers
// ============================================================================

/**
 * Connect the MCP Inspector to the Worker's MCP endpoint.
 * Sets transport to Streamable HTTP, enters the URL, selects Direct
 * connection, and clicks Connect. Returns the popup page (or the
 * current page) that will navigate through the OAuth flow.
 */
async function connectInspector(
  page: Page,
  workerUrl: string,
  inspectorUrl: string,
): Promise<Page> {
  await page.goto(inspectorUrl);
  await page.waitForLoadState("networkidle");

  // Select Streamable HTTP transport
  const transportCombo = page.getByRole("combobox", { name: "Transport Type" });
  await transportCombo.click();
  await page.getByRole("option", { name: "Streamable HTTP" }).click();

  // Enter the Worker's MCP endpoint URL
  const urlInput = page.getByRole("textbox", { name: "URL" });
  await urlInput.waitFor({ timeout: 5000 });
  await urlInput.clear();
  await urlInput.fill(workerUrl);

  // Select Direct connection (browser handles OAuth redirect)
  const connectionTypeCombo = page.getByRole("combobox", { name: "Connection Type" });
  await connectionTypeCombo.click();
  await page.getByRole("option", { name: "Direct" }).click();

  // Click Connect — Inspector may open a popup or navigate the current page
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

/**
 * Handle the OAuth flow on the consent/login page.
 *
 * @param oauthPage - The page showing consent screen or Umbraco login
 * @param consentOptions - Optional consent screen interactions
 */
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
  // Consent screen — approve (with optional checkbox modifications)
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
 */
async function getToolNames(page: Page): Promise<string[]> {
  // Wait for connected state (OAuth flow already completed in handleOAuthFlow)
  await expect(page.getByText("Connected")).toBeVisible({ timeout: 15000 });

  // Click the Tools tab
  const toolsTab = page.getByRole("tab", { name: /Tools/i });
  await toolsTab.waitFor({ timeout: 10000 });
  await toolsTab.click();

  // Click List Tools
  const listToolsButton = page.getByRole("button", { name: /List Tools/i });
  await listToolsButton.waitFor({ timeout: 10000 });
  await listToolsButton.click();

  // Wait for at least one known tool to appear
  await expect(
    page.locator(ALL_TOOLS.map((t) => `:text-is("${t}")`).join(", ")).first(),
  ).toBeVisible({ timeout: 10000 });

  // Check which of our known tools are visible on the page
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
async function callTool(page: Page, toolName: string): Promise<string> {
  await page.getByText(toolName).click();

  const runButton = page.getByRole("button", { name: /Run|Execute/i });
  await runButton.waitFor({ timeout: 5000 });
  await runButton.click();

  // Wait for result to appear (assemblyVersion is a marker for get-server-info)
  await expect(page.getByText("assemblyVersion").first()).toBeVisible({
    timeout: 10000,
  });

  // Return all visible text in the result area
  return (await page.locator("body").textContent()) ?? "";
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
    let inspectorUrl: string;

    test.beforeAll(async () => {
      workerUrl = await startWorker();
      inspectorUrl = await startInspector();
    });

    test.afterAll(async () => {
      await stopInspector();
      await stopWorker();
    });

    test("connect, list all tools, call get-server-info", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage);

      // Verify all 10 tools present
      const tools = await getToolNames(page);
      for (const tool of ALL_TOOLS) {
        expect(tools).toContain(tool);
      }

      // Call get-server-info to prove the full auth chain works
      const result = await callTool(page, "get-server-info");
      expect(result).toContain("assemblyVersion");
    });

  });

  // ============================================================================
  // Tests: with tool selection
  // ============================================================================

  test.describe("with tool selection", () => {
    let workerUrl: string;
    let inspectorUrl: string;

    test.beforeAll(async () => {
      workerUrl = await startWorker({
        ENABLE_CONSENT_TOOL_SELECTION: "true",
      });
      inspectorUrl = await startInspector();
    });

    test.afterAll(async () => {
      await stopInspector();
      await stopWorker();
    });

    test("default consent (all selected) lists all tools", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage);

      const tools = await getToolNames(page);
      for (const tool of ALL_TOOLS) {
        expect(tools).toContain(tool);
      }
    });

    test("check only example mode limits to example collection only", async ({
      page,
    }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage, {
        checkModes: ["example"],
      });

      const tools = await getToolNames(page);

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

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);

      await handleOAuthFlow(page, oauthPage, {
        uncheckSlices: allSlicesExcept("read"),
      });

      const tools = await getToolNames(page);

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

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage, { checkReadOnly: true });

      const tools = await getToolNames(page);

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

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage, {
        checkModes: ["example-2"],
      });

      const tools = await getToolNames(page);

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

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage, {
        uncheckSlices: allSlicesExcept("create"),
      });

      const tools = await getToolNames(page);

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

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage, {
        checkModes: ["example"],
        uncheckSlices: allSlicesExcept("read"),
      });

      const tools = await getToolNames(page);

      // example mode + read slice → only get-example
      expect(tools).toContain("get-example");
      expect(tools).toHaveLength(1);
    });

    test("deny consent prevents connection", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);

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

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage, {
        checkModes: ["example"],
        checkReadOnly: true,
      });

      const tools = await getToolNames(page);

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

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage, {
        uncheckSlices: allSlicesExcept("read", "list"),
      });

      const tools = await getToolNames(page);

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

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage, {
        uncheckSlices: allSlicesExcept("read"),
      });

      const tools = await getToolNames(page);
      expect(tools).toContain("get-server-info");

      // Execute get-server-info to prove the auth chain works with filtered token
      const result = await callTool(page, "get-server-info");
      expect(result).toContain("assemblyVersion");
    });

    test("readOnly + mode + slice triple filter", async ({ page }) => {
      test.setTimeout(120000);

      const oauthPage = await connectInspector(page, workerUrl, inspectorUrl);
      await handleOAuthFlow(page, oauthPage, {
        checkModes: ["example"],
        uncheckSlices: allSlicesExcept("list"),
        checkReadOnly: true,
      });

      const tools = await getToolNames(page);

      // example mode + list slice + readOnly → list-examples only
      expect(tools).toContain("list-examples");
      expect(tools).toHaveLength(1);
    });
  });
});
