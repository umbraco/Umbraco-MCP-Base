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

  describe("UmbracoApiError by status", () => {
    const outcomeFor = async (problem: Record<string, unknown>) => {
      const { withTelemetry, UmbracoApiError, TelemetryAttributes, spans } = await setup();
      const tool = makeTool({
        handler: async () => {
          throw new UmbracoApiError(problem as any);
        },
      });
      await expect(withTelemetry(tool).handler({} as any, {} as any)).rejects.toThrow();
      return spans[0].attributes[TelemetryAttributes.OUTCOME];
    };
    const errors = { Name: ["Name is required"] };

    it.each([400, 422])("records validation_error for %i with validation errors", async (status) => {
      expect(await outcomeFor({ title: "Bad", status, errors })).toBe("validation_error");
    });

    it("records client_error for 400 without validation errors", async () => {
      expect(await outcomeFor({ title: "Bad Request", status: 400 })).toBe("client_error");
      expect(await outcomeFor({ title: "Bad Request", status: 400, errors: {} })).toBe("client_error");
    });

    it("records client_error for 404", async () => {
      expect(await outcomeFor({ title: "Not Found", status: 404 })).toBe("client_error");
    });

    it("records client_error for 409", async () => {
      expect(await outcomeFor({ title: "Conflict", status: 409 })).toBe("client_error");
    });

    it.each([401, 403])("keeps api_error for %i so operators see auth problems", async (status) => {
      expect(await outcomeFor({ title: "Denied", status })).toBe("api_error");
    });

    it("records api_error for 500", async () => {
      expect(await outcomeFor({ title: "Server Error", status: 500 })).toBe("api_error");
    });

    it("records api_error when there is no status", async () => {
      expect(await outcomeFor({ title: "Mystery" })).toBe("api_error");
    });
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

describe("withTelemetry error details", () => {
  // The handler factory receives the same module graph the decorator runs in,
  // so `instanceof` checks against the error classes hold.
  const run = async (makeHandler: (ctx: Awaited<ReturnType<typeof setup>>) => () => Promise<unknown>) => {
    const ctx = await setup();
    const wrapped = ctx.withTelemetry(makeTool({ handler: makeHandler(ctx) }));
    await Promise.resolve(wrapped.handler({} as any, {} as any)).catch(() => {});
    return { ...ctx, attrs: ctx.spans[0].attributes };
  };
  const errorResult = (text: string) => async () => ({
    content: [{ type: "text", text }],
    isError: true,
  });

  it("records title and status for a thrown UmbracoApiError", async () => {
    const { attrs, TelemetryAttributes } = await run((ctx) => async () => {
      throw new ctx.UmbracoApiError({ title: "Not Found", status: 404, detail: "x" });
    });

    expect(attrs[TelemetryAttributes.ERROR_TITLE]).toBe("Not Found");
    expect(attrs[TelemetryAttributes.ERROR_STATUS]).toBe(404);
  });

  it("falls back to the class name for an UmbracoApiError with a non-JSON body", async () => {
    const { attrs, TelemetryAttributes } = await run((ctx) => async () => {
      throw new ctx.UmbracoApiError("<html>502 Bad Gateway</html>" as any);
    });

    expect(attrs[TelemetryAttributes.OUTCOME]).toBe("api_error");
    expect(attrs[TelemetryAttributes.ERROR_TITLE]).toBe("UmbracoApiError");
    expect(JSON.stringify(attrs)).not.toContain("Bad Gateway");
  });

  it("reads operationStatus from a ToolValidationError's extensions", async () => {
    const { attrs, TelemetryAttributes } = await run((ctx) => async () => {
      throw new ctx.ToolValidationError({
        title: "Bad input",
        detail: "x",
        extensions: { operationStatus: "DuplicateName" },
      });
    });

    expect(attrs[TelemetryAttributes.ERROR_OPERATION_STATUS]).toBe("DuplicateName");
  });

  it("records attributes on both spans of a nested chained call", async () => {
    const ctx = await setup();
    const problem = JSON.stringify({ title: "Not Found", status: 404, operationStatus: "NotFound" });
    const inner = ctx.withTelemetry(
      makeTool({
        name: "inner",
        handler: async () => ({ content: [{ type: "text", text: problem }], isError: true }),
      })
    );
    const outer = ctx.withTelemetry(
      makeTool({
        name: "outer",
        // Re-wraps the inner tool's returned error, as a chained proxy does.
        handler: async () => inner.handler({} as any, {} as any),
      })
    );
    await outer.handler({} as any, {} as any);

    expect(ctx.spans).toHaveLength(2);
    for (const span of ctx.spans) {
      expect(span.attributes[ctx.TelemetryAttributes.ERROR_TITLE]).toBe("Not Found");
      expect(span.attributes[ctx.TelemetryAttributes.ERROR_STATUS]).toBe(404);
      expect(span.attributes[ctx.TelemetryAttributes.ERROR_OPERATION_STATUS]).toBe("NotFound");
    }
  });

  it("records the title of a thrown ToolValidationError", async () => {
    const { attrs, TelemetryAttributes } = await run((ctx) => async () => {
      throw new ctx.ToolValidationError({ title: "Bad input", detail: "id is required" });
    });

    expect(attrs[TelemetryAttributes.ERROR_TITLE]).toBe("Bad input");
  });

  it("falls back to the class name and HTTP status for an error with response data", async () => {
    const { attrs, TelemetryAttributes } = await run(() => async () => {
      throw Object.assign(new TypeError("boom"), { response: { status: 409, data: {} } });
    });

    expect(attrs[TelemetryAttributes.ERROR_TITLE]).toBe("TypeError");
    expect(attrs[TelemetryAttributes.ERROR_STATUS]).toBe(409);
  });

  it("parses a returned isError result carrying problem JSON (chained 400)", async () => {
    const { attrs, TelemetryAttributes } = await run(() =>
      errorResult(
        JSON.stringify({ title: "Validation failed", status: 400, operationStatus: "DuplicateName" })
      )
    );

    expect(attrs[TelemetryAttributes.OUTCOME]).toBe("error_result");
    expect(attrs[TelemetryAttributes.ERROR_STATUS]).toBe(400);
    expect(attrs[TelemetryAttributes.ERROR_TITLE]).toBe("Validation failed");
    expect(attrs[TelemetryAttributes.ERROR_OPERATION_STATUS]).toBe("DuplicateName");
  });

  it("records only the outcome for non-JSON result text", async () => {
    const { attrs, TelemetryAttributes } = await run(() => errorResult("blocked: version mismatch"));

    expect(attrs[TelemetryAttributes.OUTCOME]).toBe("error_result");
    expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_TITLE);
    expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_STATUS);
    expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_OPERATION_STATUS);
  });

  it("caps over-length values at 100 characters", async () => {
    const { attrs, TelemetryAttributes } = await run(() =>
      errorResult(JSON.stringify({ title: "t".repeat(500), status: 400 }))
    );

    expect(attrs[TelemetryAttributes.ERROR_TITLE]).toBe("t".repeat(100));
  });

  it("drops an operationStatus that is not an enum-style name", async () => {
    const { attrs, TelemetryAttributes } = await run(() =>
      errorResult(JSON.stringify({ title: "x", status: 400, operationStatus: "not ok: 1234" }))
    );

    expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_OPERATION_STATUS);
  });

  it("skips wrong-typed fields", async () => {
    const { attrs, TelemetryAttributes } = await run(() =>
      errorResult(JSON.stringify({ title: 42, status: "400", operationStatus: 7 }))
    );

    expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_TITLE);
    expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_STATUS);
    expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_OPERATION_STATUS);
  });

  it("sets no error attributes on a successful result that looks like problem JSON", async () => {
    const { attrs, TelemetryAttributes } = await run(() => async () => ({
      content: [
        { type: "text", text: JSON.stringify({ title: "Home", status: 200, operationStatus: "Ok" }) },
      ],
    }));

    expect(attrs[TelemetryAttributes.OUTCOME]).toBe("success");
    expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_TITLE);
    expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_STATUS);
    expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_OPERATION_STATUS);
  });

  it("reads problem fields from response.data on a generic Error, ahead of the fallbacks", async () => {
    const { attrs, TelemetryAttributes } = await run(() => async () => {
      throw Object.assign(new Error("m"), {
        response: {
          status: 500,
          data: { title: "Conflict", status: 409, operationStatus: "DuplicateName" },
        },
      });
    });

    expect(attrs[TelemetryAttributes.ERROR_TITLE]).toBe("Conflict");
    expect(attrs[TelemetryAttributes.ERROR_STATUS]).toBe(409);
    expect(attrs[TelemetryAttributes.ERROR_OPERATION_STATUS]).toBe("DuplicateName");
  });

  it("falls back to the class name when response.data is not an object", async () => {
    const { attrs, TelemetryAttributes } = await run(() => async () => {
      throw Object.assign(new Error("m"), { response: { data: "<html>bad gateway</html>" } });
    });

    expect(attrs[TelemetryAttributes.ERROR_TITLE]).toBe("Error");
  });

  it("drops operationStatus values that merely resemble enum names", async () => {
    for (const bad of ["", "Invalid2", "Dup_Name", "Name\n"]) {
      const { attrs, TelemetryAttributes } = await run(() =>
        errorResult(JSON.stringify({ title: "x", status: 400, operationStatus: bad }))
      );
      expect(attrs).not.toHaveProperty(TelemetryAttributes.ERROR_OPERATION_STATUS);
    }
  });

  it("caps operationStatus at 100 characters", async () => {
    const { attrs, TelemetryAttributes } = await run(() =>
      errorResult(JSON.stringify({ operationStatus: "A".repeat(150) }))
    );

    expect(attrs[TelemetryAttributes.ERROR_OPERATION_STATUS]).toBe("A".repeat(100));
  });

  it("never lets a malformed error object change what the caller sees", async () => {
    const { withTelemetry, UmbracoApiError } = await setup();
    // Bypass the constructor: the type promises problemDetails, the runtime may not.
    const broken = Object.assign(Object.create(UmbracoApiError.prototype), {
      problemDetails: undefined,
    });
    const wrapped = withTelemetry(
      makeTool({
        handler: async () => {
          throw broken;
        },
      })
    );

    await expect(wrapped.handler({} as any, {} as any)).rejects.toBe(broken);
  });

  it("never exports detail, type or argument values", async () => {
    const ctx = await setup();
    const uuid = "3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b11";
    const secretArg = "super-secret-argument";
    const problem = {
      title: "Bad request",
      status: 400,
      operationStatus: "InvalidId",
      type: "https://example.test/problems/secret-type",
      detail: `Invalid UUID. Received: '${uuid}'`,
    };

    await ctx
      .withTelemetry(makeTool({ handler: errorResult(JSON.stringify(problem)) }))
      .handler({ name: secretArg } as any, {} as any);
    const throwing = ctx.withTelemetry(
      makeTool({
        handler: async () => {
          throw new ctx.UmbracoApiError(problem);
        },
      })
    );
    await Promise.resolve(throwing.handler({ name: secretArg } as any, {} as any)).catch(() => {});

    const generic = ctx.withTelemetry(
      makeTool({
        handler: async () => {
          throw Object.assign(new Error(`failed for ${uuid} ${secretArg}`), {
            response: { data: problem },
          });
        },
      })
    );
    await Promise.resolve(generic.handler({ name: secretArg } as any, {} as any)).catch(() => {});

    expect(ctx.spans).toHaveLength(3);
    for (const span of ctx.spans) {
      expect(span.attributes[ctx.TelemetryAttributes.ERROR_TITLE]).toBe("Bad request");
      const serialised = JSON.stringify(span);
      expect(serialised).not.toContain(uuid);
      expect(serialised).not.toContain(secretArg);
      expect(serialised).not.toContain("secret-type");
    }
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
