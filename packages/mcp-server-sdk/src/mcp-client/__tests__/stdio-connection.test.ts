/**
 * Stdio Connection Tests
 *
 * Covers the child env TLS guard and logging a child's stderr when it exits
 * during startup (umbraco/Umbraco-MCP-Base#449). The child processes here are
 * plain `node -e` scripts, so they are quick enough for the parallel suite.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { StdioConnection, buildChildEnv } from "../stdio-connection.js";

describe("buildChildEnv", () => {
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("drops NODE_TLS_REJECT_UNAUTHORIZED=0 with a warning for a remote base URL", () => {
    const env = buildChildEnv(
      "cms",
      { NODE_TLS_REJECT_UNAUTHORIZED: "0", UMBRACO_BASE_URL: "https://example.umbraco.io" },
      {},
    );

    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(env.UMBRACO_BASE_URL).toBe("https://example.umbraco.io");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("NODE_TLS_REJECT_UNAUTHORIZED=0");
    expect(String(errorSpy.mock.calls[0][0])).toContain('"cms"');
  });

  it("uses the parent's UMBRACO_BASE_URL when the config does not set one", () => {
    const env = buildChildEnv(
      "cms",
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { UMBRACO_BASE_URL: "https://example.umbraco.io" },
    );

    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the flag when no base URL is known (the child's own guard decides)", () => {
    const env = buildChildEnv("cms", { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, {});

    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("uses --umbraco-base-url in args over the env, as the child's config does", () => {
    const env = buildChildEnv(
      "cms",
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { UMBRACO_BASE_URL: "https://example.umbraco.io" },
      ["dist/index.js", "--umbraco-base-url", "https://localhost:44391"],
    );

    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("drops the flag for a remote --umbraco-base-url=value in args", () => {
    const env = buildChildEnv(
      "cms",
      { NODE_TLS_REJECT_UNAUTHORIZED: "0", UMBRACO_BASE_URL: "https://localhost:44391" },
      {},
      ["--umbraco-base-url=https://example.umbraco.io"],
    );

    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(String(errorSpy.mock.calls[0][0])).toContain("https://example.umbraco.io");
  });

  it("keeps the flag for a loopback base URL", () => {
    const env = buildChildEnv(
      "cms",
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      { UMBRACO_BASE_URL: "https://localhost:44391" },
    );

    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does not treat a localhost-prefixed remote host as local", () => {
    const env = buildChildEnv(
      "cms",
      { NODE_TLS_REJECT_UNAUTHORIZED: "0", UMBRACO_BASE_URL: "https://localhost.example.com" },
      {},
    );

    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("leaves the parent's own value alone (only the config override is guarded)", () => {
    const env = buildChildEnv(
      "cms",
      { UMBRACO_BASE_URL: "https://example.umbraco.io" },
      { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    );

    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("still lets config env override other parent values", () => {
    const env = buildChildEnv("cms", { FOO: "child" }, { FOO: "parent", BAR: "kept" });

    expect(env).toMatchObject({ FOO: "child", BAR: "kept" });
  });
});

describe("StdioConnection when the child exits during startup", () => {
  let stderrSpy: jest.SpiedFunction<typeof process.stderr.write>;
  let errorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    stderrSpy = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const connectError = (connection: StdioConnection) =>
    connection.connect().then(
      () => undefined,
      (e: unknown) => e as Error,
    );

  const logged = () => errorSpy.mock.calls.map((c) => String(c[0])).join("\n");

  it("logs the child's stderr tail for the operator but keeps it out of the error", async () => {
    const connection = new StdioConnection({
      name: "failing",
      command: process.execPath,
      args: [
        "-e",
        "process.stderr.write('Refusing to start: secret-token-abc\\n'); process.exit(1);",
      ],
    });

    const error = await connectError(connection);

    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain("Connection closed");
    expect(error!.message).toContain('Chained server "failing" exited');
    expect(error!.message).toContain("See the MCP server's logs");
    expect(error!.message).not.toContain("secret-token-abc");

    expect(logged()).toContain('Chained server "failing" exited');
    expect(logged()).toContain("Refusing to start: secret-token-abc");

    const forwarded = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(forwarded).toContain("Refusing to start: secret-token-abc");

    await connection.close();
  });

  it("logs only a bounded tail of the child's stderr", async () => {
    const connection = new StdioConnection({
      name: "noisy",
      command: process.execPath,
      args: [
        "-e",
        "process.stderr.write('HEAD' + 'x'.repeat(10000) + 'TAIL'); process.exit(1);",
      ],
    });

    await connectError(connection);

    const exitLog = errorSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('Chained server "noisy" exited'));
    expect(exitLog).toContain("TAIL");
    expect(exitLog).not.toContain("HEAD");
    expect(exitLog!.length).toBeLessThan(4096 + 500);

    await connection.close();
  });
});
