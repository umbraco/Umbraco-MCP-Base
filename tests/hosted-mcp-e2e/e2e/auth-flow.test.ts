/**
 * Full OAuth authorization flow E2E test.
 *
 * Drives a real browser through:
 * 1. Dynamic client registration
 * 2. PKCE challenge generation
 * 3. Consent screen approval
 * 4. Umbraco backoffice login
 * 5. Callback with authorization code
 * 6. Token exchange
 *
 * Prerequisites:
 * - Test Umbraco running at https://localhost:5201 / http://localhost:5200
 * - Worker running (started in beforeAll via unstable_startWorker)
 */

import { test, expect } from "@playwright/test";
import {
  registerClient,
  generatePKCE,
  buildAuthorizeUrl,
  exchangeCodeForToken,
} from "./helpers/oauth.js";
import { startWorker, stopWorker, getWorkerUrl } from "./helpers/worker-setup.js";

// Test-local redirect URI — we'll intercept the redirect, not actually serve it
const TEST_REDIRECT_URI = "http://localhost:9999/callback";

test.describe("OAuth authorization flow", () => {
  let workerUrl: string;
  let clientId: string;
  let pkce: ReturnType<typeof generatePKCE>;

  test.beforeAll(async () => {
    workerUrl = await startWorker();

    // Register a dynamic client
    const reg = await registerClient(workerUrl, TEST_REDIRECT_URI);
    clientId = reg.clientId;

    // Generate PKCE pair
    pkce = generatePKCE();
  });

  test.afterAll(async () => {
    await stopWorker();
  });

  test("full auth flow: consent → Umbraco login → callback → token", async ({ page }) => {
    // 1. Navigate to the authorization URL
    const authorizeUrl = buildAuthorizeUrl(workerUrl, {
      clientId,
      redirectUri: TEST_REDIRECT_URI,
      codeChallenge: pkce.codeChallenge,
      state: "e2e-auth-test",
    });

    await page.goto(authorizeUrl);

    // 2. Consent screen should be visible
    await expect(page.locator("body")).toContainText("authorize", { ignoreCase: true });

    // 3. Submit the consent form (approve with defaults)
    const approveButton = page.locator('button[value="approve"]');
    await expect(approveButton).toBeVisible({ timeout: 10000 });
    await approveButton.click();

    // 4. Should redirect to Umbraco login page
    // Wait for navigation to Umbraco's authorize endpoint
    await page.waitForURL(
      (url) => url.hostname === "localhost" && url.pathname.includes("/umbraco"),
      { timeout: 15000 },
    );

    // 5. Fill in Umbraco login credentials
    // Umbraco backoffice uses web components with shadow DOM,
    // so use role-based locators that pierce shadow roots.
    const emailInput = page.getByRole("textbox").first();
    const passwordInput = page.getByRole("textbox").nth(1);

    await emailInput.waitFor({ timeout: 15000 });
    await emailInput.fill("admin@admin.com");
    await passwordInput.fill("1234567890");

    // 6. Set up request interception before clicking login.
    //    After login, the Worker's /callback processes the Umbraco auth code
    //    and redirects to the test client's redirect URI at port 9999.
    //    Since nothing listens there, we intercept the request to capture the URL.
    const redirectPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for redirect to test callback URI")),
        30000,
      );

      page.on("request", (req) => {
        const reqUrl = new URL(req.url());
        if (
          reqUrl.origin === "http://localhost:9999" &&
          reqUrl.pathname === "/callback" &&
          reqUrl.searchParams.has("code")
        ) {
          clearTimeout(timer);
          resolve(req.url());
        }
      });
    });

    // Submit the Umbraco login form
    const loginButton = page.getByRole("button", { name: "Login" });
    await loginButton.click();

    const redirectUrl = await redirectPromise;

    // 7. Extract the authorization code from the URL
    const callbackUrl = new URL(redirectUrl);
    const code = callbackUrl.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(callbackUrl.searchParams.get("state")).toBe("e2e-auth-test");

    // 8. Exchange the code for an access token
    const tokenResult = await exchangeCodeForToken(workerUrl, {
      code: code!,
      clientId,
      redirectUri: TEST_REDIRECT_URI,
      codeVerifier: pkce.codeVerifier,
    });

    expect(tokenResult.accessToken).toBeTruthy();
    expect(tokenResult.tokenType).toBeTruthy();
  });
});
