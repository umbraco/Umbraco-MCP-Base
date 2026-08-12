/**
 * Telemetry Decorator Tests
 *
 * Three things are being protected here:
 * 1. Telemetry never changes what the caller sees — same result, same error.
 * 2. Outcomes are classified consistently with `withErrorHandling`.
 * 3. Nothing sensitive reaches a span. That's the deny-list test near the
 *    bottom, and it's the one that has to keep passing.
 */

import { jest, describe, it, expect } from "@jest/globals";

interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
}

/**
 * Fresh module graph per test, then a recording adapter installed into it.
 * Everything must come from the same `import()` batch so the decorator and the
 * adapter registry are the same module instances.
 */
async function setup() {
  jest.resetModules();

  const telemetry = await import("../index.js");
  const decorators = await import("../../helpers/tool-decorators.js");
  const { ToolValidationError } = await import("../../helpers/tool-validation-error.js");
  const { UmbracoApiError } = await import("../../helpers/api-call-helpers.js");
  const { configureDryRunMode } = await import("../../helpers/dry-run.js");

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

  return {
    ...telemetry,
    ...decorators,
    ToolValidationError,
    UmbracoApiError,
    configureDryRunMode,
    spans,
  };
}

function makeTool(overrides: Record<string, unknown> = {}) {
  return {
    name: "get-thing",
    description: "test tool",
    slices: ["read"],
    annotations: { readOnlyHint: true },
    handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    ...overrides,
  } as any;
}

describe("withTelemetry", () => {
  it("returns the handler's result untouched", async () => {
    const { withTelemetry } = await setup();
    const expected = { content: [{ type: "text", text: "payload" }] };

    const wrapped = withTelemetry(makeTool({ handler: async () => expected }));
    const result = await wrapped.handler({} as any, {} as any);

    expect(result).toBe(expected);
  });

  it("names the span after the MCP method and tool", async () => {
    const { withTelemetry, spans } = await setup();

    await withTelemetry(makeTool()).handler({} as any, {} as any);

    expect(spans[0].name).toBe("tools/call get-thing");
  });

  it("records tool-scoped attributes", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();

    const tool = makeTool({
      name: "delete-thing",
      slices: ["delete", "other"],
      annotations: { destructiveHint: true },
    });
    await withTelemetry(tool).handler({} as any, {} as any);

    expect(spans[0].attributes).toMatchObject({
      [TelemetryAttributes.MCP_METHOD_NAME]: "tools/call",
      [TelemetryAttributes.GEN_AI_TOOL_NAME]: "delete-thing",
      [TelemetryAttributes.SLICES]: "delete,other",
      [TelemetryAttributes.READ_ONLY]: false,
      [TelemetryAttributes.DESTRUCTIVE]: true,
    });
  });

  it("omits the slices attribute when a tool declares none", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();

    await withTelemetry(makeTool({ slices: [] })).handler({} as any, {} as any);

    expect(spans[0].attributes).not.toHaveProperty(TelemetryAttributes.SLICES);
  });

  it("records the collection once the host has registered it", async () => {
    const { withTelemetry, registerToolCollection, TelemetryAttributes, spans } = await setup();
    registerToolCollection("get-thing", "document");

    await withTelemetry(makeTool()).handler({} as any, {} as any);

    expect(spans[0].attributes[TelemetryAttributes.COLLECTION]).toBe("document");
  });

  it("omits the collection when the host never registered one", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();

    await withTelemetry(makeTool()).handler({} as any, {} as any);

    expect(spans[0].attributes).not.toHaveProperty(TelemetryAttributes.COLLECTION);
  });

  it("records the session id from the handler context", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();

    await withTelemetry(makeTool()).handler({} as any, { sessionId: "sess-123" } as any);

    expect(spans[0].attributes[TelemetryAttributes.MCP_SESSION_ID]).toBe("sess-123");
  });

  it("omits the session id when the transport supplies none", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();

    await withTelemetry(makeTool()).handler({} as any, {} as any);

    expect(spans[0].attributes).not.toHaveProperty(TelemetryAttributes.MCP_SESSION_ID);
  });

  it("flags calls made while dry-run mode is active", async () => {
    const { withTelemetry, configureDryRunMode, TelemetryAttributes, spans } = await setup();
    configureDryRunMode(true);

    try {
      await withTelemetry(makeTool()).handler({} as any, {} as any);
      expect(spans[0].attributes[TelemetryAttributes.DRY_RUN]).toBe(true);
    } finally {
      configureDryRunMode(false);
    }
  });
});

describe("withTelemetry outcome classification", () => {
  it("records success for a normal result", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();

    await withTelemetry(makeTool()).handler({} as any, {} as any);

    expect(spans[0].attributes[TelemetryAttributes.OUTCOME]).toBe("success");
  });

  it("records error_result when the handler returns isError instead of throwing", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();
    // withPreExecutionCheck does this when a version mismatch blocks execution.
    const tool = makeTool({
      handler: async () => ({ content: [{ type: "text", text: "blocked" }], isError: true }),
    });

    await withTelemetry(tool).handler({} as any, {} as any);

    expect(spans[0].attributes[TelemetryAttributes.OUTCOME]).toBe("error_result");
  });

  it("records validation_error for a ToolValidationError", async () => {
    const { withTelemetry, ToolValidationError, TelemetryAttributes, spans } = await setup();
    const tool = makeTool({
      handler: async () => {
        throw new ToolValidationError({ title: "Bad input", detail: "id is required" });
      },
    });

    await expect(withTelemetry(tool).handler({} as any, {} as any)).rejects.toThrow();

    expect(spans[0].attributes[TelemetryAttributes.OUTCOME]).toBe("validation_error");
  });

  it("records api_error for an UmbracoApiError", async () => {
    const { withTelemetry, UmbracoApiError, TelemetryAttributes, spans } = await setup();
    const tool = makeTool({
      handler: async () => {
        throw new UmbracoApiError({ title: "Not Found", status: 404, detail: "no such node" });
      },
    });

    await expect(withTelemetry(tool).handler({} as any, {} as any)).rejects.toThrow();

    expect(spans[0].attributes[TelemetryAttributes.OUTCOME]).toBe("api_error");
  });

  it("records api_error for an error carrying a response body", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();
    const httpError = Object.assign(new Error("Request failed"), {
      response: { data: { title: "Conflict" } },
    });
    const tool = makeTool({
      handler: async () => {
        throw httpError;
      },
    });

    await expect(withTelemetry(tool).handler({} as any, {} as any)).rejects.toThrow();

    expect(spans[0].attributes[TelemetryAttributes.OUTCOME]).toBe("api_error");
  });

  it("records handler_error for any other Error", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();
    const tool = makeTool({
      handler: async () => {
        throw new Error("socket hang up");
      },
    });

    await expect(withTelemetry(tool).handler({} as any, {} as any)).rejects.toThrow();

    expect(spans[0].attributes[TelemetryAttributes.OUTCOME]).toBe("handler_error");
  });

  it("records unknown_error when a non-Error is thrown", async () => {
    const { withTelemetry, TelemetryAttributes, spans } = await setup();
    const tool = makeTool({
      handler: async () => {
        throw "just a string";
      },
    });

    await expect(withTelemetry(tool).handler({} as any, {} as any)).rejects.toBeDefined();

    expect(spans[0].attributes[TelemetryAttributes.OUTCOME]).toBe("unknown_error");
  });

  it("rethrows the original error object, not a copy", async () => {
    const { withTelemetry } = await setup();
    const original = new Error("original");
    const tool = makeTool({
      handler: async () => {
        throw original;
      },
    });

    await expect(withTelemetry(tool).handler({} as any, {} as any)).rejects.toBe(original);
  });
});

describe("withTelemetry resilience", () => {
  it("still runs the tool when the adapter throws before reaching the handler", async () => {
    jest.resetModules();
    const telemetry = await import("../index.js");
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    telemetry.setTelemetryAdapter({
      startSpan: () => {
        throw new Error("exporter misconfigured");
      },
    });

    const handler = jest.fn(async () => ({ content: [{ type: "text", text: "ran anyway" }] }));
    const wrapped = telemetry.withTelemetry(makeTool({ handler }));

    // Broken telemetry must not become a broken tool.
    const result = await wrapped.handler({} as any, {} as any);

    expect(handler).toHaveBeenCalled();
    expect(result).toEqual({ content: [{ type: "text", text: "ran anyway" }] });
    consoleError.mockRestore();
  });
});

describe("withTelemetry privacy", () => {
  it("never records arguments, results or error messages", async () => {
    const { withTelemetry, spans } = await setup();

    const secretArg = "super-secret-node-name";
    const secretMessage = "failed for /Users/someone/site with id 1234-abcd";
    const tool = makeTool({
      handler: async () => {
        throw new Error(secretMessage);
      },
    });

    await expect(
      withTelemetry(tool).handler({ name: secretArg } as any, {} as any)
    ).rejects.toThrow();

    // Assert on the serialised span rather than key-by-key, so an attribute
    // added later is covered by this test without anyone remembering to update it.
    const serialised = JSON.stringify(spans[0]);
    expect(serialised).not.toContain(secretArg);
    expect(serialised).not.toContain(secretMessage);
    expect(serialised).not.toContain("/Users/someone");
    expect(serialised).not.toContain("1234-abcd");
  });
});

describe("withStandardDecorators integration", () => {
  it("emits a span for a tool wrapped by the standard chain", async () => {
    const { withStandardDecorators, spans } = await setup();

    await withStandardDecorators(makeTool()).handler({} as any, {} as any);

    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("tools/call get-thing");
  });

  it("classifies the outcome even though withErrorHandling swallows the throw", async () => {
    const { withStandardDecorators, TelemetryAttributes, spans } = await setup();
    const tool = makeTool({
      handler: async () => {
        throw new Error("boom");
      },
    });

    // withErrorHandling is outermost, so the caller gets a result rather than a
    // rejection. The span must still say the call failed — that ordering is the
    // whole reason telemetry sits inside it.
    const result: any = await withStandardDecorators(tool).handler({} as any, {} as any);

    expect(result.isError).toBe(true);
    expect(spans[0].attributes[TelemetryAttributes.OUTCOME]).toBe("handler_error");
  });
});
