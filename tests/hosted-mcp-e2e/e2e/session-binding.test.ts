/**
 * MCP session binding E2E tests.
 *
 * An MCP session belongs to the sign-in that started it. A request that
 * carries another sign-in's access token, or a session id that wasn't issued
 * to the caller, gets "Session not found" and never reaches the session.
 *
 * Prerequisites:
 * - Test Umbraco running at https://localhost:5201 / http://localhost:5200
 * - Worker started automatically in beforeAll
 */

import { createHash } from "node:crypto";
import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { startWorker, stopWorker } from "./helpers/worker-setup.js";

const CLIENT_REDIRECT = "http://localhost:9999/callback";
const CREDENTIALS = { email: "admin@admin.com", password: "1234567890" };
const CODE_VERIFIER = "session-binding-e2e-code-verifier-0123456789abcdef";
const CODE_CHALLENGE = createHash("sha256").update(CODE_VERIFIER).digest("base64url");

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "session-binding-e2e", version: "0.0.0" },
  },
};
const LIST_TOOLS = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

let workerUrl: string;

/** Registers a public client, signs in through the browser, and returns its access token. */
async function signIn(browser: Browser, clientName: string, options: { readOnly?: boolean } = {}): Promise<string> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const registration = await context.request.post(`${workerUrl}/register`, {
      data: { redirect_uris: [CLIENT_REDIRECT], client_name: clientName, token_endpoint_auth_method: "none" },
    });
    expect(registration.status()).toBe(201);
    const { client_id } = await registration.json();

    const page = await context.newPage();
    let clientRedirect: string | undefined;
    page.on("request", (request) => {
      if (!clientRedirect && request.url().startsWith(CLIENT_REDIRECT)) clientRedirect = request.url();
    });

    await page.goto(
      `${workerUrl}/authorize?${new URLSearchParams({
        client_id,
        redirect_uri: CLIENT_REDIRECT,
        response_type: "code",
        state: "client-state",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
      })}`
    );
    if (options.readOnly) await page.locator('input[name="readOnly"]').check();
    await page.locator('button[value="approve"]').click();

    await page.waitForURL((url) => url.hostname === "localhost" && url.pathname.includes("/umbraco"), {
      timeout: 30000,
    });
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

    await expect.poll(() => clientRedirect, { timeout: 30000 }).toBeDefined();
    const tokenResponse = await context.request.post(`${workerUrl}/token`, {
      form: {
        grant_type: "authorization_code",
        code: new URL(clientRedirect!).searchParams.get("code")!,
        redirect_uri: CLIENT_REDIRECT,
        client_id,
        code_verifier: CODE_VERIFIER,
      },
    });
    expect(tokenResponse.status(), await tokenResponse.text()).toBe(200);
    return (await tokenResponse.json()).access_token;
  } finally {
    await context.close();
  }
}

/** Sends one MCP message and returns the status, session id header and first JSON-RPC message. */
async function mcp(
  request: APIRequestContext,
  token: string,
  sessionId: string | undefined,
  body: unknown,
  method: "POST" | "DELETE" = "POST"
) {
  const response = await request.fetch(`${workerUrl}/mcp`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    ...(method === "POST" ? { data: body } : {}),
  });
  const text = await response.text();
  const events = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
  const message = events[0] ?? (text.startsWith("{") ? JSON.parse(text) : undefined);
  return { status: response.status(), sessionId: response.headers()["mcp-session-id"], message };
}

async function startSession(request: APIRequestContext, token: string): Promise<string> {
  const started = await mcp(request, token, undefined, INITIALIZE);
  expect(started.status).toBe(200);
  expect(started.sessionId).toBeTruthy();
  await mcp(request, token, started.sessionId, { jsonrpc: "2.0", method: "notifications/initialized" });
  return started.sessionId!;
}

async function toolNames(request: APIRequestContext, token: string, sessionId: string): Promise<string[]> {
  const listed = await mcp(request, token, sessionId, LIST_TOOLS);
  expect(listed.status).toBe(200);
  return listed.message.result.tools.map((tool: { name: string }) => tool.name).sort();
}

test.describe("MCP session binding", () => {
  let fullToken: string;
  let readOnlyToken: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    workerUrl = await startWorker();
    // Two separate sign-ins. The second consents to read-only, so the two
    // sessions expose visibly different tool sets.
    fullToken = await signIn(browser, "Session Binding E2E (full)");
    readOnlyToken = await signIn(browser, "Session Binding E2E (read-only)", { readOnly: true });
  });

  test.afterAll(async () => {
    await stopWorker();
  });

  test("each sign-in works in the session it started", async ({ request }) => {
    const fullSession = await startSession(request, fullToken);
    const readOnlySession = await startSession(request, readOnlyToken);

    const fullTools = await toolNames(request, fullToken, fullSession);
    const readOnlyTools = await toolNames(request, readOnlyToken, readOnlySession);

    expect(readOnlyTools.length).toBeGreaterThan(0);
    expect(fullTools.length).toBeGreaterThan(readOnlyTools.length);
  });

  test("another sign-in can't use or end the session", async ({ request }) => {
    const fullSession = await startSession(request, fullToken);
    const fullTools = await toolNames(request, fullToken, fullSession);

    const borrowed = await mcp(request, readOnlyToken, fullSession, LIST_TOOLS);
    expect(borrowed.status).toBe(404);
    expect(borrowed.message?.result).toBeUndefined();

    const ended = await mcp(request, readOnlyToken, fullSession, undefined, "DELETE");
    expect(ended.status).toBe(404);

    // The session is untouched for the sign-in that owns it.
    expect(await toolNames(request, fullToken, fullSession)).toEqual(fullTools);
  });

  test("a session id that wasn't issued to the caller is refused", async ({ request }) => {
    const fullSession = await startSession(request, fullToken);

    // The part before the last "." is the internal id (what traces record).
    const internalId = fullSession.slice(0, fullSession.lastIndexOf("."));
    expect(internalId.length).toBeGreaterThan(0);
    expect((await mcp(request, fullToken, internalId, LIST_TOOLS)).status).toBe(404);
    expect((await mcp(request, readOnlyToken, internalId, LIST_TOOLS)).status).toBe(404);

    // The owner can still end its own session.
    expect((await mcp(request, fullToken, fullSession, undefined, "DELETE")).status).toBeLessThan(300);
  });
});
