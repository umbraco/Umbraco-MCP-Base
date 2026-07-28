/**
 * Tests for the orval target-major transformer.
 *
 * The transformer is the mechanism that guarantees every Umbraco MCP server has
 * a target major to give `checkUmbracoVersion` — derived from the spec its tools
 * are generated from, not typed in by a human. See
 * umbraco/Umbraco-MCP-Base#220 for what the hand-maintained alternative cost.
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
} from "../orval-target-major-writer.js";

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
    // Traceability: the full spec version the major came from.
    expect(output).toContain("17.4.0");
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

  // A spec can be fetched from a remote URL, so `info.version` is untrusted
  // input. Echoing it raw into the JSDoc block would let `*/` close the comment
  // early and inject code into a file that then gets compiled and run.
  it.each([
    ["a comment breakout", "1.0.0 */ ;globalThis.pwned = 1; /*"],
    ["a newline", "17.0.0\n * @see evil"],
    ["an over-long value", "1".repeat(200)],
  ])("does not echo %s from info.version into the doc comment", (_label, version) => {
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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "target-major-"));
    // The transformer resolves outputPath against cwd (same base orval uses).
    cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(tmpDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes the derived constant and returns the spec unchanged", () => {
    // Arrange
    const outputPath = "./src/config/umbraco-target.generated.ts";
    const transformer = createUmbracoTargetMajorTransformer({ outputPath });
    const spec = { info: { version: "17.4.0" }, paths: {} };

    // Act
    const result = transformer(spec);

    // Assert
    expect(result).toBe(spec);
    const written = fs.readFileSync(path.join(tmpDir, outputPath), "utf8");
    expect(written).toContain('export const UMBRACO_TARGET_MAJOR = "17";');
  });

  it("creates intermediate directories", () => {
    // Arrange
    const transformer = createUmbracoTargetMajorTransformer({
      outputPath: "./deeply/nested/dir/target.generated.ts",
    });

    // Act
    transformer({ info: { version: "18.0.0" } });

    // Assert
    expect(
      fs.existsSync(path.join(tmpDir, "deeply/nested/dir/target.generated.ts"))
    ).toBe(true);
  });

  it("does not rewrite the file when the derived value is unchanged", () => {
    // Arrange
    const outputPath = "target.generated.ts";
    const transformer = createUmbracoTargetMajorTransformer({ outputPath });
    transformer({ info: { version: "17.4.0" } });
    const firstMtime = fs.statSync(path.join(tmpDir, outputPath)).mtimeMs;

    // Act - regenerate from a different patch of the same major
    transformer({ info: { version: "17.4.0" } });

    // Assert - untouched, so a no-op `npm run generate` leaves git clean
    expect(fs.statSync(path.join(tmpDir, outputPath)).mtimeMs).toBe(firstMtime);
  });

  it("rewrites the file when the spec's major changes", () => {
    // Arrange - this is the whole point: regenerating against a newer Umbraco
    // updates the constant with no per-repo bump.
    const outputPath = "target.generated.ts";
    const transformer = createUmbracoTargetMajorTransformer({ outputPath });
    transformer({ info: { version: "17.4.0" } });

    // Act
    transformer({ info: { version: "18.0.0" } });

    // Assert
    expect(fs.readFileSync(path.join(tmpDir, outputPath), "utf8")).toContain(
      'export const UMBRACO_TARGET_MAJOR = "18";'
    );
  });

  it("throws a descriptive error when info.version is unusable", () => {
    // Arrange - failing loudly beats silently stamping a wrong major, which is
    // exactly the #220 failure mode.
    const transformer = createUmbracoTargetMajorTransformer({
      outputPath: "target.generated.ts",
    });

    // Act / Assert
    expect(() => transformer({ info: {} })).toThrow(/info\.version/);
    expect(() => transformer({ info: {} })).toThrow(/UMBRACO_TARGET_MAJOR/);
    expect(fs.existsSync(path.join(tmpDir, "target.generated.ts"))).toBe(false);
  });

  it("composes with another input transformer", () => {
    // Arrange - the template does `stampTargetMajor(relaxUntypedArrays(spec))`.
    const transformer = createUmbracoTargetMajorTransformer({
      outputPath: "target.generated.ts",
    });
    const other = <T extends object>(spec: T): T =>
      Object.assign(spec, { touched: true });

    // Act
    const result = transformer(other({ info: { version: "17.0.0" } }));

    // Assert
    expect(result).toMatchObject({ touched: true });
    expect(fs.readFileSync(path.join(tmpDir, "target.generated.ts"), "utf8")).toContain(
      '"17"'
    );
  });
});
