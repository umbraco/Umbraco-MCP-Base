/**
 * `createSiteRoutingApiHandler` — an MCP session only accepts the sign-in
 * that started it.
 *
 * McpAgent finds a session's Durable Object by the `Mcp-Session-Id` header
 * alone. The wrapper hands the client `<session id>.<tag>`, where the tag is
 * keyed by the sign-in's token key, and only forwards a request whose tag
 * matches the caller's own sign-in.
 */

import { describe, expect, it, jest } from "@jest/globals";
import type { HostedMcpEnv } from "../../types/env.js";
import { createSiteRoutingApiHandler, type FetchHandler } from "../site-router.js";

const SESSION_ID = "0123abcd".repeat(8);
const MCP_URL = "https://worker.example.com/mcp";

/** Every sign-in's Umbraco token entry reads as present. */
const env = {
  OAUTH_KV: { get: async (key: string) => (key.startsWith("umbraco_token:") ? '{"tokens":{"access_token":"a"}}' : null) },
} as unknown as HostedMcpEnv;

const signIn = (tokenKey: string) => ({ props: { umbracoTokenKey: tokenKey } }) as unknown as ExecutionContext;
const ALICE = signIn("token-key-alice");
const BOB = signIn("token-key-bob");

/**
 * Stands in for `McpAgent.serve()`: starts a session when the request has no
 * session id, otherwise records the id it was given.
 */
function makeAgent() {
  const seenSessionIds: (string | null)[] = [];
  const fetch = jest.fn<FetchHandler>(async (request) => {
    const sessionId = request.headers.get("mcp-session-id");
    seenSessionIds.push(sessionId);
    return new Response("ok", { status: 200, headers: sessionId ? {} : { "mcp-session-id": SESSION_ID } });
  });
  return { fetch, seenSessionIds };
}

function mcpRequest(sessionId?: string, method = "POST"): Request {
  const headers = new Headers({ Authorization: "Bearer user:grant:secret" });
  if (sessionId !== undefined) headers.set("mcp-session-id", sessionId);
  return new Request(MCP_URL, { method, headers });
}

async function startSession(handler: { fetch: FetchHandler }, ctx: ExecutionContext): Promise<string> {
  const response = await handler.fetch(mcpRequest(), env, ctx);
  return response.headers.get("mcp-session-id")!;
}

describe("createSiteRoutingApiHandler — session binding", () => {
  it("hands the client a session id bound to its sign-in, not the bare id", async () => {
    const handler = createSiteRoutingApiHandler(makeAgent());
    const sealed = await startSession(handler, ALICE);

    expect(sealed).not.toBe(SESSION_ID);
    expect(sealed.startsWith(`${SESSION_ID}.`)).toBe(true);
    expect(sealed).not.toContain("token-key-alice");
  });

  it("forwards the bare session id for the sign-in that started the session", async () => {
    const agent = makeAgent();
    const handler = createSiteRoutingApiHandler(agent);
    const sealed = await startSession(handler, ALICE);

    const response = await handler.fetch(mcpRequest(sealed), env, ALICE);

    expect(response.status).toBe(200);
    expect(agent.seenSessionIds).toEqual([null, SESSION_ID]);
  });

  it("refuses another sign-in presenting that session id, without reaching the session", async () => {
    const agent = makeAgent();
    const handler = createSiteRoutingApiHandler(agent);
    const sealed = await startSession(handler, ALICE);

    const response = await handler.fetch(mcpRequest(sealed), env, BOB);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { message: "Session not found" } });
    expect(agent.fetch).toHaveBeenCalledTimes(1); // only Alice's initialize
  });

  it("refuses another sign-in ending that session", async () => {
    const agent = makeAgent();
    const handler = createSiteRoutingApiHandler(agent);
    const sealed = await startSession(handler, ALICE);

    const response = await handler.fetch(mcpRequest(sealed, "DELETE"), env, BOB);

    expect(response.status).toBe(404);
    expect(agent.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the bare session id, as it appears in traces", SESSION_ID],
    ["a made-up tag", `${SESSION_ID}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`],
    ["an empty tag", `${SESSION_ID}.`],
    ["an empty session id", ".tag"],
  ])("refuses %s, even from the session's own sign-in", async (_label, presented) => {
    const agent = makeAgent();
    const handler = createSiteRoutingApiHandler(agent);
    await startSession(handler, ALICE);

    const response = await handler.fetch(mcpRequest(presented), env, ALICE);

    expect(response.status).toBe(404);
    expect(agent.fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a tag made for one session on a different session id", async () => {
    const agent = makeAgent();
    const handler = createSiteRoutingApiHandler(agent);
    const sealed = await startSession(handler, ALICE);
    const tag = sealed.slice(sealed.lastIndexOf(".") + 1);

    const response = await handler.fetch(mcpRequest(`${"f".repeat(64)}.${tag}`), env, ALICE);

    expect(response.status).toBe(404);
  });

  it("gives two sign-ins different ids for the same session id", async () => {
    const handler = createSiteRoutingApiHandler(makeAgent());
    expect(await startSession(handler, ALICE)).not.toBe(await startSession(handler, BOB));
  });

  it("leaves responses without a session id untouched", async () => {
    const original = new Response("plain", { status: 200 });
    const handler = createSiteRoutingApiHandler({ fetch: async () => original });
    expect(await handler.fetch(mcpRequest(), env, ALICE)).toBe(original);
  });

  it("passes through unchanged when the request has no sign-in to bind to", async () => {
    const agent = makeAgent();
    const handler = createSiteRoutingApiHandler(agent);
    const noSignIn = { props: {} } as unknown as ExecutionContext;

    const started = await handler.fetch(mcpRequest(), env, noSignIn);
    expect(started.headers.get("mcp-session-id")).toBe(SESSION_ID);

    await handler.fetch(mcpRequest(SESSION_ID), env, noSignIn);
    expect(agent.seenSessionIds).toEqual([null, SESSION_ID]);
  });
});
