/**
 * The session isolation check itself: it must pass for a tool that only uses
 * the SDK's per-request state, and catch a tool that keeps its own per-session
 * value in module scope (the pattern umbraco/Umbraco-MCP-Base#383 removes).
 */

import { describe, it, expect } from "@jest/globals";
import { UmbracoManagementClient, getSessionUmbracoAuth, type ToolCollectionExport } from "@umbraco-cms/mcp-server-sdk";
import { checkSessionIsolation, assertSessionIsolation } from "../session-isolation.js";

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

/** Set from `init`, the way a downstream worker keeps its own auth context. */
let moduleLevelAuth: { baseUrl: string; accessToken: string } | null = null;

const collection: ToolCollectionExport = {
  metadata: { name: "probe", displayName: "Probe", description: "" },
  tools: () => [
    {
      name: "via-sdk-transport",
      description: "Calls Umbraco through the SDK transport.",
      slices: ["read"],
      handler: async () => text(await UmbracoManagementClient({ url: "/umbraco/management/api/v1/probe", method: "GET" })),
    },
    {
      name: "via-session-auth",
      description: "Raw fetch using the SDK's session auth accessor.",
      slices: ["read"],
      handler: async () => {
        const auth = await getSessionUmbracoAuth();
        const res = await fetch(`${auth.baseUrl}/umbraco/management/api/v1/probe`, { headers: { authorization: `Bearer ${auth.accessToken}` } });
        return text(await res.json());
      },
    },
    {
      name: "via-module-slot",
      description: "Raw fetch using auth stashed in module scope at init.",
      slices: ["read"],
      handler: async () => {
        const res = await fetch(`${moduleLevelAuth!.baseUrl}/umbraco/management/api/v1/probe`, { headers: { authorization: `Bearer ${moduleLevelAuth!.accessToken}` } });
        return text(await res.json());
      },
    },
    { name: "no-umbraco-call", description: "Never calls Umbraco.", slices: ["read"], handler: async () => text("ok") },
  ],
};

const serverOptions = {
  name: "isolation-helper-test",
  version: "1.0.0",
  collections: [collection],
  modeRegistry: [],
  allModeNames: [],
  allSliceNames: ["read"],
} as never;

describe("checkSessionIsolation", () => {
  it("passes tools that only use the SDK's per-request state", async () => {
    const report = await assertSessionIsolation(serverOptions, {
      toolCalls: [{ name: "via-sdk-transport" }, { name: "via-session-auth" }],
    });
    expect(report.ok).toBe(true);
    expect(report.checkedRequests).toBeGreaterThanOrEqual(6);
  });

  it("catches a tool that uses per-session state kept in module scope", async () => {
    const report = await checkSessionIsolation(serverOptions, {
      toolCalls: [{ name: "via-module-slot" }],
      // A worker init() that keeps the session's auth in a module-level slot.
      init: ({ label }) => {
        const id = label.toLowerCase();
        moduleLevelAuth = { baseUrl: `https://session-${id}.isolation-check.invalid`, accessToken: `isolation-token-${id}` };
      },
    });
    expect(report.ok).toBe(false);
    expect(report.violations[0]).toMatchObject({ tool: "via-module-slot", session: "A", sentToSession: "B", tokenOfSession: "B" });
  });

  it("reports tools that made no Umbraco request", async () => {
    await expect(assertSessionIsolation(serverOptions, { toolCalls: [{ name: "no-umbraco-call" }] })).rejects.toThrow(
      /made no Umbraco request.*no-umbraco-call/,
    );
  });

  it("restores the global fetch", async () => {
    const before = globalThis.fetch;
    await checkSessionIsolation(serverOptions, { toolCalls: [{ name: "via-sdk-transport" }] });
    expect(globalThis.fetch).toBe(before);
  });
});

