/**
 * Tests for the orval target-major transformer.
 *
 * The transformer is the mechanism that guarantees every Umbraco MCP server has
 * a target major to give `checkUmbracoVersion` — discovered from the instance
 * the tools were generated against, not typed in by a human. See
 * umbraco/Umbraco-MCP-Base#220 for what the hand-maintained alternative cost.
 *
 * The spec's `info.version` cannot carry it: every Umbraco-served spec
 * hard-codes `"Latest"`. These tests pin both the instance lookup and the
 * refusal to fall back on a stale value.
 */

import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createUmbracoTargetMajorTransformer,
  renderTargetMajorModule,
  DEFAULT_TARGET_MAJOR_CONSTANT,
  SERVER_INFORMATION_PATH,
  type UmbracoTargetMajorOptions,
} from "../orval-target-major-writer.js";

/**
 * Configures the instance lookup the only way a consumer can: the three env
 * vars. There is deliberately no options-object equivalent, so tests drive the
 * same path production does.
 */
function setCredentials(baseUrl = "http://localhost:56472"): void {
  process.env.UMBRACO_BASE_URL = baseUrl;
  process.env.UMBRACO_CLIENT_ID = "umbraco-back-office-mcp";
  process.env.UMBRACO_CLIENT_SECRET = "shhh";
}

/**
 * Stubs the two-request instance lookup: client-credentials token, then
 * `server/information`. Returns the mock so tests can assert on the calls.
 */
function mockInstance(options: {
  /** `null` models a response body with no usable `version` field. */
  version?: string | null;
  tokenStatus?: number;
  infoStatus?: number;
}) {
  // A destructuring default fires only on `undefined`, so an explicit `null`
  // (a response body with no usable version) passes through untouched.
  const { version = "18.0.2", tokenStatus = 200, infoStatus = 200 } = options;

  const fetchMock = jest.fn(async (input: unknown) => {
    const url = String(input);

    if (url.includes("/token")) {
      return {
        ok: tokenStatus === 200,
        status: tokenStatus,
        statusText: "",
        json: async () => ({ access_token: "at", expires_in: 3600 }),
      };
    }

    return {
      ok: infoStatus === 200,
      status: infoStatus,
      statusText: "",
      json: async () => ({ version, assemblyVersion: version }),
    };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = fetchMock as any;
  return fetchMock;
}

describe("renderTargetMajorModule", () => {
  it("emits a do-not-edit banner and the exported constant", () => {
    const output = renderTargetMajorModule("17", DEFAULT_TARGET_MAJOR_CONSTANT, {
      version: "17.4.0",
    });

    expect(output).toContain("AUTO-GENERATED");
    expect(output).toContain("Do not edit by hand");
    expect(output).toContain("npm run generate");
    expect(output).toContain('export const UMBRACO_TARGET_MAJOR = "17";');
    // Traceability: the full version the major came from.
    expect(output).toContain("17.4.0");
  });

  it("records where the value came from, so a wrong one is diagnosable", () => {
    const render = (provenance: Parameters<typeof renderTargetMajorModule>[2]) =>
      renderTargetMajorModule("18", DEFAULT_TARGET_MAJOR_CONSTANT, provenance);

    expect(render({ version: "18.0.2", source: "instance" })).toContain(
      SERVER_INFORMATION_PATH
    );
    // A committed scaffold value must announce that nothing reported it.
    expect(render({ source: "placeholder" })).toContain("NOT reported by any Umbraco");
  });

  it("honours a custom constant name", () => {
    expect(renderTargetMajorModule("18", "MY_TARGET")).toContain(
      'export const MY_TARGET = "18";'
    );
  });

  it("rejects a constant name that is not a valid identifier", () => {
    // Would otherwise emit syntactically broken (or worse, injected) code.
    expect(() => renderTargetMajorModule("18", 'X = 1; const Y')).toThrow(
      /valid JavaScript identifier/
    );
  });

  // A version can come from a remotely-fetched spec or an instance response, so
  // it is untrusted input. Echoing it raw into the JSDoc block would let `*/`
  // close the comment early and inject code into a file that then gets compiled
  // and run.
  it.each([
    ["a comment breakout", "1.0.0 */ ;globalThis.pwned = 1; /*"],
    ["a newline", "17.0.0\n * @see evil"],
    ["an over-long value", "1".repeat(200)],
  ])("does not echo %s from the version into the doc comment", (_label, version) => {
    const output = renderTargetMajorModule("17", DEFAULT_TARGET_MAJOR_CONSTANT, {
      version,
    });

    expect(output).not.toContain("pwned");
    expect(output).not.toContain("@see evil");
    // The comment block is still intact: exactly one opener and one closer.
    expect(output.match(/\/\*\*/g)).toHaveLength(1);
    expect(output.match(/\*\//g)).toHaveLength(1);
    // The constant itself is unaffected — the major is digits-only.
    expect(output).toContain('export const UMBRACO_TARGET_MAJOR = "17";');
  });

  it("still echoes a normal semver version for traceability", () => {
    expect(
      renderTargetMajorModule("18", DEFAULT_TARGET_MAJOR_CONSTANT, {
        version: "18.0.0-rc1",
      })
    ).toContain("18.0.0-rc1");
  });
});

describe("createUmbracoTargetMajorTransformer", () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;

  /** Default fixture path; every test writes here unless it needs a nested one. */
  const OUTPUT = "target.generated.ts";
  const readGenerated = (file = OUTPUT) =>
    fs.readFileSync(path.join(tmpDir, file), "utf8");
  const makeTransformer = (over: Partial<UmbracoTargetMajorOptions> = {}) =>
    createUmbracoTargetMajorTransformer({ outputPath: OUTPUT, ...over });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "target-major-"));
    // The transformer resolves outputPath against cwd (same base orval uses).
    cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(tmpDir);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    // Ambient credentials would silently turn "no instance configured" tests
    // into live lookups against whatever the developer's .env points at.
    process.env = { ...originalEnv };
    delete process.env.UMBRACO_BASE_URL;
    delete process.env.UMBRACO_CLIENT_ID;
    delete process.env.UMBRACO_CLIENT_SECRET;
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    warnSpy.mockRestore();
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("instance lookup", () => {
    it("reads the major from the connected instance and returns the spec unchanged", async () => {
      // Arrange - the case the spec cannot serve: Umbraco reports "Latest".
      const outputPath = "./src/config/umbraco-target.generated.ts";
      setCredentials();
      const fetchMock = mockInstance({ version: "18.0.2" });
      const transformer = makeTransformer({ outputPath });
      const spec = { info: { version: "Latest" }, paths: {} };

      // Act
      const result = await transformer(spec);

      // Assert
      expect(result).toBe(spec);
      const written = readGenerated(outputPath);
      expect(written).toContain('export const UMBRACO_TARGET_MAJOR = "18";');
      expect(written).toContain("18.0.2");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
        SERVER_INFORMATION_PATH
      );
    });

    it("ignores a spec that carries its own version", async () => {
      // Arrange - an add-on's spec reports the add-on's release (e.g. Forms
      // 16.1.0) while the Umbraco it runs on is 18. Only the instance counts;
      // the spec's number is not Umbraco's and is never consulted.
      setCredentials();
      mockInstance({ version: "18.0.2" });
      const transformer = makeTransformer();

      // Act
      await transformer({ info: { version: "16.1.0" } });

      // Assert
      expect(readGenerated()).toContain(
        'export const UMBRACO_TARGET_MAJOR = "18";'
      );
    });

    it("fails when the instance is unreachable, even with a versioned spec", async () => {
      // Arrange - a committed spec carrying a real semver used to be the
      // fallback here. It isn't: that number is either hand-written or an
      // add-on's own release, never a reported Umbraco version.
      setCredentials();
      globalThis.fetch = jest.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;
      const transformer = makeTransformer();

      // Act / Assert
      await expect(
        transformer({ info: { version: "17.4.0" } })
      ).rejects.toThrow(/Cannot determine the target Umbraco major/);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("ECONNREFUSED")
      );
      expect(fs.existsSync(path.join(tmpDir, OUTPUT))).toBe(false);
    });

    it.each([
      ["the token request is rejected", { tokenStatus: 401 }],
      ["server/information is rejected", { infoStatus: 403 }],
      ["the instance reports no version", { version: null }],
    ])("warns and falls through when %s", async (_label, options) => {
      // Arrange
      setCredentials();
      mockInstance(options as { version?: string | null });
      const transformer = makeTransformer();

      // Act / Assert - nothing else can supply a major, so it throws rather
      // than guessing.
      await expect(transformer({ info: { version: "Latest" } })).rejects.toThrow(
        /Cannot determine the target Umbraco major/
      );
      expect(warnSpy).toHaveBeenCalled();
    });

    it.each([
      ["are absent entirely", () => {}],
      // A half-filled .env can't authenticate, and must not produce a
      // confusing 401 warning either.
      [
        "are partial",
        () => {
          process.env.UMBRACO_BASE_URL = "http://localhost:56472";
        },
      ],
    ])("makes no request and fails when credentials %s", async (_label, arrangeEnv) => {
      // Arrange - env is cleared in beforeEach; each case adds what it needs.
      arrangeEnv();
      const fetchMock = mockInstance({ version: "18.0.2" });
      const transformer = makeTransformer();

      // Act / Assert - no instance means no answer, and a versioned spec is not
      // a substitute. The error names the three variables to set.
      await expect(
        transformer({ info: { version: "17.4.0" } })
      ).rejects.toThrow(/UMBRACO_BASE_URL/);
      expect(fetchMock).not.toHaveBeenCalled();
      // No half-configured 401 warning either — nothing was attempted.
      expect(warnSpy).not.toHaveBeenCalled();
    });

  });

  describe("failure is loud", () => {
    it("throws rather than preserving a previously-generated value", async () => {
      // Arrange - THE regression this change exists to prevent. Before, an
      // unusable version plus an existing file meant "warn and keep", so a
      // project regenerating against a new Umbraco major silently kept the old
      // one and then blocked every tool call (#220's failure mode).
      // Seed a file the way a real project would: one successful generate.
      setCredentials();
      mockInstance({ version: "17.4.0" });
      await makeTransformer()({});
      const before = readGenerated();

      // Now the instance stops answering.
      mockInstance({ version: null });
      const transformer = makeTransformer();

      // Act / Assert
      await expect(transformer({})).rejects.toThrow(
        /Cannot determine the target Umbraco major/
      );
      // The stale file is left alone rather than rewritten with a wrong value —
      // the build failed, so nothing was generated to match it anyway.
      expect(readGenerated()).toBe(before);
    });

    it("names the real fix in the error, and no hand-pinned escape hatch", async () => {
      // Arrange
      const transformer = makeTransformer();

      // Act
      let message = "";
      try {
        await transformer({ info: { version: "Latest" } });
      } catch (error) {
        message = (error as Error).message;
      }

      // Assert - an actionable error, not just "cannot derive". The only fix it
      // offers is pointing at the instance, because that is the only fix: a
      // hand-pinned major would be a value nobody revisits (#220).
      expect(message).toContain("UMBRACO_BASE_URL");
      expect(message).toContain(SERVER_INFORMATION_PATH);
      expect(message).not.toContain("major:");
    });
  });

  describe("file writing", () => {
    it("creates intermediate directories", async () => {
      // Arrange
      setCredentials();
      mockInstance({ version: "18.0.0" });
      const transformer = makeTransformer({
        outputPath: "./deeply/nested/dir/target.generated.ts",
      });

      // Act
      await transformer({});

      // Assert
      expect(
        fs.existsSync(path.join(tmpDir, "deeply/nested/dir/target.generated.ts"))
      ).toBe(true);
    });

    it("does not rewrite the file when the resolved value is unchanged", async () => {
      // Arrange
      setCredentials();
      mockInstance({ version: "17.4.0" });
      const transformer = makeTransformer();
      await transformer({});
      const firstMtime = fs.statSync(path.join(tmpDir, OUTPUT)).mtimeMs;

      // Act - same instance, same answer.
      await transformer({});

      // Assert - untouched, so a no-op `npm run generate` leaves git clean
      expect(fs.statSync(path.join(tmpDir, OUTPUT)).mtimeMs).toBe(firstMtime);
    });

    it("rewrites the file when the major changes", async () => {
      // Arrange - this is the whole point: regenerating against a newer Umbraco
      // updates the constant with no per-repo bump.
      setCredentials();
      mockInstance({ version: "17.4.0" });
      await makeTransformer()({});

      // Act - the same project, now pointed at an upgraded instance.
      mockInstance({ version: "18.0.2" });
      await makeTransformer()({});

      // Assert
      expect(readGenerated()).toContain(
        'export const UMBRACO_TARGET_MAJOR = "18";'
      );
    });

    it("composes with another input transformer and passes the spec through", async () => {
      // Arrange - the template does `stampTargetMajor(relaxUntypedArrays(spec))`.
      setCredentials();
      mockInstance({ version: "17.4.0" });
      const transformer = makeTransformer();
      const other = <T extends object>(spec: T): T =>
        Object.assign(spec, { touched: true });

      // Act
      const result = await transformer(other({ paths: {} }));

      // Assert - the other transformer's edit survives, and this one adds
      // nothing to the document.
      expect(result).toMatchObject({ touched: true, paths: {} });
      expect(readGenerated()).toContain('"17"');
    });
  });
});
