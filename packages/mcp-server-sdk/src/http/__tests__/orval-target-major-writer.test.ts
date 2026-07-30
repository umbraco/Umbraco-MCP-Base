/**
 * Tests for the target-major writer.
 *
 * `stampTargetMajor` is the mechanism that guarantees every Umbraco MCP server
 * has a target major to give `checkUmbracoVersion` — discovered from the
 * instance the tools were generated against, not typed in by a human. See
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
  stampTargetMajor,
  extractSpecMajor,
  renderTargetMajorModule,
  DEFAULT_TARGET_MAJOR_CONSTANT,
  SERVER_INFORMATION_PATH,
  type OpenApiDocumentWithInfo,
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

describe("extractSpecMajor", () => {
  it.each([
    ["a full semver", "17.4.0", "17"],
    ["a bare major", "17", "17"],
    ["a prerelease", "18.0.0-rc1", "18"],
    ["surrounding whitespace", "  17.4.0  ", "17"],
    ["a multi-digit major", "100.1.2", "100"],
  ])("derives the major from %s", (_label, version, expected) => {
    expect(extractSpecMajor({ info: { version } })).toBe(expected);
  });

  it.each([
    ["a missing info object", {}],
    ["a missing version", { info: {} }],
    ["a non-string version", { info: { version: 17 } }],
    ["a non-numeric version", { info: { version: "v-next" } }],
    ["an empty version", { info: { version: "" } }],
    // What every Umbraco Management API spec actually reports.
    ["Umbraco's hard-coded placeholder", { info: { version: "Latest" } }],
  ])("returns null for %s", (_label, spec) => {
    expect(extractSpecMajor(spec as { info?: { version?: unknown } })).toBeNull();
  });
});

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
    expect(render({ source: "explicit" })).toContain("`major` option");
    expect(render({ version: "18.0.2", source: "spec" })).toContain("info.version");
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

describe("stampTargetMajor", () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;

  /** Default fixture path; every test writes here unless it needs a nested one. */
  const OUTPUT = "target.generated.ts";
  const readGenerated = (file = OUTPUT) =>
    fs.readFileSync(path.join(tmpDir, file), "utf8");
  /**
   * Calls the stamp the way the CLI does: a spec (or the `{}` a run with no
   * `--spec` produces) plus options.
   */
  const stamp = (
    spec: OpenApiDocumentWithInfo,
    over: Partial<UmbracoTargetMajorOptions> = {}
  ) => stampTargetMajor(spec, { outputPath: OUTPUT, ...over });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "target-major-"));
    // outputPath resolves against cwd (the directory `generate` runs in).
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
    it("reads the major from the connected instance and reports its provenance", async () => {
      // Arrange - the case the spec cannot serve: Umbraco reports "Latest".
      const outputPath = "./src/config/umbraco-target.generated.ts";
      setCredentials();
      const fetchMock = mockInstance({ version: "18.0.2" });
      const spec = { info: { version: "Latest" }, paths: {} };

      // Act
      const result = await stamp(spec, { outputPath });

      // Assert - the caller (the CLI) gets everything it needs to report the
      // run without re-reading the file it just wrote.
      expect(result).toMatchObject({
        major: "18",
        version: "18.0.2",
        source: "instance",
        wrote: true,
      });
      expect(result.outputPath).toBe(path.join(tmpDir, outputPath));
      const written = readGenerated(outputPath);
      expect(written).toContain('export const UMBRACO_TARGET_MAJOR = "18";');
      expect(written).toContain("18.0.2");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
        SERVER_INFORMATION_PATH
      );
    });

    it("prefers the instance over a spec that carries its own version", async () => {
      // Arrange - an add-on's spec reports the add-on's release (e.g. Forms
      // 16.1.0) while the Umbraco it runs on is 18. The instance is the truth.
      setCredentials();
      mockInstance({ version: "18.0.2" });

      // Act
      await stamp({ info: { version: "16.1.0" } });

      // Assert
      expect(
        readGenerated()
      ).toContain('export const UMBRACO_TARGET_MAJOR = "18";');
    });

    it("falls back to the spec when the instance is unreachable", async () => {
      // Arrange - offline generation from a committed spec with a real semver.
      setCredentials();
      globalThis.fetch = jest.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;

      // Act
      await stamp({ info: { version: "17.4.0" } });

      // Assert - value still written, but the fallback is announced: the spec
      // may be an add-on's, so the major needs a human eye.
      expect(
        readGenerated()
      ).toContain('export const UMBRACO_TARGET_MAJOR = "17";');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("ECONNREFUSED")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Falling back to the spec")
      );
    });

    it.each([
      ["the token request is rejected", { tokenStatus: 401 }],
      ["server/information is rejected", { infoStatus: 403 }],
      ["the instance reports no version", { version: null }],
    ])("warns and falls through when %s", async (_label, options) => {
      // Arrange
      setCredentials();
      mockInstance(options as { version?: string | null });

      // Act / Assert - nothing else can supply a major, so it throws rather
      // than guessing.
      await expect(stamp({ info: { version: "Latest" } })).rejects.toThrow(
        /Cannot determine the target Umbraco major/
      );
      expect(warnSpy).toHaveBeenCalled();
    });

    it.each([
      // How a project generating offline from a committed spec opts out.
      ["none are configured", () => {}],
      // A half-filled .env can't authenticate, and must not produce a
      // confusing 401 warning either.
      [
        "they are partial",
        () => {
          process.env.UMBRACO_BASE_URL = "http://localhost:56472";
        },
      ],
    ])("skips the lookup entirely when %s", async (_label, arrangeEnv) => {
      // Arrange - env is cleared in beforeEach; each case adds what it needs.
      arrangeEnv();
      const fetchMock = mockInstance({ version: "18.0.2" });

      // Act
      await stamp({ info: { version: "17.4.0" } });

      // Assert - no network, spec used, and no warning: nothing was expected to
      // happen, so there is nothing to report.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(readGenerated()).toContain(
        'export const UMBRACO_TARGET_MAJOR = "17";'
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns when the instance and a versioned spec disagree", async () => {
      // Arrange - the silent-wrong-value case: generating from a committed 17
      // spec while UMBRACO_BASE_URL points at an 18 instance stamps "18" beside
      // a 17 tool surface. The instance still wins, but it must not be quiet.
      setCredentials();
      mockInstance({ version: "18.0.2" });

      // Act
      await stamp({ info: { version: "17.4.0" } });

      // Assert
      expect(readGenerated()).toContain(
        'export const UMBRACO_TARGET_MAJOR = "18";'
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('but the spec reports "17.4.0"')
      );
    });

    it("stays quiet when the instance and the spec agree", async () => {
      // Arrange - the normal case for a project generating from its own
      // instance's spec. A warning here would be noise on every generate.
      setCredentials();
      mockInstance({ version: "17.4.2" });

      // Act
      await stamp({ info: { version: "17.4.0" } });

      // Assert
      expect(readGenerated()).toContain(
        'export const UMBRACO_TARGET_MAJOR = "17";'
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("explicit major", () => {
    it("wins over both the instance and the spec", async () => {
      // Arrange - credentials present and the spec versioned, so this proves
      // precedence rather than absence of the alternatives.
      setCredentials();
      const fetchMock = mockInstance({ version: "18.0.2" });

      // Act
      const result = await stamp({ info: { version: "17.4.0" } }, { major: "15" });

      // Assert
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({ major: "15", source: "explicit" });
      expect(
        readGenerated()
      ).toContain('export const UMBRACO_TARGET_MAJOR = "15";');
    });

    it("rejects a major that is not a version", async () => {
      // Act / Assert - catches `--major Latest` copied from the spec.
      await expect(stamp({ info: {} }, { major: "Latest" })).rejects.toThrow(
        /Invalid `major` option/
      );
    });
  });

  describe("failure is loud", () => {
    it("throws rather than preserving a previously-generated value", async () => {
      // Arrange - THE regression this change exists to prevent. Before, an
      // unusable version plus an existing file meant "warn and keep", so a
      // project regenerating against a new Umbraco major silently kept the old
      // one and then blocked every tool call (#220's failure mode).
      await stamp({ info: {} }, { major: "17" });
      const before = readGenerated();

      // Act / Assert
      await expect(
        stamp({ info: { version: "Latest" } })
      ).rejects.toThrow(/Cannot determine the target Umbraco major/);
      // The stale file is left alone rather than rewritten with a wrong value —
      // the build failed, so nothing was generated to match it anyway.
      expect(readGenerated()).toBe(before);
    });

    it("names every way out in the error", async () => {
      // Act
      let message = "";
      try {
        await stamp({ info: { version: "Latest" } });
      } catch (error) {
        message = (error as Error).message;
      }

      // Assert - an actionable error, not just "cannot derive".
      expect(message).toContain("UMBRACO_BASE_URL");
      expect(message).toContain(SERVER_INFORMATION_PATH);
      expect(message).toContain("--major 18");
      expect(message).toContain('major: "18"');
    });
  });

  describe("file writing", () => {
    it("creates intermediate directories", async () => {
      // Act
      await stamp(
        { info: { version: "18.0.0" } },
        { outputPath: "./deeply/nested/dir/target.generated.ts" }
      );

      // Assert
      expect(
        fs.existsSync(path.join(tmpDir, "deeply/nested/dir/target.generated.ts"))
      ).toBe(true);
    });

    it("does not rewrite the file when the resolved value is unchanged", async () => {
      // Arrange
      await stamp({ info: { version: "17.4.0" } });
      const firstMtime = fs.statSync(path.join(tmpDir, OUTPUT)).mtimeMs;

      // Act
      const result = await stamp({ info: { version: "17.4.0" } });

      // Assert - untouched, so a no-op `npm run generate` leaves git clean
      expect(result.wrote).toBe(false);
      expect(fs.statSync(path.join(tmpDir, OUTPUT)).mtimeMs).toBe(firstMtime);
    });

    it("rewrites the file when the major changes", async () => {
      // Arrange - this is the whole point: regenerating against a newer Umbraco
      // updates the constant with no per-repo bump.
      setCredentials();
      mockInstance({ version: "17.4.0" });
      await stamp({ info: { version: "Latest" } });

      // Act - the same project, now pointed at an upgraded instance.
      mockInstance({ version: "18.0.2" });
      const result = await stamp({ info: { version: "Latest" } });

      // Assert
      expect(result.wrote).toBe(true);
      expect(readGenerated()).toContain(
        'export const UMBRACO_TARGET_MAJOR = "18";'
      );
    });

    it("honours a custom constant name end to end", async () => {
      // Arrange / Act - what `--constant-name` reaches.
      await stamp(
        { info: { version: "17.4.0" } },
        { constantName: "MY_TARGET" }
      );

      // Assert
      expect(readGenerated()).toContain('export const MY_TARGET = "17";');
    });

    it("rejects a constant name that is not an identifier before writing", async () => {
      // Arrange / Act - a broken name must fail loudly, not emit injected code.
      await expect(
        stamp({ info: { version: "17.4.0" } }, { constantName: "X = 1; const Y" })
      ).rejects.toThrow(/valid JavaScript identifier/);

      // Assert
      expect(fs.existsSync(path.join(tmpDir, OUTPUT))).toBe(false);
    });

    it("accepts the minimal spec shape the CLI builds", async () => {
      // Arrange - the CLI parses the spec itself and hands over just the
      // version (or `{}` when `--spec` was omitted), never a whole document.
      setCredentials();
      mockInstance({ version: "18.0.2" });

      // Act
      const result = await stamp({});

      // Assert
      expect(result).toMatchObject({ major: "18", source: "instance" });
      expect(readGenerated()).toContain(
        'export const UMBRACO_TARGET_MAJOR = "18";'
      );
    });
  });
});
