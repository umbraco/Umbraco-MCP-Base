/**
 * Authenticated MCP tool call E2E tests.
 *
 * Uses a token obtained from the full OAuth flow to make
 * authenticated MCP protocol requests (initialize, tools/list, tools/call).
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

const TEST_REDIRECT_URI = "http://localhost:9999/callback";

test.describe("Authenticated MCP calls", () => {
  let workerUrl: string;
  let accessToken: string;
  let sessionId: string | undefined;

  test.beforeAll(async ({ browser }) => {
    workerUrl = await startWorker();

    // Obtain a token through the full OAuth flow using a browser context
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    const reg = await registerClient(workerUrl, TEST_REDIRECT_URI);
    const pkce = generatePKCE();

    const authorizeUrl = buildAuthorizeUrl(workerUrl, {
      clientId: reg.clientId,
      redirectUri: TEST_REDIRECT_URI,
      codeChallenge: pkce.codeChallenge,
      state: "mcp-auth-test",
    });

    await page.goto(authorizeUrl);

    // Approve consent
    const approveButton = page.locator('button[value="approve"]');
    await approveButton.click();

    // Umbraco login
    await page.waitForURL(
      (url) => url.hostname === "localhost" && url.pathname.includes("/umbraco"),
      { timeout: 15000 },
    );

    const emailInput = page.getByRole("textbox").first();
    const passwordInput = page.getByRole("textbox").nth(1);
    await emailInput.waitFor({ timeout: 15000 });
    await emailInput.fill("admin@admin.com");
    await passwordInput.fill("1234567890");

    // Set up request interception before clicking login.
    // The final redirect goes to port 9999 where nothing listens,
    // so capture the URL via the request event.
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

    await page.getByRole("button", { name: "Login" }).click();

    const redirectUrl = await redirectPromise;
    const callbackUrl = new URL(redirectUrl);
    const code = callbackUrl.searchParams.get("code")!;

    // Exchange code for token
    const tokenResult = await exchangeCodeForToken(workerUrl, {
      code,
      clientId: reg.clientId,
      redirectUri: TEST_REDIRECT_URI,
      codeVerifier: pkce.codeVerifier,
    });

    accessToken = tokenResult.accessToken;
    await context.close();
  });

  test.afterAll(async () => {
    await stopWorker();
  });

  /**
   * Parse an SSE response body into JSON-RPC result objects.
   */
  function parseSseResponse(body: string): unknown[] {
    const results: unknown[] = [];
    for (const line of body.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          results.push(JSON.parse(line.slice(6)));
        } catch {
          // skip non-JSON data lines
        }
      }
    }
    return results;
  }

  /**
   * Send a JSON-RPC request to /mcp with authentication.
   * Handles SSE responses and session management.
   */
  async function mcpRequest(
    method: string,
    params?: unknown,
    id?: number,
  ): Promise<{ status: number; data: Record<string, unknown> }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${accessToken}`,
    };

    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    const response = await fetch(`${workerUrl}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        id: id ?? 1,
        ...(params ? { params } : {}),
      }),
    });

    // Capture session ID from response
    const newSessionId = response.headers.get("Mcp-Session-Id");
    if (newSessionId) {
      sessionId = newSessionId;
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    const body = await response.text();

    let data: Record<string, unknown>;
    if (contentType.includes("text/event-stream")) {
      // Parse SSE: extract the first JSON-RPC message from data: lines
      const messages = parseSseResponse(body);
      data = (messages[0] as Record<string, unknown>) ?? {};
    } else {
      try {
        data = JSON.parse(body);
      } catch {
        data = { raw: body };
      }
    }

    return { status: response.status, data };
  }

  test("initialize returns server info", async () => {
    const { status, data } = await mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "e2e-test", version: "1.0" },
    });

    expect(status).toBe(200);
    expect(data.result).toBeDefined();

    const result = data.result as Record<string, unknown>;
    expect(result.serverInfo).toBeDefined();

    const serverInfo = result.serverInfo as Record<string, unknown>;
    expect(serverInfo.name).toBe("my-umbraco-mcp");
  });

  test("tools/list returns registered tools", async () => {
    const { status, data } = await mcpRequest("tools/list", {}, 2);
    expect(status).toBe(200);

    expect(data.result).toBeDefined();
    const result = data.result as Record<string, unknown>;
    expect(result.tools).toBeDefined();

    const tools = result.tools as Array<{ name: string }>;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    // Should include tools from registered collections
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(["get-example"]));
    expect(toolNames).toEqual(expect.arrayContaining(["get-server-info"]));
  });

  test("tools/call executes get-server-info against real Umbraco", async () => {
    // Call get-server-info — this hits the real Umbraco Management API
    // and proves the full auth chain works: OAuth → token → API → response
    const { status, data } = await mcpRequest(
      "tools/call",
      { name: "get-server-info", arguments: {} },
      3,
    );

    expect(status).toBe(200);
    expect(data.result).toBeDefined();

    const result = data.result as Record<string, unknown>;
    expect(result.content).toBeDefined();

    // The response should contain actual Umbraco version info
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content.length).toBeGreaterThan(0);
    const allText = content.map((c) => c.text).join("\n");
    // Should NOT be an error — proves the token is valid
    expect(result.isError).toBeFalsy();
    expect(allText).toContain("version");
  });
});
