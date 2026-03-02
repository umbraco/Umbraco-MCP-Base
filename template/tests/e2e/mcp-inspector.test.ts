/**
 * MCP Inspector E2E test.
 *
 * Drives the MCP Inspector UI through the full OAuth flow,
 * then verifies the tools list and executes a tool call.
 *
 * Prerequisites:
 * - Test Umbraco running at https://localhost:5201 / http://localhost:5200
 * - Worker started automatically in beforeAll
 */

import { test, expect } from "@playwright/test";
import { startWorker, stopWorker } from "./helpers/worker-setup.js";
import { startInspector, stopInspector } from "./helpers/inspector-setup.js";

test.describe("MCP Inspector", () => {
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

  test("connect via OAuth, list tools, and call a tool", async ({ page }) => {
    test.setTimeout(120000);

    // 1. Navigate to the MCP Inspector
    await page.goto(inspectorUrl);
    await page.waitForLoadState("networkidle");

    // 2. Select "Streamable HTTP" transport type
    const transportCombo = page.getByRole("combobox", {
      name: "Transport Type",
    });
    await transportCombo.click();
    await page.getByRole("option", { name: "Streamable HTTP" }).click();

    // 3. Enter the Worker's MCP endpoint URL
    const urlInput = page.getByRole("textbox", { name: "URL" });
    await urlInput.waitFor({ timeout: 5000 });
    await urlInput.clear();
    await urlInput.fill(`${workerUrl}/mcp`);

    // 4. Change connection type to "Direct" so the browser handles
    //    the OAuth redirect flow directly (not via the Inspector proxy).
    const connectionTypeCombo = page.getByRole("combobox", {
      name: "Connection Type",
    });
    await connectionTypeCombo.click();
    await page.getByRole("option", { name: "Direct" }).click();

    // 5. Click Connect — this triggers the OAuth flow.
    //    The Inspector may open a popup for the OAuth redirect, or the page
    //    may navigate. Set up listeners for both scenarios.
    const popupPromise = page
      .context()
      .waitForEvent("page", { timeout: 15000 })
      .catch(() => null);

    const connectButton = page.getByRole("button", { name: "Connect" });
    await connectButton.click();

    // 6. Handle the OAuth flow — could be a popup or a redirect on the current page
    const oauthPage = (await popupPromise) ?? page;

    // Wait for either consent screen or Umbraco login
    await oauthPage.waitForURL(
      (url) => {
        const isConsent =
          url.pathname === "/authorize" || url.pathname.includes("authorize");
        const isUmbraco = url.pathname.includes("/umbraco");
        return isConsent || isUmbraco;
      },
      { timeout: 15000 },
    );

    // 7. If we're on the consent screen, approve it
    const approveButton = oauthPage.locator('button[value="approve"]');
    if (await approveButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await approveButton.click();
    }

    // 8. Umbraco login page
    await oauthPage.waitForURL(
      (url) =>
        url.hostname === "localhost" && url.pathname.includes("/umbraco"),
      { timeout: 15000 },
    );

    const emailInput = oauthPage.getByRole("textbox").first();
    const passwordInput = oauthPage.getByRole("textbox").nth(1);
    await emailInput.waitFor({ timeout: 15000 });
    await emailInput.fill("admin@admin.com");
    await passwordInput.fill("1234567890");
    await oauthPage.getByRole("button", { name: "Login" }).click();

    // 9. After login, the OAuth flow completes and we return to the Inspector.
    //    Wait for the Inspector to show connected state.
    await expect(page.getByText("Connected")).toBeVisible({ timeout: 30000 });

    // 10. Click the Tools tab
    const toolsTab = page.getByRole("tab", { name: /Tools/i });
    await toolsTab.waitFor({ timeout: 10000 });
    await toolsTab.click();

    // 11. Click "List Tools" to fetch the tools list
    const listToolsButton = page.getByRole("button", {
      name: /List Tools/i,
    });
    await listToolsButton.waitFor({ timeout: 10000 });
    await listToolsButton.click();

    // 12. Verify tools are listed — including the real Umbraco tool
    await expect(page.getByText("get-server-info")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("get-example")).toBeVisible();

    // 13. Click on get-server-info — this calls the real Umbraco Management API
    //     to prove the full auth chain works: OAuth → token → API call → response
    await page.getByText("get-server-info").click();

    // 14. Execute the tool
    const runButton = page.getByRole("button", { name: /Run|Execute/i });
    await runButton.waitFor({ timeout: 5000 });
    await runButton.click();

    // 15. The result should contain real Umbraco version info,
    //     proving authenticated API access works end-to-end.
    //     Look for "assemblyVersion" which only appears in the API response,
    //     not in the tool description.
    await expect(page.getByText("assemblyVersion").first()).toBeVisible({ timeout: 10000 });
  });
});
