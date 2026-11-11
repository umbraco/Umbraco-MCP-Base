/**
 * Browser-bound sign-in E2E tests.
 *
 * The consent approval and the Umbraco callback must happen in the same
 * browser. A sign-in that is approved in one browser and finished in another
 * (by opening the Umbraco sign-in link there) is rejected at /callback, and
 * no authorization code reaches the MCP client's redirect URI.
 *
 * Prerequisites:
 * - Test Umbraco running at https://localhost:5201 / http://localhost:5200
 * - Worker started automatically in beforeAll
 */

import { test, expect, type Browser, type Page } from "@playwright/test";
import { startWorker, stopWorker } from "./helpers/worker-setup.js";

const CLIENT_REDIRECT = "http://localhost:9999/callback";
const CLIENT_STATE = "client-state-123";
const CREDENTIALS = { email: "admin@admin.com", password: "1234567890" };

// PKCE pair: CODE_CHALLENGE is the S256 (base64url SHA-256) of CODE_VERIFIER.
const CODE_VERIFIER = "browser-binding-e2e-code-verifier-0123456789abcdef";
const CODE_CHALLENGE = "Gl4j-eUZgNOTBvMm7mQIQYKTDCZ-WyIglhZRJ1nqeLk";

let workerUrl: string;
let authorizeUrl: string;
let clientId: string;

const isUmbracoAuthorize = (url: URL) =>
  url.pathname.endsWith("/security/back-office/authorize");
const isUmbracoLogin = (url: URL) =>
  url.hostname === "localhost" && url.pathname.includes("/umbraco") && !isUmbracoAuthorize(url);
const isClientRedirect = (url: URL) => url.href.startsWith(CLIENT_REDIRECT);

test.describe("Browser-bound sign-in", () => {
  test.beforeAll(async ({ request }) => {
    workerUrl = await startWorker();

    const registration = await request.post(`${workerUrl}/register`, {
      data: {
        redirect_uris: [CLIENT_REDIRECT],
        client_name: "Browser Binding E2E",
        // A public client with PKCE, like real MCP clients.
        token_endpoint_auth_method: "none",
      },
    });
    expect(registration.status()).toBe(201);
    const { client_id } = await registration.json();
    clientId = client_id;

    authorizeUrl = `${workerUrl}/authorize?${new URLSearchParams({
      client_id,
      redirect_uri: CLIENT_REDIRECT,
      response_type: "code",
      state: CLIENT_STATE,
      code_challenge: CODE_CHALLENGE,
      code_challenge_method: "S256",
    })}`;
  });

  test.afterAll(async () => {
    await stopWorker();
  });

  /**
   * Records the first request the page makes to a matching URL. Uses request
   * events rather than page.route(), because routes don't see requests that
   * are reached by following a redirect.
   */
  function watchRequests(page: Page, match: (url: URL) => boolean): () => string | undefined {
    let reached: string | undefined;
    page.on("request", (request) => {
      if (!reached && match(new URL(request.url()))) reached = request.url();
    });
    return () => reached;
  }

  async function logIntoUmbraco(page: Page): Promise<void> {
    await page.waitForURL(isUmbracoLogin, { timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    const loginButton = page.getByRole("button", { name: "Login" });
    await loginButton.waitFor({ timeout: 30000 });
    const email = page.getByRole("textbox").first();
    const password = page.getByRole("textbox").nth(1);
    await email.click();
    await email.pressSequentially(CREDENTIALS.email, { delay: 25 });
    await email.press("Tab");
    await password.click();
    await password.pressSequentially(CREDENTIALS.password, { delay: 25 });
    await password.press("Tab");
    await loginButton.click();
  }

  async function newBrowserContext(browser: Browser) {
    return browser.newContext({ ignoreHTTPSErrors: true });
  }

  test("completes when approval and sign-in happen in the same browser", async ({ browser }) => {
    const context = await newBrowserContext(browser);
    const page = await context.newPage();
    const clientRedirect = watchRequests(page, isClientRedirect);

    await page.goto(authorizeUrl);
    await page.locator('button[value="approve"]').click();
    await logIntoUmbraco(page);

    await expect.poll(clientRedirect, { timeout: 30000 }).toBeDefined();
    const redirect = new URL(clientRedirect()!);
    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(redirect.searchParams.get("state")).toBe(CLIENT_STATE);

    // Redeem the code. The access token is `{userId}:{grantId}:{secret}`; the
    // grant belongs to the signed-in Umbraco user (a 32-hex hash), not a
    // shared or per-sign-in fallback id.
    const tokenResponse = await context.request.post(`${workerUrl}/token`, {
      form: {
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: CLIENT_REDIRECT,
        client_id: clientId,
        code_verifier: CODE_VERIFIER,
      },
    });
    expect(tokenResponse.status(), await tokenResponse.text()).toBe(200);
    const { access_token } = await tokenResponse.json();
    expect(access_token.split(":")[0]).toMatch(/^[0-9a-f]{32}$/);

    // The token (audience-bound to this Worker) is accepted for MCP requests.
    const mcp = await context.request.post(`${workerUrl}/mcp`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "browser-binding-e2e", version: "0.0.0" },
        },
      },
    });
    expect(mcp.status(), await mcp.text()).toBe(200);

    await context.close();
  });

  test("rejects a sign-in link approved in one browser and opened in another", async ({
    browser,
  }) => {
    // Browser A approves the consent screen; capture the Umbraco sign-in
    // link instead of following it.
    const contextA = await newBrowserContext(browser);
    const pageA = await contextA.newPage();
    const umbracoLinkOf = watchRequests(pageA, isUmbracoAuthorize);
    await pageA.goto(authorizeUrl);
    await pageA.locator('button[value="approve"]').click();
    await expect.poll(umbracoLinkOf, { timeout: 15000 }).toBeDefined();
    const umbracoLink = umbracoLinkOf();
    // Browser A is not signed in to Umbraco, so it stops at the login page.
    await contextA.close();

    // Browser B never saw the consent screen. It opens the link and signs in.
    const contextB = await newBrowserContext(browser);
    const pageB = await contextB.newPage();
    const clientRedirect = watchRequests(pageB, isClientRedirect);
    await pageB.goto(umbracoLink!);
    await logIntoUmbraco(pageB);

    // Umbraco returns B to the Worker's /callback, which refuses it.
    await pageB.waitForURL((url) => url.pathname.startsWith("/callback"), { timeout: 30000 });
    await expect(pageB.getByRole("heading")).toContainText("can't be used here");
    expect(clientRedirect()).toBeUndefined();

    await contextB.close();
  });

  test("rejects an approval submitted from another browser", async ({ browser }) => {
    // Browser A opens the consent screen and reads the form's state value.
    const contextA = await newBrowserContext(browser);
    const pageA = await contextA.newPage();
    await pageA.goto(authorizeUrl);
    const consentState = await pageA.locator('input[name="state"]').getAttribute("value");
    expect(consentState).toBeTruthy();

    // Browser B submits that state as an approval without having seen the screen.
    const contextB = await newBrowserContext(browser);
    const response = await contextB.request.post(authorizeUrl, {
      form: { state: consentState!, action: "approve" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);

    await contextA.close();
    await contextB.close();
  });
});
