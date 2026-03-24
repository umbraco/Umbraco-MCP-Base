/**
 * RP-Initiated Logout (reauth) verification test.
 *
 * Bypasses the MCP Inspector to directly test whether the signout-based
 * reauth flow forces the Umbraco login form on a second authorization
 * in the same browser session (where Umbraco's session cookie exists).
 *
 * Flow:
 * 1. Register a dynamic client
 * 2. First authorization: consent → Approve → Umbraco login → callback
 * 3. Second authorization (same browser context, cookie persists):
 *    consent → Reauth → Umbraco signout → logout-callback → authorize → login form
 */

import { test, expect } from "@playwright/test";
import { startWorker, stopWorker } from "./helpers/worker-setup.js";

test.describe("reauth via RP-Initiated Logout", () => {
  let workerUrl: string;
  let clientId: string;

  test.beforeAll(async () => {
    workerUrl = await startWorker();

    // Register a dynamic client
    const resp = await fetch(`${workerUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: ["http://localhost:9999/callback"],
        client_name: "Reauth Test",
      }),
    });
    const data = (await resp.json()) as { client_id: string };
    clientId = data.client_id;
  }, 120_000);

  test.afterAll(async () => {
    await stopWorker();
  });

  function buildAuthorizeUrl(state: string): string {
    const url = new URL(`${workerUrl}/authorize`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", "http://localhost:9999/callback");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  test("first flow: Approve completes login normally", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(buildAuthorizeUrl("state-first"));

    // Consent screen — click Approve
    const approveBtn = page.locator('button[value="approve"]');
    await approveBtn.waitFor({ timeout: 10_000 });

    // First auth: should NOT show reauth button (no prior auth)
    const reauthBtn = page.locator('button[value="reauth"]');
    expect(await reauthBtn.isVisible().catch(() => false)).toBe(false);

    await approveBtn.click();

    // Umbraco login form (first time — no cookie yet)
    await page.waitForURL(
      (url) => url.hostname === "localhost" && url.pathname.includes("/umbraco"),
      { timeout: 15_000 },
    );

    // Wait for the Umbraco SPA to render the login form
    const emailInput = page.getByRole("textbox").first();
    await emailInput.waitFor({ timeout: 15_000 });
    await emailInput.fill("admin@admin.com");
    await page.getByRole("textbox").nth(1).fill("1234567890");
    await page.getByRole("button", { name: "Login" }).click();

    // After login, Umbraco redirects → Worker callback → redirect_uri (localhost:9999).
    // Since nothing runs on port 9999, the browser will show an error page.
    await page.waitForURL(
      (url) => !url.pathname.includes("/umbraco"),
      { timeout: 30_000 },
    ).catch(() => {});

    await page.waitForTimeout(2000);
    console.log("First flow ended at:", page.url());
  });

  test("second flow: Reauth button appears and forces fresh login", async ({ page }) => {
    test.setTimeout(120_000);

    // First, complete a normal flow to set the client_authed marker
    await page.goto(buildAuthorizeUrl("state-setup"));
    const approveBtn1 = page.locator('button[value="approve"]');
    await approveBtn1.waitFor({ timeout: 10_000 });
    await approveBtn1.click();

    // Login at Umbraco
    await page.waitForURL(
      (url) => url.hostname === "localhost" && url.pathname.includes("/umbraco"),
      { timeout: 15_000 },
    );
    const emailInput = page.getByRole("textbox").first();
    await emailInput.waitFor({ timeout: 15_000 });
    await emailInput.fill("admin@admin.com");
    await page.getByRole("textbox").nth(1).fill("1234567890");
    await page.getByRole("button", { name: "Login" }).click();

    await page.waitForURL(
      (url) => !url.pathname.includes("/umbraco"),
      { timeout: 30_000 },
    ).catch(() => {});
    await page.waitForTimeout(2000);
    console.log("Setup flow ended at:", page.url());

    // === SECOND FLOW: same browser context, Umbraco cookie persists ===
    await page.goto(buildAuthorizeUrl("state-reauth"), { waitUntil: "commit" });
    await page.waitForLoadState("domcontentloaded").catch(() => {});

    // The consent screen should now show the Reauth button
    const reauthBtn = page.locator('button[value="reauth"]');
    const isReauthVisible = await reauthBtn.isVisible({ timeout: 10_000 }).catch(() => false);

    if (!isReauthVisible) {
      console.log("Reauth button not visible. URL:", page.url());
      // Log page content for debugging
      const content = await page.content();
      console.log("Page contains reauth:", content.includes("reauth"));
      expect(isReauthVisible, "Expected Reauth button to be visible on second flow").toBe(true);
      return;
    }

    console.log("Second flow: Reauth button visible, clicking...");
    await reauthBtn.click();

    // After clicking Reauth:
    // Worker → Umbraco signout (clears cookie) → /logout-callback → Umbraco authorize → login form
    // Since the cookie is cleared, Umbraco should show the login form
    let landedOnLogin = false;
    let finalUrl = "";

    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(500);
      finalUrl = page.url();

      if (finalUrl.includes("/umbraco")) {
        const hasTextbox = await page.getByRole("textbox").first()
          .isVisible({ timeout: 1000 })
          .catch(() => false);
        if (hasTextbox) {
          landedOnLogin = true;
          break;
        }
      }

      if (finalUrl.includes(":9999") || finalUrl.includes("chrome-error")) {
        // Auto-redirected past Umbraco — signout didn't clear the cookie
        break;
      }
    }

    console.log("Second flow final URL:", finalUrl);
    console.log("Login form appeared:", landedOnLogin);

    expect(landedOnLogin, "Expected Umbraco login form to appear after reauth (signout should clear session cookie)").toBe(true);
  });
});
