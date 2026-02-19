/**
 * Discover module mock-fs tests.
 *
 * Tests updateModeRegistry, updateSliceRegistry, updateEnvBaseUrl,
 * detectBaseUrl, and configureOpenApi with mock-fs.
 */

import { jest } from "@jest/globals";
import * as path from "node:path";
import { createMockFs } from "../../__tests__/helpers/mock-fs.js";
import { loadScaffoldedFixture } from "../../__tests__/helpers/template-fixture.js";

const PROJECT_DIR = "/test-project";
const PROJECT_NAME = "test-mcp-server";

const mockFs = createMockFs(loadScaffoldedFixture(PROJECT_DIR, PROJECT_NAME));
jest.unstable_mockModule("node:fs", () => mockFs.module);

const { updateModeRegistry, updateSliceRegistry } = await import(
  "../update-registries.js"
);
const { detectBaseUrl, updateEnvBaseUrl, updateEnvVar, readLaunchSettingsUrl } =
  await import("../index.js");
const { configureOpenApi } = await import("../../init/configure-openapi.js");

beforeEach(() => {
  mockFs.reset();
});

// ── updateModeRegistry ──────────────────────────────────────────────────────

describe("updateModeRegistry", () => {
  const modes = [
    {
      name: "product",
      displayName: "Product Tools",
      description: "Product operations",
      collections: ["product"],
    },
    {
      name: "order",
      displayName: "Order Tools",
      description: "Order operations",
      collections: ["order"],
    },
  ];

  it("should add modes to mode-registry.ts", () => {
    const added = updateModeRegistry(PROJECT_DIR, modes);
    expect(added).toBe(2);

    const content = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/config/mode-registry.ts")
    )!;
    expect(content).toContain("name: 'product'");
    expect(content).toContain("name: 'order'");
    expect(content).toContain("collections: ['product']");
  });

  it("should not duplicate existing modes", () => {
    updateModeRegistry(PROJECT_DIR, modes);
    const added = updateModeRegistry(PROJECT_DIR, modes);
    expect(added).toBe(0);
  });

  it("should snapshot mode-registry.ts after updates", () => {
    updateModeRegistry(PROJECT_DIR, modes);

    const content = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/config/mode-registry.ts")
    )!;
    expect(content).toMatchSnapshot();
  });
});

// ── updateSliceRegistry ─────────────────────────────────────────────────────

describe("updateSliceRegistry", () => {
  it("should add novel slices", () => {
    const added = updateSliceRegistry(PROJECT_DIR, ["custom-action"]);
    expect(added).toBe(1);

    const content = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/config/slice-registry.ts")
    )!;
    expect(content).toContain("'custom-action'");
  });

  it("should not duplicate existing slices", () => {
    const added = updateSliceRegistry(PROJECT_DIR, ["search"]);
    expect(added).toBe(0);
  });

  it("should be idempotent", () => {
    updateSliceRegistry(PROJECT_DIR, ["custom-action"]);
    const added = updateSliceRegistry(PROJECT_DIR, ["custom-action"]);
    expect(added).toBe(0);
  });

  it("should snapshot slice-registry.ts after updates", () => {
    updateSliceRegistry(PROJECT_DIR, ["custom-action", "batch-import"]);

    const content = mockFs.files.get(
      path.resolve(PROJECT_DIR, "src/config/slice-registry.ts")
    )!;
    expect(content).toMatchSnapshot();
  });
});

// ── detectBaseUrl ───────────────────────────────────────────────────────────

describe("detectBaseUrl", () => {
  it("should detect URL from launchSettings.json", () => {
    // Create a mock launchSettings
    const launchPath = path.resolve(
      PROJECT_DIR,
      "demo-site/Properties/launchSettings.json"
    );
    mockFs.files.set(
      launchPath,
      JSON.stringify({
        profiles: {
          UmbracoInstance: {
            applicationUrl: "https://localhost:44391;http://localhost:5000",
          },
        },
      })
    );

    const result = detectBaseUrl(PROJECT_DIR);
    expect(result.url).toBe("https://localhost:44391");
    expect(result.source).toBe("launchSettings.json");
  });

  it("should fall back to .env when no launchSettings", () => {
    const envPath = path.resolve(PROJECT_DIR, ".env");
    mockFs.files.set(envPath, "UMBRACO_BASE_URL=https://localhost:99999\n");

    const result = detectBaseUrl(PROJECT_DIR);
    expect(result.url).toBe("https://localhost:99999");
    expect(result.source).toBe(".env");
  });

  it("should prefer launchSettings over .env", () => {
    // Set up both .env and launchSettings
    mockFs.files.set(
      path.resolve(PROJECT_DIR, ".env"),
      "UMBRACO_BASE_URL=https://localhost:99999\n"
    );
    mockFs.files.set(
      path.resolve(PROJECT_DIR, "demo-site/Properties/launchSettings.json"),
      JSON.stringify({
        profiles: {
          Demo: { applicationUrl: "https://localhost:44391" },
        },
      })
    );

    const result = detectBaseUrl(PROJECT_DIR);
    expect(result.url).toBe("https://localhost:44391");
    expect(result.source).toBe("launchSettings.json");
  });

  it("should fall back to orval.config.ts", () => {
    // Set orval to a remote URL
    const orvalPath = path.resolve(PROJECT_DIR, "orval.config.ts");
    let content = mockFs.files.get(orvalPath)!;
    content = content.replace(
      /target:\s*["']\.\/src\/umbraco-api\/api\/openapi\.yaml["']/,
      'target: "https://localhost:44331/umbraco/swagger/commerce/swagger.json"'
    );
    mockFs.files.set(orvalPath, content);

    const result = detectBaseUrl(PROJECT_DIR);
    expect(result.url).toBe("https://localhost:44331");
    expect(result.source).toBe("orval.config.ts");
  });

  it("should return empty when nothing is configured", () => {
    const result = detectBaseUrl(PROJECT_DIR);
    expect(result.url).toBeUndefined();
    expect(result.source).toBeUndefined();
  });
});

// ── readLaunchSettingsUrl ───────────────────────────────────────────────────

describe("readLaunchSettingsUrl", () => {
  it("should prefer HTTPS over HTTP", () => {
    mockFs.files.set(
      path.resolve(PROJECT_DIR, "demo-site/Properties/launchSettings.json"),
      JSON.stringify({
        profiles: {
          Demo: {
            applicationUrl: "http://localhost:5000;https://localhost:44391",
          },
        },
      })
    );

    expect(readLaunchSettingsUrl(PROJECT_DIR)).toBe(
      "https://localhost:44391"
    );
  });

  it("should handle HTTP-only URLs", () => {
    mockFs.files.set(
      path.resolve(PROJECT_DIR, "demo-site/Properties/launchSettings.json"),
      JSON.stringify({
        profiles: {
          Demo: { applicationUrl: "http://localhost:5000" },
        },
      })
    );

    expect(readLaunchSettingsUrl(PROJECT_DIR)).toBe("http://localhost:5000");
  });

  it("should return undefined when no launchSettings exist", () => {
    expect(readLaunchSettingsUrl(PROJECT_DIR)).toBeUndefined();
  });
});

// ── updateEnvBaseUrl & updateEnvVar ─────────────────────────────────────────

describe("updateEnvBaseUrl", () => {
  it("should create .env from .env.example with updated URL", () => {
    const updated = updateEnvBaseUrl(PROJECT_DIR, "https://localhost:55555");
    expect(updated).toBe(true);

    const content = mockFs.files.get(path.resolve(PROJECT_DIR, ".env"))!;
    expect(content).toContain("UMBRACO_BASE_URL=https://localhost:55555");
  });

  it("should update existing .env", () => {
    updateEnvBaseUrl(PROJECT_DIR, "https://localhost:44391");
    const updated = updateEnvBaseUrl(PROJECT_DIR, "https://localhost:55555");
    expect(updated).toBe(true);

    const content = mockFs.files.get(path.resolve(PROJECT_DIR, ".env"))!;
    expect(content).toContain("UMBRACO_BASE_URL=https://localhost:55555");
    expect(content).not.toContain("UMBRACO_BASE_URL=https://localhost:44391");
  });

  it("should be idempotent", () => {
    updateEnvBaseUrl(PROJECT_DIR, "https://localhost:55555");
    const updated = updateEnvBaseUrl(PROJECT_DIR, "https://localhost:55555");
    expect(updated).toBe(false);
  });
});

describe("updateEnvVar", () => {
  it("should append new var to .env", () => {
    // Seed .env first
    mockFs.files.set(path.resolve(PROJECT_DIR, ".env"), "FOO=bar\n");

    const updated = updateEnvVar(PROJECT_DIR, "MY_VAR", "hello");
    expect(updated).toBe(true);

    const content = mockFs.files.get(path.resolve(PROJECT_DIR, ".env"))!;
    expect(content).toContain("MY_VAR=hello");
    expect(content).toContain("FOO=bar");
  });
});

// ── configureOpenApi ────────────────────────────────────────────────────────

describe("configureOpenApi", () => {
  it("should update orval.config.ts with new URL", () => {
    const testUrl =
      "https://localhost:44391/umbraco/swagger/commerce/swagger.json";

    configureOpenApi(PROJECT_DIR, testUrl);

    const orvalConfig = mockFs.files.get(
      path.resolve(PROJECT_DIR, "orval.config.ts")
    )!;
    expect(orvalConfig).toContain(testUrl);
  });

  it("should throw on invalid URLs", () => {
    expect(() => {
      configureOpenApi(PROJECT_DIR, "not-a-valid-url");
    }).toThrow("Invalid URL format");
  });

  it("should rename exampleApi when API name differs", () => {
    const testUrl =
      "https://localhost:44391/umbraco/swagger/commerce/swagger.json";

    configureOpenApi(PROJECT_DIR, testUrl, "Commerce API");

    const orvalConfig = mockFs.files.get(
      path.resolve(PROJECT_DIR, "orval.config.ts")
    )!;
    expect(orvalConfig).toContain("commerceApi");
    expect(orvalConfig).not.toContain("exampleApi");
  });

  it("should NOT rename when API name resolves to exampleApi", () => {
    const testUrl =
      "https://localhost:44391/umbraco/swagger/example/swagger.json";

    const before = mockFs.files.get(
      path.resolve(PROJECT_DIR, "orval.config.ts")
    )!;

    configureOpenApi(PROJECT_DIR, testUrl, "Example API");

    const after = mockFs.files.get(
      path.resolve(PROJECT_DIR, "orval.config.ts")
    )!;
    // exampleApi should still be present (not renamed to itself)
    expect(after).toContain("exampleApi");
    // But the URL should be updated
    expect(after).toContain(testUrl);
  });

  it("should return false when orval.config.ts has no matching pattern", () => {
    // Replace orval config with content that has no matching patterns
    mockFs.files.set(
      path.resolve(PROJECT_DIR, "orval.config.ts"),
      "export default {};\n"
    );

    const result = configureOpenApi(
      PROJECT_DIR,
      "https://localhost:44391/umbraco/swagger/commerce/swagger.json"
    );
    expect(result).toBe(false);
  });

  it("should throw when orval.config.ts is missing", () => {
    mockFs.files.delete(path.resolve(PROJECT_DIR, "orval.config.ts"));

    expect(() => {
      configureOpenApi(
        PROJECT_DIR,
        "https://localhost:44391/umbraco/swagger/commerce/swagger.json"
      );
    }).toThrow("orval.config.ts not found");
  });
});

// ── detectBaseUrl priority ─────────────────────────────────────────────────

describe("detectBaseUrl priority", () => {
  it("should prefer launchSettings over .env and orval", () => {
    // Set all three sources
    mockFs.files.set(
      path.resolve(PROJECT_DIR, "demo-site/Properties/launchSettings.json"),
      JSON.stringify({
        profiles: {
          Demo: { applicationUrl: "https://localhost:11111" },
        },
      })
    );
    mockFs.files.set(
      path.resolve(PROJECT_DIR, ".env"),
      "UMBRACO_BASE_URL=https://localhost:22222\n"
    );
    const orvalPath = path.resolve(PROJECT_DIR, "orval.config.ts");
    let orvalContent = mockFs.files.get(orvalPath)!;
    orvalContent = orvalContent.replace(
      /target:\s*["'][^"']+["']/,
      'target: "https://localhost:33333/umbraco/swagger/commerce/swagger.json"'
    );
    mockFs.files.set(orvalPath, orvalContent);

    const result = detectBaseUrl(PROJECT_DIR);
    expect(result.url).toBe("https://localhost:11111");
    expect(result.source).toBe("launchSettings.json");
  });

  it("should prefer .env over orval when no launchSettings", () => {
    mockFs.files.set(
      path.resolve(PROJECT_DIR, ".env"),
      "UMBRACO_BASE_URL=https://localhost:22222\n"
    );
    const orvalPath = path.resolve(PROJECT_DIR, "orval.config.ts");
    let orvalContent = mockFs.files.get(orvalPath)!;
    orvalContent = orvalContent.replace(
      /target:\s*["'][^"']+["']/,
      'target: "https://localhost:33333/umbraco/swagger/commerce/swagger.json"'
    );
    mockFs.files.set(orvalPath, orvalContent);

    const result = detectBaseUrl(PROJECT_DIR);
    expect(result.url).toBe("https://localhost:22222");
    expect(result.source).toBe(".env");
  });

  it("should use orval as last resort", () => {
    const orvalPath = path.resolve(PROJECT_DIR, "orval.config.ts");
    let orvalContent = mockFs.files.get(orvalPath)!;
    orvalContent = orvalContent.replace(
      /target:\s*["'][^"']+["']/,
      'target: "https://localhost:33333/umbraco/swagger/commerce/swagger.json"'
    );
    mockFs.files.set(orvalPath, orvalContent);

    const result = detectBaseUrl(PROJECT_DIR);
    expect(result.url).toBe("https://localhost:33333");
    expect(result.source).toBe("orval.config.ts");
  });
});
