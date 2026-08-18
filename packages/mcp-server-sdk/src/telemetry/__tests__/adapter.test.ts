/**
 * Telemetry Adapter Tests
 *
 * Covers the registration seam and the pass-through default — the property that
 * makes instrumentation free for servers that never configure it.
 */

import { jest, describe, it, expect } from "@jest/globals";

// Fresh module state per test: the active adapter is module-scoped.
async function getAdapterModule() {
  jest.resetModules();
  return await import("../adapter.js");
}

describe("getTelemetryAdapter", () => {
  it("defaults to the pass-through adapter", async () => {
    const { getTelemetryAdapter, passThroughAdapter } = await getAdapterModule();
    expect(getTelemetryAdapter()).toBe(passThroughAdapter);
  });
});

describe("passThroughAdapter", () => {
  it("invokes the callback and returns its result", async () => {
    const { passThroughAdapter } = await getAdapterModule();

    const result = await passThroughAdapter.startSpan("tools/call thing", { a: 1 }, async () => "value");

    expect(result).toBe("value");
  });

  it("supplies a span whose setAttribute is a no-op", async () => {
    const { passThroughAdapter } = await getAdapterModule();

    // The point is that recording attributes on an unconfigured server neither
    // throws nor requires the caller to check first.
    const result = await passThroughAdapter.startSpan("tools/call thing", {}, async (span) => {
      span.setAttribute("umbraco.mcp.outcome", "success");
      return "ok";
    });

    expect(result).toBe("ok");
  });

  it("propagates rejections unchanged", async () => {
    const { passThroughAdapter } = await getAdapterModule();
    const boom = new Error("handler blew up");

    await expect(
      passThroughAdapter.startSpan("tools/call thing", {}, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
  });
});

describe("setTelemetryAdapter", () => {
  it("installs an adapter for subsequent lookups", async () => {
    const { setTelemetryAdapter, getTelemetryAdapter } = await getAdapterModule();
    const custom = { startSpan: async (_n: string, _a: any, fn: any) => fn({ setAttribute() {} }) };

    setTelemetryAdapter(custom);

    expect(getTelemetryAdapter()).toBe(custom);
  });
});

describe("clearTelemetryAdapter", () => {
  it("restores the pass-through adapter", async () => {
    const { setTelemetryAdapter, clearTelemetryAdapter, getTelemetryAdapter, passThroughAdapter } =
      await getAdapterModule();
    setTelemetryAdapter({ startSpan: async (_n, _a, fn) => fn({ setAttribute() {} }) });

    clearTelemetryAdapter();

    expect(getTelemetryAdapter()).toBe(passThroughAdapter);
  });
});
