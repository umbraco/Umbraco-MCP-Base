/**
 * Tests for the spec-reading half of `umbraco-mcp-stamp-target-major`.
 *
 * The resolution/precedence logic itself is covered against `stampTargetMajor`
 * in `src/http/__tests__/orval-target-major-writer.test.ts`; what is new here is
 * the CLI's own job of turning a `--spec` path or URL into an `info.version`.
 */

import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSpecInfo } from "../stamp-target-major.js";

describe("readSpecInfo", () => {
  let tmpDir: string;
  let cwdSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;
  const originalFetch = globalThis.fetch;

  const writeSpec = (name: string, contents: string): string => {
    fs.writeFileSync(path.join(tmpDir, name), contents, "utf8");
    return `./${name}`;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-spec-"));
    // A relative --spec resolves against cwd, like every other path the CLI
    // takes (and like orval's own relative targets).
    cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(tmpDir);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    warnSpy.mockRestore();
    globalThis.fetch = originalFetch;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads info.version from a local YAML spec", async () => {
    // Arrange - the shape the scaffolding template ships.
    const spec = writeSpec(
      "openapi.yaml",
      'openapi: "3.0.4"\ninfo:\n  title: Example\n  version: 17.4.0\npaths: {}\n'
    );

    // Act / Assert
    expect(await readSpecInfo(spec)).toBe("17.4.0");
  });

  it("reads info.version from a local JSON spec", async () => {
    // Arrange - YAML 1.2 is a JSON superset, so one parser covers both and the
    // file extension never has to be inspected.
    const spec = writeSpec(
      "openapi.json",
      JSON.stringify({ openapi: "3.0.4", info: { version: "18.0.2" } })
    );

    // Act / Assert
    expect(await readSpecInfo(spec)).toBe("18.0.2");
  });

  it("reads info.version from an http(s) spec URL", async () => {
    // Arrange - what a project generating straight off a live Umbraco points at.
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => JSON.stringify({ info: { version: "Latest" } }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    const version = await readSpecInfo(
      "http://localhost:56472/umbraco/openapi/management.json"
    );

    // Assert - "Latest" is exactly what Umbraco serves; passing it through
    // unjudged keeps the "no usable major" decision in one place.
    expect(version).toBe("Latest");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the file does not exist", () => "./missing.yaml"],
    [
      "the contents are not parseable",
      () => writeSpec("broken.yaml", "info:\n  - version: [17\n"),
    ],
  ])("warns and returns undefined when %s", async (_label, arrange) => {
    // Arrange
    const spec = arrange();

    // Act
    const version = await readSpecInfo(spec);

    // Assert - the spec is only the last-resort source, so an unusable one must
    // not fail a run the instance can still answer. If nothing else can supply
    // a major either, stampTargetMajor throws with the full explanation.
    expect(version).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("warns and returns undefined when a spec URL responds with an error", async () => {
    // Arrange
    globalThis.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    })) as unknown as typeof fetch;

    // Act
    const version = await readSpecInfo("http://localhost:56472/spec.json");

    // Assert
    expect(version).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("404"));
  });

  it.each([
    ["there is no info block", "openapi: '3.0.4'\npaths: {}\n"],
    ["info.version is missing", "info:\n  title: Example\n"],
    ["info.version is not a string", "info:\n  version: 17\n"],
    ["the document is empty", ""],
  ])("returns undefined when %s", async (_label, contents) => {
    // Arrange
    const spec = writeSpec("openapi.yaml", contents);

    // Act / Assert - nothing to warn about: a spec with no version is the norm,
    // not a failure.
    expect(await readSpecInfo(spec)).toBeUndefined();
  });
});
