/**
 * Request-Scoped Telemetry Context Tests
 *
 * The carrier exists to solve one problem: request-scoped span attributes on a
 * host whose telemetry adapter is module-scoped and shared by every Durable
 * Object in an isolate. So the tests that matter most here are the ones about
 * *isolation* — that two interleaved calls never see each other's tenant — and
 * about *absence* — that a missing value stays missing rather than becoming an
 * empty or stubbed attribute.
 */

import { jest, describe, it, expect } from "@jest/globals";

interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
}

/** Fresh module graph per test, with a recording adapter installed into it. */
async function setup() {
  jest.resetModules();

  const telemetry = await import("../index.js");

  const spans: RecordedSpan[] = [];
  telemetry.setTelemetryAdapter({
    startSpan: async (name, attributes, fn) => {
      const recorded: RecordedSpan = { name, attributes: { ...attributes } };
      spans.push(recorded);
      return fn({
        setAttribute(key, value) {
          recorded.attributes[key] = value;
        },
      });
    },
  });

  return { ...telemetry, spans };
}

function makeTool(overrides: Record<string, unknown> = {}) {
  return {
    name: "get-thing",
    description: "test tool",
    handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    ...overrides,
  } as any;
}

describe("prepareRequestTelemetryContext", () => {
  it("returns undefined for undefined or an empty object", async () => {
    const { prepareRequestTelemetryContext } = await setup();

    expect(prepareRequestTelemetryContext(undefined)).toBeUndefined();
    expect(prepareRequestTelemetryContext({})).toBeUndefined();
  });

  it("returns a frozen copy when there is at least one value", async () => {
    const { prepareRequestTelemetryContext } = await setup();
    const source = { tenant: "hash-a" };

    const prepared = prepareRequestTelemetryContext(source);

    expect(prepared).toEqual({ tenant: "hash-a" });
    expect(prepared).not.toBe(source);
    expect(Object.isFrozen(prepared)).toBe(true);
  });
});

describe("withRequestTelemetryContext", () => {
  it("reuses an already-prepared carrier instead of re-freezing a new copy", async () => {
    // The perf path `registerCollectionTools` relies on: prepare once outside
    // a per-tool loop, then every tool's wrapper should attach that exact
    // reference rather than paying isNonEmpty + freeze again per tool.
    const { withRequestTelemetryContext, prepareRequestTelemetryContext, TELEMETRY_CONTEXT_KEY } =
      await setup();
    const prepared = prepareRequestTelemetryContext({ tenant: "hash-a" });
    const seen: any[] = [];

    const wrapped = withRequestTelemetryContext(
      async (extra: unknown) => {
        seen.push(extra);
      },
      prepared
    );
    await wrapped({ sessionId: "sess-1" });

    expect(seen[0][TELEMETRY_CONTEXT_KEY]).toBe(prepared);
  });


  it("attaches the values to the extra argument of a two-argument call", async () => {
    const { withRequestTelemetryContext, TELEMETRY_CONTEXT_KEY } = await setup();
    const seen: any[] = [];

    const wrapped = withRequestTelemetryContext(
      async (_args: unknown, extra: unknown) => {
        seen.push(extra);
      },
      { tenant: "hash-a", region: "euwest01", loginSession: "login-a" }
    );

    await wrapped({ id: 1 }, { sessionId: "sess-1" });

    expect(seen[0][TELEMETRY_CONTEXT_KEY]).toEqual({
      tenant: "hash-a",
      region: "euwest01",
      loginSession: "login-a",
    });
    // The transport's own fields survive the copy.
    expect(seen[0].sessionId).toBe("sess-1");
  });

  it("attaches to the sole argument when the tool declares no input schema", async () => {
    // The MCP SDK calls such a callback as `(extra)`, not `(args, extra)`.
    const { withRequestTelemetryContext, TELEMETRY_CONTEXT_KEY } = await setup();
    const seen: any[] = [];

    const wrapped = withRequestTelemetryContext(
      async (extra: unknown) => {
        seen.push(extra);
      },
      { tenant: "hash-a" }
    );

    await wrapped({ sessionId: "sess-1" });

    expect(seen[0][TELEMETRY_CONTEXT_KEY]).toEqual({ tenant: "hash-a" });
  });

  it("does not mutate the object the MCP SDK owns", async () => {
    const { withRequestTelemetryContext, TELEMETRY_CONTEXT_KEY } = await setup();
    const extra = { sessionId: "sess-1" };

    const wrapped = withRequestTelemetryContext(
      async (_args: unknown, _extra: unknown) => {},
      { tenant: "hash-a" }
    );
    await wrapped({}, extra);

    expect(extra).not.toHaveProperty(TELEMETRY_CONTEXT_KEY);
  });

  it("returns the callback untouched when there is nothing to carry", async () => {
    const { withRequestTelemetryContext } = await setup();
    const callback = async () => {};

    expect(withRequestTelemetryContext(callback, undefined)).toBe(callback);
    expect(withRequestTelemetryContext(callback, {})).toBe(callback);
  });

  it("ignores a later mutation of the host's object", async () => {
    const { withRequestTelemetryContext, TELEMETRY_CONTEXT_KEY } = await setup();
    const source = { tenant: "hash-a" };
    const seen: any[] = [];

    const wrapped = withRequestTelemetryContext(
      async (_args: unknown, extra: unknown) => {
        seen.push(extra);
      },
      source
    );
    source.tenant = "hash-b";

    await wrapped({}, {});

    expect(seen[0][TELEMETRY_CONTEXT_KEY].tenant).toBe("hash-a");
  });
});

describe("withTelemetry reading the carrier", () => {
  it("records tenant, region and login session from the call's context", async () => {
    const {
      withTelemetry,
      withRequestTelemetryContext,
      TelemetryAttributes,
      spans,
    } = await setup();

    const handler = withRequestTelemetryContext(
      withTelemetry(makeTool()).handler as any,
      { tenant: "hash-a", region: "euwest01", loginSession: "login-a" }
    );
    await handler({}, {});

    expect(spans[0].attributes[TelemetryAttributes.TENANT]).toBe("hash-a");
    expect(spans[0].attributes[TelemetryAttributes.REGION]).toBe("euwest01");
    expect(spans[0].attributes[TelemetryAttributes.LOGIN_SESSION]).toBe("login-a");
  });

  it("keeps login session distinct from the transport's session id", async () => {
    // Different concepts on purpose: one login can outlive many transport
    // sessions, so the two must never be collapsed into one attribute.
    const {
      withTelemetry,
      withRequestTelemetryContext,
      TelemetryAttributes,
      spans,
    } = await setup();

    const handler = withRequestTelemetryContext(withTelemetry(makeTool()).handler as any, {
      loginSession: "login-a",
    });
    await handler({}, { sessionId: "sess-1" });

    expect(spans[0].attributes[TelemetryAttributes.LOGIN_SESSION]).toBe("login-a");
    expect(spans[0].attributes[TelemetryAttributes.MCP_SESSION_ID]).toBe("sess-1");
  });

  it("omits every attribute when no host attached a carrier", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();

    await withTelemetry(makeTool()).handler({} as any, {} as any);

    expect(spans[0].attributes).not.toHaveProperty(TelemetryAttributes.TENANT);
    expect(spans[0].attributes).not.toHaveProperty(TelemetryAttributes.REGION);
    expect(spans[0].attributes).not.toHaveProperty(TelemetryAttributes.LOGIN_SESSION);
  });

  it("omits the individual attributes whose values are missing", async () => {
    // A self-hosted site has no region; an unauthenticated probe has no login.
    // Neither may show up as an empty string — absent has to stay absent.
    const {
      withTelemetry,
      withRequestTelemetryContext,
      TelemetryAttributes,
      spans,
    } = await setup();

    const handler = withRequestTelemetryContext(withTelemetry(makeTool()).handler as any, {
      tenant: "hash-a",
    });
    await handler({}, {});

    expect(spans[0].attributes[TelemetryAttributes.TENANT]).toBe("hash-a");
    expect(spans[0].attributes).not.toHaveProperty(TelemetryAttributes.REGION);
    expect(spans[0].attributes).not.toHaveProperty(TelemetryAttributes.LOGIN_SESSION);
  });

  it("still records the session id for a tool that declares no input schema", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();

    // The one-argument shape the MCP SDK uses for a no-argument tool.
    await (withTelemetry(makeTool()).handler as any)({ sessionId: "sess-1" });

    expect(spans[0].attributes[TelemetryAttributes.MCP_SESSION_ID]).toBe("sess-1");
  });

  it("never lets two interleaved calls cross-contaminate attribution", async () => {
    // The regression this whole design exists to prevent. Two "requests"
    // share one isolate — one module-scoped adapter, one module graph — and
    // suspend inside their handlers so their lifetimes overlap. Each span must
    // still carry its own tenant and login.
    const {
      withTelemetry,
      withRequestTelemetryContext,
      TelemetryAttributes,
      spans,
    } = await setup();

    const gate: Array<() => void> = [];
    const decorated = withTelemetry(
      makeTool({
        handler: async () =>
          new Promise((resolve) => {
            gate.push(() => resolve({ content: [{ type: "text", text: "ok" }] }));
          }),
      })
    ).handler as any;

    const requestA = withRequestTelemetryContext(decorated, {
      tenant: "hash-a",
      region: "euwest01",
      loginSession: "login-a",
    });
    const requestB = withRequestTelemetryContext(decorated, {
      tenant: "hash-b",
      region: "uksouth01",
      loginSession: "login-b",
    });

    // Both in flight before either finishes, and resolved out of order.
    const inFlightA = requestA({}, { sessionId: "sess-a" });
    const inFlightB = requestB({}, { sessionId: "sess-b" });
    expect(gate).toHaveLength(2);
    gate[1]();
    gate[0]();
    await Promise.all([inFlightA, inFlightB]);

    const spanA = spans.find(
      (s) => s.attributes[TelemetryAttributes.MCP_SESSION_ID] === "sess-a"
    );
    const spanB = spans.find(
      (s) => s.attributes[TelemetryAttributes.MCP_SESSION_ID] === "sess-b"
    );

    expect(spanA?.attributes[TelemetryAttributes.TENANT]).toBe("hash-a");
    expect(spanA?.attributes[TelemetryAttributes.REGION]).toBe("euwest01");
    expect(spanA?.attributes[TelemetryAttributes.LOGIN_SESSION]).toBe("login-a");

    expect(spanB?.attributes[TelemetryAttributes.TENANT]).toBe("hash-b");
    expect(spanB?.attributes[TelemetryAttributes.REGION]).toBe("uksouth01");
    expect(spanB?.attributes[TelemetryAttributes.LOGIN_SESSION]).toBe("login-b");
  });
});

describe("getRequestTelemetryContext", () => {
  it("returns undefined for a context that carries nothing", async () => {
    const { getRequestTelemetryContext } = await setup();

    expect(getRequestTelemetryContext(undefined)).toBeUndefined();
    expect(getRequestTelemetryContext(null)).toBeUndefined();
    expect(getRequestTelemetryContext("not-an-object")).toBeUndefined();
    expect(getRequestTelemetryContext({})).toBeUndefined();
  });
});
