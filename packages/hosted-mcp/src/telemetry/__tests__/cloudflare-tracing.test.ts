/**
 * Cloudflare Tracing Adapter Tests
 *
 * `tracing` is injected, so the whole adapter is exercisable in Node with a fake
 * — no `cloudflare:workers` resolution, no jest module mapping.
 */

import { jest, describe, it, expect } from "@jest/globals";
import {
  createCloudflareTracingAdapter,
  type CloudflareSpan,
  type CloudflareTracing,
} from "../cloudflare-tracing.js";

interface EnteredSpan {
  name: string;
  attributes: Record<string, unknown>;
}

/**
 * Stands in for `tracing` from `cloudflare:workers`, recording what a real span
 * would have received.
 */
function fakeTracing() {
  const entered: EnteredSpan[] = [];

  const tracing: CloudflareTracing = {
    enterSpan: (name, callback) => {
      const record: EnteredSpan = { name, attributes: {} };
      entered.push(record);
      const span: CloudflareSpan = {
        setAttribute(key, value) {
          record.attributes[key] = value;
        },
      };
      return callback(span);
    },
  };

  return { tracing, entered };
}

describe("createCloudflareTracingAdapter", () => {
  it("opens a span with the given name and returns the callback's result", async () => {
    const { tracing, entered } = fakeTracing();
    const adapter = createCloudflareTracingAdapter({ tracing });

    const result = await adapter.startSpan("tools/call get-thing", {}, async () => "handled");

    expect(result).toBe("handled");
    expect(entered).toHaveLength(1);
    expect(entered[0].name).toBe("tools/call get-thing");
  });

  it("writes the per-call attributes onto the span", async () => {
    const { tracing, entered } = fakeTracing();
    const adapter = createCloudflareTracingAdapter({ tracing });

    await adapter.startSpan(
      "tools/call get-thing",
      { "gen_ai.tool.name": "get-thing", "umbraco.mcp.read_only": true },
      async () => "ok"
    );

    expect(entered[0].attributes).toMatchObject({
      "gen_ai.tool.name": "get-thing",
      "umbraco.mcp.read_only": true,
    });
  });

  it("adds the configured static attributes to every span", async () => {
    const { tracing, entered } = fakeTracing();
    const adapter = createCloudflareTracingAdapter({
      tracing,
      attributes: { "umbraco.mcp.server.name": "test-mcp", "umbraco.mcp.server.version": "1.2.3" },
    });

    await adapter.startSpan("tools/call a", {}, async () => "ok");
    await adapter.startSpan("tools/call b", {}, async () => "ok");

    for (const span of entered) {
      expect(span.attributes["umbraco.mcp.server.name"]).toBe("test-mcp");
      expect(span.attributes["umbraco.mcp.server.version"]).toBe("1.2.3");
    }
  });

  it("lets per-call attributes win over static ones", async () => {
    const { tracing, entered } = fakeTracing();
    const adapter = createCloudflareTracingAdapter({
      tracing,
      attributes: { "umbraco.mcp.server.name": "static" },
    });

    await adapter.startSpan(
      "tools/call thing",
      { "umbraco.mcp.server.name": "per-call" },
      async () => "ok"
    );

    expect(entered[0].attributes["umbraco.mcp.server.name"]).toBe("per-call");
  });

  it("exposes a span the handler can add attributes to mid-call", async () => {
    const { tracing, entered } = fakeTracing();
    const adapter = createCloudflareTracingAdapter({ tracing });

    // This is how the SDK's decorator records the outcome once it knows it.
    await adapter.startSpan("tools/call thing", {}, async (span) => {
      span.setAttribute("umbraco.mcp.outcome", "success");
      return "ok";
    });

    expect(entered[0].attributes["umbraco.mcp.outcome"]).toBe("success");
  });

  it("propagates handler rejections unchanged", async () => {
    const { tracing } = fakeTracing();
    const adapter = createCloudflareTracingAdapter({ tracing });
    const boom = new Error("api exploded");

    await expect(
      adapter.startSpan("tools/call thing", {}, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
  });

  it("still records attributes set before a rejection", async () => {
    const { tracing, entered } = fakeTracing();
    const adapter = createCloudflareTracingAdapter({ tracing });

    await expect(
      adapter.startSpan("tools/call thing", {}, async (span) => {
        span.setAttribute("umbraco.mcp.outcome", "api_error");
        throw new Error("nope");
      })
    ).rejects.toThrow();

    expect(entered[0].attributes["umbraco.mcp.outcome"]).toBe("api_error");
  });

  it("returns the promise to enterSpan so the runtime can end the span on settle", async () => {
    // Cloudflare closes an enterSpan span when the callback's returned promise
    // settles. If the adapter awaited internally and returned a value instead,
    // the span would close early and lose the handler's duration.
    const enterSpan = jest.fn((_name: string, callback: (span: CloudflareSpan) => unknown) =>
      callback({ setAttribute() {} })
    );
    const adapter = createCloudflareTracingAdapter({
      tracing: { enterSpan } as unknown as CloudflareTracing,
    });

    const returned = adapter.startSpan("tools/call thing", {}, async () => "ok");

    expect(returned).toBeInstanceOf(Promise);
    expect(enterSpan.mock.results[0].value).toBeInstanceOf(Promise);
    await returned;
  });
});
