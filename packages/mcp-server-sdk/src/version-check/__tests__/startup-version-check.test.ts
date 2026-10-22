/**
 * Tests for the shared stdio startup guard (umbraco/Umbraco-MCP-Base#428):
 * `resolveExpectedUmbracoMajor`, `runStartupVersionCheck` (deadline, hook,
 * skip switch, never throws) and `withVersionCheckDeadline`.
 */
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { z } from "zod";
import { VersionCheckService, type VersionCheckClient } from "../check-umbraco-version.js";
import {
  resolveExpectedUmbracoMajor,
  runStartupVersionCheck,
  withVersionCheckDeadline,
  SKIP_VERSION_CHECK_ENV,
  DEFAULT_VERSION_CHECK_TIMEOUT_MS,
} from "../startup-version-check.js";
import { configurePreExecutionHook, withStandardDecorators } from "../../helpers/tool-decorators.js";
import type { ToolDefinition } from "../../types/tool-definition.js";

type ServerInfo = { version: string };

function clientReturning(version: string) {
  const getServerInformation = jest
    .fn<(options?: { signal?: AbortSignal }) => Promise<ServerInfo>>()
    .mockResolvedValue({ version });
  return { client: { getServerInformation } satisfies VersionCheckClient, getServerInformation };
}

function decoratedTool() {
  const handler = jest
    .fn<() => Promise<{ content: { type: "text"; text: string }[] }>>()
    .mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  const tool: ToolDefinition<any, any> = {
    name: "test-tool",
    description: "test tool",
    inputSchema: { name: z.string().optional() },
    slices: [],
    handler: handler as any,
  };
  return { decorated: withStandardDecorators(tool), handler };
}

const callTool = (decorated: ToolDefinition<any, any>) => decorated.handler({}, {} as any) as Promise<any>;

const savedSkip = process.env[SKIP_VERSION_CHECK_ENV];
let errorSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  delete process.env[SKIP_VERSION_CHECK_ENV];
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  configurePreExecutionHook(() => undefined);
  if (savedSkip === undefined) delete process.env[SKIP_VERSION_CHECK_ENV];
  else process.env[SKIP_VERSION_CHECK_ENV] = savedSkip;
});

describe("resolveExpectedUmbracoMajor", () => {
  it("uses a non-blank override", () => {
    expect(resolveExpectedUmbracoMajor("18", "17")).toBe("18");
  });

  it("trims the override", () => {
    expect(resolveExpectedUmbracoMajor("  18 ", "17")).toBe("18");
  });

  it.each([[""], ["  "], ["\t\n"], [undefined], [null]])("falls back to the generated major for %j", (override) => {
    expect(resolveExpectedUmbracoMajor(override, "17")).toBe("17");
  });

  it("returns undefined when neither is set", () => {
    expect(resolveExpectedUmbracoMajor(" ", undefined)).toBeUndefined();
  });
});

describe("runStartupVersionCheck", () => {
  it("on a mismatch blocks the first decorated call once, then a retry succeeds", async () => {
    const service = new VersionCheckService();
    const { client } = clientReturning("17.3.1");

    const message = await runStartupVersionCheck({
      generatedUmbracoMajor: "18",
      mcpVersion: "1.0.0",
      client,
      service,
    });

    expect(message).toMatch(/Version Mismatch/);
    const { decorated, handler } = decoratedTool();

    const first = await callTool(decorated);
    expect(first.isError).toBe(true);
    expect(JSON.stringify(first)).toMatch(/Version Mismatch/);
    expect(handler).not.toHaveBeenCalled();

    const second = await callTool(decorated);
    expect(second.isError).toBeFalsy();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("passes a signal to the client", async () => {
    const { client, getServerInformation } = clientReturning("17.0.0");

    await runStartupVersionCheck({
      generatedUmbracoMajor: "17",
      mcpVersion: "1.0.0",
      client,
      service: new VersionCheckService(),
    });

    expect(getServerInformation).toHaveBeenCalledTimes(1);
    expect(getServerInformation.mock.calls[0]?.[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("on a match returns null and blocks nothing", async () => {
    const { client } = clientReturning("17.0.0");

    const message = await runStartupVersionCheck({
      generatedUmbracoMajor: "17",
      mcpVersion: "1.0.0",
      client,
      service: new VersionCheckService(),
    });

    expect(message).toBeNull();
    const { decorated, handler } = decoratedTool();
    await callTool(decorated);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("with an unreachable CMS returns a warning and blocks nothing", async () => {
    const client: VersionCheckClient = {
      getServerInformation: jest.fn<() => Promise<ServerInfo>>().mockRejectedValue(new Error("fetch failed")),
    };

    const message = await runStartupVersionCheck({
      generatedUmbracoMajor: "17",
      mcpVersion: "1.0.0",
      client,
      service: new VersionCheckService(),
    });

    expect(message).toContain("Unable to verify Umbraco version compatibility: fetch failed");
    const { decorated, handler } = decoratedTool();
    await callTool(decorated);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("resolves within the deadline for a client that ignores the signal, and blocks nothing", async () => {
    const client: VersionCheckClient = {
      getServerInformation: () => new Promise<ServerInfo>(() => {}),
    };

    const started = Date.now();
    const message = await runStartupVersionCheck({
      generatedUmbracoMajor: "17",
      mcpVersion: "1.0.0",
      client,
      timeoutMs: 50,
      service: new VersionCheckService(),
    });

    expect(Date.now() - started).toBeLessThan(2000);
    expect(message).toContain("Unable to verify Umbraco version compatibility");
    expect(message).toContain("did not respond within 50ms");
    const { decorated, handler } = decoratedTool();
    await callTool(decorated);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("aborts the signal it gave the client at the deadline", async () => {
    let received: AbortSignal | undefined;
    const client: VersionCheckClient = {
      getServerInformation: ({ signal } = {}) => {
        received = signal;
        return new Promise<ServerInfo>(() => {});
      },
    };

    await runStartupVersionCheck({
      generatedUmbracoMajor: "17",
      mcpVersion: "1.0.0",
      client,
      timeoutMs: 20,
      service: new VersionCheckService(),
    });

    expect(received?.aborted).toBe(true);
  });

  it("uses a non-blank override and falls back to the generated major for a blank one", async () => {
    const { client } = clientReturning("17.0.0");

    expect(
      await runStartupVersionCheck({
        expectedUmbracoMajorOverride: "18",
        generatedUmbracoMajor: "17",
        mcpVersion: "1.0.0",
        client,
        service: new VersionCheckService(),
      })
    ).toMatch(/Version Mismatch/);

    expect(
      await runStartupVersionCheck({
        expectedUmbracoMajorOverride: "   ",
        generatedUmbracoMajor: "17",
        mcpVersion: "1.0.0",
        client,
        service: new VersionCheckService(),
      })
    ).toBeNull();
  });

  it.each(["true", "TRUE", "True"])(
    "with %s=%s makes no request, arms no block and returns null",
    async (value) => {
      process.env[SKIP_VERSION_CHECK_ENV] = value;
      const { client, getServerInformation } = clientReturning("15.0.0");
      const service = new VersionCheckService();

      const message = await runStartupVersionCheck({
        generatedUmbracoMajor: "17",
        mcpVersion: "1.0.0",
        client,
        service,
      });

      expect(message).toBeNull();
      expect(getServerInformation).not.toHaveBeenCalled();
      expect(service.isBlocked()).toBe(false);
      const { decorated, handler } = decoratedTool();
      await callTool(decorated);
      expect(handler).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["false", "1", "yes", ""])("runs the check when the skip switch is %j", async (value) => {
    process.env[SKIP_VERSION_CHECK_ENV] = value;
    const { client, getServerInformation } = clientReturning("15.0.0");

    const message = await runStartupVersionCheck({
      generatedUmbracoMajor: "17",
      mcpVersion: "1.0.0",
      client,
      service: new VersionCheckService(),
    });

    expect(getServerInformation).toHaveBeenCalledTimes(1);
    expect(message).toMatch(/Version Mismatch/);
  });

  it("never throws", async () => {
    // A client whose method throws synchronously.
    const throwingClient = {
      getServerInformation: () => {
        throw new Error("boom");
      },
    } as unknown as VersionCheckClient;
    await expect(
      runStartupVersionCheck({
        generatedUmbracoMajor: "17",
        mcpVersion: "1.0.0",
        client: throwingClient,
        service: new VersionCheckService(),
      })
    ).resolves.toContain("boom");

    // A broken service, so the failure happens outside checkUmbracoVersion's own try/catch.
    const brokenService = {
      setMessage: () => {
        throw new Error("service exploded");
      },
      setBlocked: () => {
        throw new Error("service exploded");
      },
    } as unknown as VersionCheckService;
    await expect(
      runStartupVersionCheck({
        generatedUmbracoMajor: "17",
        mcpVersion: "1.0.0",
        client: clientReturning("15.0.0").client,
        service: brokenService,
      })
    ).resolves.toBeNull();

    // Garbage options.
    await expect(runStartupVersionCheck(undefined as any)).resolves.toBeNull();
    await expect(runStartupVersionCheck({ timeoutMs: -1 } as any)).resolves.toBeDefined();
  });

  it("defaults the deadline to 5 seconds", () => {
    expect(DEFAULT_VERSION_CHECK_TIMEOUT_MS).toBe(5000);
  });
});

describe("withVersionCheckDeadline", () => {
  it("resolves with the request's value when it beats the deadline", async () => {
    await expect(withVersionCheckDeadline(async () => "ok", 1000)).resolves.toBe("ok");
  });

  it("rejects at the deadline and aborts the signal", async () => {
    let received: AbortSignal | undefined;
    await expect(
      withVersionCheckDeadline((signal) => {
        received = signal;
        return new Promise(() => {});
      }, 10)
    ).rejects.toThrow("did not respond within 10ms");
    expect(received?.aborted).toBe(true);
  });
});
