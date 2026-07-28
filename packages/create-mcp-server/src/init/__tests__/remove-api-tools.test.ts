/**
 * removeApiTools (container mode) tests.
 *
 * Container mode strips the direct-API layer from src/index.ts while keeping
 * chaining intact. Until now this rewriting was only exercised by the
 * SQL-Server-gated new-instance E2E (`Step 3: container project compiles
 * cleanly`), so any template change that left a dangling reference behind was
 * invisible to `npm test` — see umbraco/Umbraco-MCP-Base#212, where the new
 * version-check block kept its `if (clientId)` guard after `const clientId`
 * had been removed (TS2304).
 *
 * These tests assert no symbol removed from index.ts is still referenced, and
 * snapshot the result so future template edits surface here rather than in a
 * four-minute E2E.
 */

import { jest } from "@jest/globals";
import * as path from "node:path";
import { createMockFs } from "../../__tests__/helpers/mock-fs.js";
import { loadScaffoldedFixture } from "../../__tests__/helpers/template-fixture.js";

const PROJECT_DIR = "/test-project";
const PROJECT_NAME = "test-mcp-server";

const mockFs = createMockFs(loadScaffoldedFixture(PROJECT_DIR, PROJECT_NAME));
jest.unstable_mockModule("node:fs", () => mockFs.module);

const { removeApiTools } = await import("../remove-api-tools.js");

const indexTsPath = path.resolve(PROJECT_DIR, "src/index.ts");

function readIndexTs(): string {
  return mockFs.files.get(indexTsPath)!;
}

beforeEach(() => {
  mockFs.reset();
});

describe("removeApiTools", () => {
  it("removes the orval config and generated API client", () => {
    removeApiTools(PROJECT_DIR);

    expect(mockFs.files.has(path.resolve(PROJECT_DIR, "orval.config.ts"))).toBe(false);
    const generated = [...mockFs.files.keys()].filter((k) =>
      k.includes("/src/umbraco-api/api/generated/"),
    );
    expect(generated).toHaveLength(0);
  });

  it("removes the direct-API wiring from index.ts", () => {
    removeApiTools(PROJECT_DIR);
    const content = readIndexTs();

    expect(content).not.toContain("configureApiClient");
    expect(content).not.toContain("getExampleUmbracoAddOnAPI");
    expect(content).not.toContain("initializeUmbracoFetch");
  });

  it("removes the version check along with the credentials it depends on", () => {
    // Regression guard for #212: the version check is gated on `clientId`,
    // which is removed with initializeUmbracoFetch. Leaving either the guard
    // or the SDK imports behind breaks `tsc` in container mode.
    removeApiTools(PROJECT_DIR);
    const content = readIndexTs();

    expect(content).not.toContain("checkUmbracoVersion");
    expect(content).not.toContain("configureVersionCheckHook");
    expect(content).not.toContain("UmbracoManagementClient");
    expect(content).not.toContain("CAPTURE_RAW_HTTP_RESPONSE");
    expect(content).not.toContain("HttpResponse");
  });

  it("leaves no reference to a variable it deleted", () => {
    removeApiTools(PROJECT_DIR);
    const content = readIndexTs();

    // Each of these consts is deleted, so no remaining line may mention them.
    for (const name of ["baseUrl", "clientId", "clientSecret"]) {
      expect(content).not.toContain(name);
    }
  });

  it("keeps getVersionCheckMessage so the McpServer construction still compiles", () => {
    removeApiTools(PROJECT_DIR);
    const content = readIndexTs();

    expect(content).toContain("getVersionCheckMessage");
    expect(content).toContain("const versionCheckMessage = getVersionCheckMessage();");
    expect(content).toContain("versionCheckMessage ? { instructions: versionCheckMessage } : undefined");
  });

  it("keeps chaining infrastructure intact", () => {
    removeApiTools(PROJECT_DIR);
    const content = readIndexTs();

    expect(content).toContain("mcpClientManager");
    expect(content).toContain("discoverProxiedTools");
  });

  it("removes the generate script and orval dependency from package.json", () => {
    removeApiTools(PROJECT_DIR);

    const pkg = JSON.parse(mockFs.files.get(path.resolve(PROJECT_DIR, "package.json"))!);
    expect(pkg.scripts.generate).toBeUndefined();
    expect(pkg.devDependencies?.orval).toBeUndefined();
  });

  it("is idempotent", () => {
    removeApiTools(PROJECT_DIR);
    const first = readIndexTs();

    removeApiTools(PROJECT_DIR);
    expect(readIndexTs()).toBe(first);
  });

  it("should snapshot index.ts after removal", () => {
    removeApiTools(PROJECT_DIR);
    expect(readIndexTs()).toMatchSnapshot();
  });
});
