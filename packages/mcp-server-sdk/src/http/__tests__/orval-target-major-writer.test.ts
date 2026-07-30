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
  extractSpecMajor,
  renderTargetMajorModule,
  DEFAULT_TARGET_MAJOR_CONSTANT,
  SERVER_INFORMATION_PATH,
  type UmbracoInstanceCredentials,
} from "../orval-target-major-writer.js";

const CREDENTIALS: UmbracoInstanceCredentials = {
  baseUrl: "http://localhost:56472",
  clientId: "umbraco-back-office-mcp",
  clientSecret: "shhh",
};

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
  const { tokenStatus = 200, infoStatus = 200 } = options;
  // Explicit `null` must survive: a `= "18.0.2"` default would swallow it.
  const version = "version" in options ? options.version : "18.0.2";

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
    const output = renderTargetMajorModule("17", DEFAULT_TARGET_MAJOR_CONSTANT, "17.4.0");

    expect(output).toContain("AUTO-GENERATED");
    expect(output).toContain("Do not edit by hand");
    expect(output).toContain("npm run generate");
    expect(output).toContain('export const UMBRACO_TARGET_MAJOR = "17";');
    // Traceability: the full version the major came from.
    expect(output).toContain("17.4.0");
  });

  it("records where the value came from, so a wrong one is diagnosable", () => {
    expect(
      renderTargetMajorModule("18", DEFAULT_TARGET_MAJOR_CONSTANT, "18.0.2", "instance")
    ).toContain(SERVER_INFORMATION_PATH);
    expect(
      renderTargetMajorModule("18", DEFAULT_TARGET_MAJOR_CONSTANT, undefined, "explicit")
    ).toContain("`major` option");
    expect(
      renderTargetMajorModule("17", DEFAULT_TARGET_MAJOR_CONSTANT, "17.4.0", "spec")
    ).toContain("info.version");
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
    const output = renderTargetMajorModule("17", DEFAULT_TARGET_MAJOR_CONSTANT, version);

    expect(output).not.toContain("pwned");
    expect(output).not.toContain("@see evil");
    // The comment block is still intact: exactly one opener and one closer.
    expect(output.match(/\/\*\*/g)).toHaveLength(1);
    expect(output.match(/\*\//g)).toHaveLength(1);
    // The constant itself is unaffected — the major is digits-only.
    expect(output).toContain('export const UMBRACO_TARGET_MAJOR = "17";');
  });

  it("still echoes a normal semver version for traceability", () => {
    expect(renderTargetMajorModule("18", DEFAULT_TARGET_MAJOR_CONSTANT, "18.0.0-rc1")).toContain(
      "18.0.0-rc1"
    );
  });
});

describe("createUmbracoTargetMajorTransformer", () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;
  const originalFetch = globalThis.fetch;
  const envKeys = [
    "UMBRACO_BASE_URL",
    "UMBRACO_CLIENT_ID",
    "UMBRACO_CLIENT_SECRET",
  ] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "target-major-"));
    // The transformer resolves outputPath against cwd (same base orval uses).
    cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(tmpDir);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    // Ambient credentials would silently turn "no instance configured" tests
    // into live lookups against whatever the developer's .env points at.
    savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
    envKeys.forEach((k) => delete process.env[k]);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    warnSpy.mockRestore();
    globalThis.fetch = originalFetch;
    envKeys.forEach((k) => {
      const value = savedEnv[k];
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("instance lookup", () => {
    it("reads the major from the connected instance and returns the spec unchanged", async () => {
      // Arrange - the case the spec cannot serve: Umbraco reports "Latest".
      const outputPath = "./src/config/umbraco-target.generated.ts";
      const fetchMock = mockInstance({ version: "18.0.2" });
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath,
        instance: CREDENTIALS,
      });
      const spec = { info: { version: "Latest" }, paths: {} };

      // Act
      const result = await transformer(spec);

      // Assert
      expect(result).toBe(spec);
      const written = fs.readFileSync(path.join(tmpDir, outputPath), "utf8");
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
      mockInstance({ version: "18.0.2" });
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath: "target.generated.ts",
        instance: CREDENTIALS,
      });

      // Act
      await transformer({ info: { version: "16.1.0" } });

      // Assert
      expect(
        fs.readFileSync(path.join(tmpDir, "target.generated.ts"), "utf8")
      ).toContain('export const UMBRACO_TARGET_MAJOR = "18";');
    });

    it("reads credentials from the environment by default", async () => {
      // Arrange - the same three vars the server itself runs on.
      process.env.UMBRACO_BASE_URL = "http://localhost:56472";
      process.env.UMBRACO_CLIENT_ID = "id";
      process.env.UMBRACO_CLIENT_SECRET = "secret";
      mockInstance({ version: "17.4.0" });
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath: "target.generated.ts",
      });

      // Act
      await transformer({ info: { version: "Latest" } });

      // Assert
      expect(
        fs.readFileSync(path.join(tmpDir, "target.generated.ts"), "utf8")
      ).toContain('export const UMBRACO_TARGET_MAJOR = "17";');
    });

    it("falls back to the spec when the instance is unreachable", async () => {
      // Arrange - offline generation from a committed spec with a real semver.
      globalThis.fetch = jest.fn(async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath: "target.generated.ts",
        instance: CREDENTIALS,
      });

      // Act
      await transformer({ info: { version: "17.4.0" } });

      // Assert - value still written, but the fallback is announced: the spec
      // may be an add-on's, so the major needs a human eye.
      expect(
        fs.readFileSync(path.join(tmpDir, "target.generated.ts"), "utf8")
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
      mockInstance(options as { version?: string | null });
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath: "target.generated.ts",
        instance: CREDENTIALS,
      });

      // Act / Assert - nothing else can supply a major, so it throws rather
      // than guessing.
      await expect(transformer({ info: { version: "Latest" } })).rejects.toThrow(
        /Cannot determine the target Umbraco major/
      );
      expect(warnSpy).toHaveBeenCalled();
    });

    it("skips the lookup entirely when instance is false", async () => {
      // Arrange
      const fetchMock = mockInstance({ version: "18.0.2" });
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath: "target.generated.ts",
        instance: false,
      });

      // Act
      await transformer({ info: { version: "17.4.0" } });

      // Assert - no network, spec used, and no fallback warning because no
      // lookup was expected in the first place.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        fs.readFileSync(path.join(tmpDir, "target.generated.ts"), "utf8")
      ).toContain('export const UMBRACO_TARGET_MAJOR = "17";');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("explicit major", () => {
    it("wins over both the instance and the spec", async () => {
      // Arrange
      const fetchMock = mockInstance({ version: "18.0.2" });
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath: "target.generated.ts",
        instance: CREDENTIALS,
        major: "15",
      });

      // Act
      await transformer({ info: { version: "17.4.0" } });

      // Assert
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        fs.readFileSync(path.join(tmpDir, "target.generated.ts"), "utf8")
      ).toContain('export const UMBRACO_TARGET_MAJOR = "15";');
    });

    it("rejects a major that is not a version", async () => {
      // Arrange - catches `major: "Latest"` copied from the spec.
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath: "target.generated.ts",
        major: "Latest",
      });

      // Act / Assert
      await expect(transformer({ info: {} })).rejects.toThrow(
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
      const outputPath = "target.generated.ts";
      const seeded = createUmbracoTargetMajorTransformer({
        outputPath,
        major: "17",
      });
      await seeded({ info: {} });
      const before = fs.readFileSync(path.join(tmpDir, outputPath), "utf8");

      const transformer = createUmbracoTargetMajorTransformer({
        outputPath,
        instance: false,
      });

      // Act / Assert
      await expect(
        transformer({ info: { version: "Latest" } })
      ).rejects.toThrow(/Cannot determine the target Umbraco major/);
      // The stale file is left alone rather than rewritten with a wrong value —
      // the build failed, so nothing was generated to match it anyway.
      expect(fs.readFileSync(path.join(tmpDir, outputPath), "utf8")).toBe(before);
    });

    it("names every way out in the error", async () => {
      // Arrange
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath: "target.generated.ts",
        instance: false,
      });

      // Act
      let message = "";
      try {
        await transformer({ info: { version: "Latest" } });
      } catch (error) {
        message = (error as Error).message;
      }

      // Assert - an actionable error, not just "cannot derive".
      expect(message).toContain("UMBRACO_BASE_URL");
      expect(message).toContain(SERVER_INFORMATION_PATH);
      expect(message).toContain('major: "18"');
    });
  });

  describe("file writing", () => {
    it("creates intermediate directories", async () => {
      // Arrange
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath: "./deeply/nested/dir/target.generated.ts",
        instance: false,
      });

      // Act
      await transformer({ info: { version: "18.0.0" } });

      // Assert
      expect(
        fs.existsSync(path.join(tmpDir, "deeply/nested/dir/target.generated.ts"))
      ).toBe(true);
    });

    it("does not rewrite the file when the resolved value is unchanged", async () => {
      // Arrange
      const outputPath = "target.generated.ts";
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath,
        instance: false,
      });
      await transformer({ info: { version: "17.4.0" } });
      const firstMtime = fs.statSync(path.join(tmpDir, outputPath)).mtimeMs;

      // Act
      await transformer({ info: { version: "17.4.0" } });

      // Assert - untouched, so a no-op `npm run generate` leaves git clean
      expect(fs.statSync(path.join(tmpDir, outputPath)).mtimeMs).toBe(firstMtime);
    });

    it("rewrites the file when the major changes", async () => {
      // Arrange - this is the whole point: regenerating against a newer Umbraco
      // updates the constant with no per-repo bump.
      const outputPath = "target.generated.ts";
      mockInstance({ version: "17.4.0" });
      await createUmbracoTargetMajorTransformer({
        outputPath,
        instance: CREDENTIALS,
      })({ info: { version: "Latest" } });

      // Act
      mockInstance({ version: "18.0.2" });
      await createUmbracoTargetMajorTransformer({
        outputPath,
        instance: CREDENTIALS,
      })({ info: { version: "Latest" } });

      // Assert
      expect(fs.readFileSync(path.join(tmpDir, outputPath), "utf8")).toContain(
        'export const UMBRACO_TARGET_MAJOR = "18";'
      );
    });

    it("composes with another input transformer", async () => {
      // Arrange - the template does `stampTargetMajor(relaxUntypedArrays(spec))`.
      const transformer = createUmbracoTargetMajorTransformer({
        outputPath: "target.generated.ts",
        instance: false,
      });
      const other = <T extends object>(spec: T): T =>
        Object.assign(spec, { touched: true });

      // Act
      const result = await transformer(other({ info: { version: "17.0.0" } }));

      // Assert
      expect(result).toMatchObject({ touched: true });
      expect(fs.readFileSync(path.join(tmpDir, "target.generated.ts"), "utf8")).toContain(
        '"17"'
      );
    });
  });
});
