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
/** Set from `init`: the last session to start wins. */
let moduleLevelServer: { elicitInput: (params: { message: string; requestedSchema: { type: "object"; properties: Record<string, never> } }) => Promise<unknown> } | null = null;
let moduleLevelAuth: { baseUrl: string; accessToken: string } | null = null;

/** Written at the start of each call and read after an await, so it only breaks when calls overlap. */
let lazyCallSlot: { baseUrl: string; accessToken: string } | null = null;

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
    {
      name: "via-lazy-call-slot",
      description: "Stashes auth in module scope at the start of the call, uses it after an await.",
      slices: ["read"],
      handler: async () => {
        lazyCallSlot = await getSessionUmbracoAuth();
        await UmbracoManagementClient({ url: "/umbraco/management/api/v1/probe", method: "GET" });
        const res = await fetch(`${lazyCallSlot.baseUrl}/umbraco/management/api/v1/second`, {
          headers: { authorization: `Bearer ${lazyCallSlot.accessToken}` },
        });
        return text(await res.json());
      },
    },
    {
      name: "external-fetch-then-lazy-slot",
      description: "Fetches a non-Umbraco URL, then stashes auth at call start and uses it after an await.",
      slices: ["read"],
      handler: async () => {
        await fetch("https://media-source.example.invalid/image.png");
        lazyCallSlot = await getSessionUmbracoAuth();
        await UmbracoManagementClient({ url: "/umbraco/management/api/v1/probe", method: "GET" });
        const res = await fetch(`${lazyCallSlot.baseUrl}/umbraco/management/api/v1/second`, {
          headers: { authorization: `Bearer ${lazyCallSlot.accessToken}` },
        });
        return text(await res.json());
      },
    },
    {
      name: "fetches-external-source",
      description: "Fetches a non-Umbraco URL, then calls Umbraco.",
      slices: ["read"],
      handler: async () => {
        await fetch("https://media-source.example.invalid/image.png");
        return text(await UmbracoManagementClient({ url: "/umbraco/management/api/v1/probe", method: "GET" }));
      },
    },
    {
      name: "external-only",
      description: "Only fetches a non-Umbraco URL.",
      slices: ["read"],
      handler: async () => {
        await fetch("https://media-source.example.invalid/image.png");
        return text("ok");
      },
    },
    {
      name: "elicits-via-module-server",
      description: "Elicits through a server reference kept in module scope.",
      slices: ["read"],
      handler: async () => {
        await UmbracoManagementClient({ url: "/umbraco/management/api/v1/probe", method: "GET" });
        await moduleLevelServer!.elicitInput({ message: "ok?", requestedSchema: { type: "object", properties: {} } });
        return text("ok");
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

  it("catches per-call module state that only breaks when calls overlap", async () => {
    // Passes while calls run one after another...
    const sequential = await checkSessionIsolation(serverOptions, { toolCalls: [{ name: "via-lazy-call-slot" }] });
    const midCall = sequential.violations.filter((v) => v.phase === "session-started-mid-call");
    expect(sequential.violations.filter((v) => v.phase === "after-other-session-started")).toEqual([]);
    // ...but A's second request goes out with C's auth once C's call ran while A was paused.
    expect(midCall).toHaveLength(1);
    expect(midCall[0]).toMatchObject({ session: "A", sentToSession: "C1", tokenOfSession: "C1" });
  });

  it("pauses the call on its first Umbraco request, not an earlier external fetch", async () => {
    const report = await checkSessionIsolation(serverOptions, { toolCalls: [{ name: "external-fetch-then-lazy-slot" }] });
    expect(report.violations.filter((v) => v.phase === "session-started-mid-call")).toHaveLength(1);
  });

  it("ignores requests to non-Umbraco hosts and doesn't count them", async () => {
    const report = await assertSessionIsolation(serverOptions, { toolCalls: [{ name: "fetches-external-source" }] });
    expect(report.ok).toBe(true);
    await expect(assertSessionIsolation(serverOptions, { toolCalls: [{ name: "external-only" }] })).rejects.toThrow(
      /made no Umbraco request.*external-only/,
    );
  });

  it("flags a non-Umbraco host only when the override says it is Umbraco", async () => {
    const report = await checkSessionIsolation(serverOptions, {
      toolCalls: [{ name: "fetches-external-source" }],
      isUmbracoRequest: () => true,
    });
    expect(report.violations[0]).toMatchObject({ sentToSession: "unknown", tokenOfSession: "none" });
  });

  it("rethrows an error from a session started mid-call", async () => {
    await expect(
      checkSessionIsolation(serverOptions, {
        toolCalls: [{ name: "via-sdk-transport" }],
        init: ({ label }) => {
          if (label === "C1") throw new Error("init failed for C1");
        },
      }),
    ).rejects.toThrow("init failed for C1");
  });

  it("keeps SDK tools isolated through token refresh and a 401 retry", async () => {
    const report = await assertSessionIsolation(serverOptions, {
      toolCalls: [{ name: "via-sdk-transport" }],
      exerciseRefresh: true,
    });
    expect(report.ok).toBe(true);
    // More requests than the three bare calls: refreshes and the retry ran.
    expect(report.checkedRequests).toBeGreaterThan(3);
  });

  it("catches an elicitation delivered to another session's client", async () => {
    const report = await checkSessionIsolation(serverOptions, {
      toolCalls: [{ name: "elicits-via-module-server" }],
      init: ({ server }) => {
        moduleLevelServer = server.server;
      },
    });
    expect(report.violations).toContainEqual(
      expect.objectContaining({ kind: "message", session: "A", sentToSession: "B", phase: "after-other-session-started" }),
    );
  });

  it("applies per-session props overrides", async () => {
    const seen: string[] = [];
    await checkSessionIsolation(serverOptions, {
      toolCalls: [{ name: "via-sdk-transport" }],
      sessionOverrides: (label) => ({ props: { userName: `Override ${label}` } }),
      init: ({ props }) => {
        seen.push(props.userName as string);
      },
    });
    expect(seen.slice(0, 2)).toEqual(["Override A", "Override B"]);
  });

  it("refuses to run two checks at once", async () => {
    const first = checkSessionIsolation(serverOptions, { toolCalls: [{ name: "via-sdk-transport" }] });
    await expect(checkSessionIsolation(serverOptions, { toolCalls: [{ name: "via-sdk-transport" }] })).rejects.toThrow(/already running/);
    await first;
  });
});
