/**
 * Cloud MCP Inspector E2E test.
 *
 * Connects the MCP Inspector to a locally-spun Worker that uses
 * `umbracoCloudSiteRouting`, then drives the OAuth flow against a real
 * Umbraco Cloud project's backoffice login.
 *
 * Required env vars (test is skipped if any are missing):
 *   UMBRACO_CLOUD_TEST_PROJECT       — project alias, e.g. "hosted-mcp-worker-test"
 *   UMBRACO_CLOUD_TEST_USER          — backoffice email
 *   UMBRACO_CLOUD_TEST_PASSWORD      — backoffice password
 *   UMBRACO_CLOUD_OAUTH_CLIENT_ID    — OAuth client_id registered in the Cloud project
 *
 * Optional:
 *   UMBRACO_CLOUD_REGION             — defaults to "euwest01"
 *
 * Setup the Cloud project once needs:
 *   1. Register an OAuth client with the chosen client_id (see plan).
 *   2. Add `http://127.0.0.1:8787/callback/<alias>` as an allowed redirect URI.
 */

import { test, expect } from "@playwright/test";
import {
  startCloudWorker,
  stopCloudWorker,
} from "./helpers/cloud-worker-setup.js";
import {
  startInspector,
  connectInspector,
  handleUmbracoCloudOAuthFlow,
  getToolNames,
  callTool,
  type InspectorHandle,
} from "@umbraco-cms/mcp-hosted/testing";

const projectAlias = process.env.UMBRACO_CLOUD_TEST_PROJECT;
const cloudUser = process.env.UMBRACO_CLOUD_TEST_USER;
const cloudPassword = process.env.UMBRACO_CLOUD_TEST_PASSWORD;
const oauthClientId = process.env.UMBRACO_CLOUD_OAUTH_CLIENT_ID;
const region = process.env.UMBRACO_CLOUD_REGION ?? "euwest01";

const haveCredentials = Boolean(
  projectAlias && cloudUser && cloudPassword && oauthClientId,
);

const skipReason = haveCredentials
  ? ""
  : "Cloud E2E credentials missing. Copy .env.test.cloud.example to .env.test.cloud and fill in the values, or pass UMBRACO_CLOUD_TEST_PROJECT/USER/PASSWORD/OAUTH_CLIENT_ID inline.";


test.describe("Cloud MCP Inspector E2E", () => {
  test.skip(!haveCredentials, skipReason);

  let workerUrl: string;
  let inspector: InspectorHandle;

  test.beforeAll(async () => {
    workerUrl = await startCloudWorker({
      oauthClientId: oauthClientId!,
      region,
    });
    inspector = await startInspector({ client: 6284, proxy: 6287 });
  });

  test.afterAll(async () => {
    await inspector?.stop();
    await stopCloudWorker();
  });

  test.afterEach(async ({ page }) => {
    const disconnect = page.getByRole("button", { name: "Disconnect" });
    if (await disconnect.isVisible().catch(() => false)) {
      await disconnect.click();
    }
  });

  test("connects to /at/{alias}/, completes Cloud OAuth, lists tools", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const projectMcpUrl = `${workerUrl}/at/${projectAlias}/`;

    const oauthPage = await connectInspector(
      page,
      projectMcpUrl,
      inspector.url,
    );

    await handleUmbracoCloudOAuthFlow(oauthPage);

    // SSO login form on identity.umbraco.com / B2C
    await page.waitForURL(
      (url) =>
        url.hostname === "identity.umbraco.com" ||
        url.hostname.endsWith("b2clogin.com"),
      { timeout: 60_000 },
    );
    await page.waitForLoadState("networkidle", { timeout: 60_000 });

    const emailInput = page
      .locator(
        'input[type="email"], input[name="email"], input#email, input#signInName',
      )
      .first();
    await emailInput.waitFor({ timeout: 30_000 });
    await emailInput.click();
    await emailInput.pressSequentially(cloudUser!, { delay: 25 });

    const passwordInput = page
      .locator('input[type="password"], input[name="password"], input#password')
      .first();
    if (!(await passwordInput.isVisible().catch(() => false))) {
      const next = page
        .getByRole("button", { name: /next|continue/i })
        .first();
      if (await next.isVisible().catch(() => false)) {
        await next.click();
        await passwordInput.waitFor({ timeout: 30_000 });
      }
    }
    await passwordInput.click();
    await passwordInput.pressSequentially(cloudPassword!, { delay: 25 });

    await page
      .getByRole("button", { name: /sign in|log in|login|submit|next/i })
      .first()
      .click();

    // The Cloud OAuth chain goes through the project's authorize endpoint,
    // a silent SSO completion via id.umbraco.com, and back to the worker's
    // /callback before the Inspector is reauthenticated. Wait generously.
    await page
      .getByText("Connected")
      .waitFor({ state: "visible", timeout: 90_000 });

    // The cloud-worker reuses the template's collections, so we check the
    // template tools are listed — proves siteRouting → SSO → consent →
    // project authorize → token exchange → per-request server is wired up.
    const tools = await getToolNames(page, [
      "get-example",
      "list-examples",
      "get-widget",
      "get-server-info",
    ]);
    expect(tools).toContain("get-server-info");

    // Actually invoke a tool against the real Cloud project so we exercise
    // the audience-validated MCP request path end-to-end. `get-server-info`
    // hits Umbraco's /server/information endpoint and returns the project's
    // assembly version — proves the access token is accepted, the worker
    // dispatches to McpAgent, and the tool's outbound API call succeeds.
    const result = await callTool(page, "get-server-info", "assemblyVersion");
    expect(result).toContain("assemblyVersion");
  });
});
