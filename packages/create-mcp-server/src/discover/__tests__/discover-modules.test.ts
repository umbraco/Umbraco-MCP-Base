/**
 * Tests for discover module functions.
 *
 * Tests pure logic modules directly with mock data, and
 * uses scaffolded projects for registry update tests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { analyzeSpec, type ApiAnalysis } from "../analyze-api.js";
import { suggestFallbackModes, groupsToCollectionNames } from "../suggest-modes.js";
import { extractPermissions } from "../extract-permissions.js";
import { parseSwaggerUiHtml } from "../discover-swagger.js";
import { updateModeRegistry, updateSliceRegistry } from "../update-registries.js";
import { updateEnvBaseUrl, detectBaseUrl, readLaunchSettingsUrl } from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// __dirname = packages/create-mcp-server/src/discover/__tests__
// Go up 5 levels to reach monorepo root
const ROOT_DIR = path.resolve(__dirname, "../../../../..");
const CREATE_SCRIPT = path.join(
  ROOT_DIR,
  "packages/create-mcp-server/dist/index.js"
);

const TEST_TIMEOUT = 30_000;

function createTestProject(name: string): string {
  const projectPath = path.join(ROOT_DIR, name);
  if (fs.existsSync(projectPath)) {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
  execSync(`node ${CREATE_SCRIPT} ${name}`, {
    cwd: ROOT_DIR,
    stdio: "pipe",
  });
  return projectPath;
}

function cleanupTestProject(projectPath: string): void {
  if (fs.existsSync(projectPath) && projectPath.includes("test-discover-")) {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
}

function readProjectFile(projectPath: string, relativePath: string): string {
  return fs.readFileSync(path.join(projectPath, relativePath), "utf-8");
}

// Mock OpenAPI spec for testing
function createMockSpec(options?: {
  title?: string;
  tags?: string[];
  withSecurity?: boolean;
}) {
  const title = options?.title || "Test API";
  const tags = options?.tags || ["product", "order"];
  const withSecurity = options?.withSecurity ?? false;

  const paths: Record<string, Record<string, unknown>> = {};

  for (const tag of tags) {
    const plural = tag + "s";

    paths[`/api/${plural}`] = {
      get: {
        tags: [tag],
        operationId: `list-${plural}`,
        summary: `List all ${plural}`,
        ...(withSecurity ? { security: [{ "OAuth2": ["api"] }] } : {}),
      },
      post: {
        tags: [tag],
        operationId: `create-${tag}`,
        summary: `Create a ${tag}`,
        ...(withSecurity ? { security: [{ "OAuth2": ["api"] }] } : {}),
      },
    };

    paths[`/api/${plural}/{id}`] = {
      get: {
        tags: [tag],
        operationId: `get-${tag}`,
        summary: `Get ${tag} by ID`,
        ...(withSecurity ? { security: [{ "OAuth2": ["api"] }] } : {}),
      },
      put: {
        tags: [tag],
        operationId: `update-${tag}`,
        summary: `Update a ${tag}`,
        ...(withSecurity ? { security: [{ "OAuth2": ["api"] }] } : {}),
      },
      delete: {
        tags: [tag],
        operationId: `delete-${tag}`,
        summary: `Delete a ${tag}`,
        ...(withSecurity ? { security: [{ "OAuth2": ["api"] }] } : {}),
      },
    };
  }

  const spec: Record<string, unknown> = {
    info: { title },
    paths,
  };

  if (withSecurity) {
    spec.components = {
      securitySchemes: {
        OAuth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              scopes: {
                api: "API access",
              },
            },
          },
        },
      },
    };
  }

  return spec;
}

describe("analyzeApi", () => {
  it("should extract groups from OpenAPI spec", () => {
    const spec = createMockSpec({ tags: ["product", "order", "customer"] });
    const analysis = analyzeSpec(spec);

    expect(analysis.title).toBe("Test API");
    expect(analysis.groups).toHaveLength(3);
    expect(analysis.groups.map((g) => g.tag).sort()).toEqual([
      "customer",
      "order",
      "product",
    ]);
  });

  it("should count operations per group", () => {
    const spec = createMockSpec({ tags: ["product"] });
    const analysis = analyzeSpec(spec);

    expect(analysis.groups[0].operations).toHaveLength(5);
    expect(analysis.totalOperations).toBe(5);
  });

  it("should suggest correct slices", () => {
    const spec = createMockSpec({ tags: ["product"] });
    const analysis = analyzeSpec(spec);

    const group = analysis.groups[0];
    expect(group.sliceCounts).toHaveProperty("list");
    expect(group.sliceCounts).toHaveProperty("read");
    expect(group.sliceCounts).toHaveProperty("create");
    expect(group.sliceCounts).toHaveProperty("update");
    expect(group.sliceCounts).toHaveProperty("delete");
  });

  it("should detect search operations", () => {
    const spec = {
      info: { title: "Test" },
      paths: {
        "/api/products/search": {
          post: {
            tags: ["product"],
            operationId: "search-products",
            summary: "Search products",
          },
        },
      },
    };

    const analysis = analyzeSpec(spec);
    expect(analysis.groups[0].sliceCounts).toHaveProperty("search", 1);
    expect(analysis.slicesUsed).toContain("search");
  });

  it("should collect all unique slices used", () => {
    const spec = createMockSpec({ tags: ["product", "order"] });
    const analysis = analyzeSpec(spec);

    expect(analysis.slicesUsed).toContain("create");
    expect(analysis.slicesUsed).toContain("read");
    expect(analysis.slicesUsed).toContain("update");
    expect(analysis.slicesUsed).toContain("delete");
    expect(analysis.slicesUsed).toContain("list");
  });

  it("should handle empty spec", () => {
    const analysis = analyzeSpec({ info: { title: "Empty" }, paths: {} });

    expect(analysis.groups).toHaveLength(0);
    expect(analysis.totalOperations).toBe(0);
    expect(analysis.slicesUsed).toHaveLength(0);
  });
});

describe("suggestModes", () => {
  let analysis: ApiAnalysis;

  beforeAll(() => {
    const spec = createMockSpec({
      title: "Commerce API",
      tags: ["product", "order", "customer"],
    });
    analysis = analyzeSpec(spec);
  });

  it("should convert groups to kebab-case collection names", () => {
    const names = groupsToCollectionNames(analysis.groups);

    expect(names).toContain("product");
    expect(names).toContain("order");
    expect(names).toContain("customer");
  });

  it("should kebab-case camelCase tags", () => {
    const spec = {
      info: { title: "Test" },
      paths: {
        "/api/items": {
          get: {
            tags: ["OrderItem"],
            operationId: "list-order-items",
          },
        },
      },
    };
    const specAnalysis = analyzeSpec(spec);
    const names = groupsToCollectionNames(specAnalysis.groups);

    expect(names[0]).toBe("order-item");
  });

  it("should create fallback mode with all collections", () => {
    const modes = suggestFallbackModes(analysis.groups, analysis.title);

    expect(modes).toHaveLength(1);
    const mode = modes[0];
    expect(mode.name).toContain("-all");
    expect(mode.collections).toContain("product");
    expect(mode.collections).toContain("order");
    expect(mode.collections).toContain("customer");
  });

  it("should derive fallback mode name from API title", () => {
    const modes = suggestFallbackModes(analysis.groups, "Umbraco Commerce API");

    expect(modes[0].name).toBe("commerce-all");
  });
});

describe("extractPermissions", () => {
  it("should extract OAuth2 security scheme", () => {
    const spec = createMockSpec({ tags: ["product"], withSecurity: true });
    const permissions = extractPermissions(spec);

    expect(permissions.authSchemeType).toBe("oauth2");
    expect(permissions.authSchemeName).toBe("OAuth2");
  });

  it("should collect OAuth2 scopes", () => {
    const spec = createMockSpec({ tags: ["product"], withSecurity: true });
    const permissions = extractPermissions(spec);

    expect(permissions.scopes).toContain("api");
  });

  it("should count authenticated operations", () => {
    const spec = createMockSpec({ tags: ["product"], withSecurity: true });
    const permissions = extractPermissions(spec);

    expect(permissions.authenticatedCount).toBe(5);
    expect(permissions.unauthenticatedCount).toBe(0);
    expect(permissions.totalOperations).toBe(5);
  });

  it("should handle spec without security", () => {
    const spec = createMockSpec({ tags: ["product"], withSecurity: false });
    const permissions = extractPermissions(spec);

    expect(permissions.authSchemeType).toBeUndefined();
    expect(permissions.scopes).toHaveLength(0);
    expect(permissions.unauthenticatedCount).toBe(5);
  });

  it("should handle empty spec", () => {
    const permissions = extractPermissions({});

    expect(permissions.totalOperations).toBe(0);
    expect(permissions.scopes).toHaveLength(0);
  });
});

describe("parseSwaggerUiHtml", () => {
  it("should parse configObject with urls array", () => {
    const html = `
      <script>
        var configObject = JSON.parse('{"urls":[{"url":"management/swagger.json","name":"Umbraco Management API"},{"url":"commerce/swagger.json","name":"Umbraco Commerce API"}]}');
      </script>
    `;

    const endpoints = parseSwaggerUiHtml(html, "https://localhost:44331");

    expect(endpoints).toHaveLength(2);
    expect(endpoints[0].name).toBe("Umbraco Management API");
    expect(endpoints[0].url).toBe(
      "https://localhost:44331/umbraco/swagger/management/swagger.json"
    );
    expect(endpoints[1].name).toBe("Umbraco Commerce API");
  });

  it("should handle absolute URLs in config", () => {
    const html = `
      <script>
        var configObject = JSON.parse('{"urls":[{"url":"https://example.com/api/swagger.json","name":"External API"}]}');
      </script>
    `;

    const endpoints = parseSwaggerUiHtml(html, "https://localhost:44331");

    expect(endpoints[0].url).toBe("https://example.com/api/swagger.json");
  });

  it("should return empty array for HTML without config", () => {
    const html = "<html><body>No swagger here</body></html>";
    const endpoints = parseSwaggerUiHtml(html, "https://localhost:44331");

    expect(endpoints).toHaveLength(0);
  });

  it("should parse urls from alternative format", () => {
    const html = `
      <script>
        const config = {
          "urls": [{"url": "management/swagger.json", "name": "Management API"}]
        };
      </script>
    `;

    const endpoints = parseSwaggerUiHtml(html, "https://localhost:44331");

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].name).toBe("Management API");
  });
});

describe("updateRegistries", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-discover-registries");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should add modes to mode-registry.ts", () => {
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

    const added = updateModeRegistry(projectPath, modes);

    expect(added).toBe(2);

    const content = readProjectFile(
      projectPath,
      "src/config/mode-registry.ts"
    );
    expect(content).toContain("name: 'product'");
    expect(content).toContain("name: 'order'");
    expect(content).toContain("collections: ['product']");
  });

  it("should not duplicate existing modes", () => {
    const modes = [
      {
        name: "product",
        displayName: "Product Tools",
        description: "Product operations",
        collections: ["product"],
      },
    ];

    const added = updateModeRegistry(projectPath, modes);
    expect(added).toBe(0);
  });

  it("should be idempotent for modes", () => {
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

    const added = updateModeRegistry(projectPath, modes);
    expect(added).toBe(0);
  });

  it("should add slices to slice-registry.ts", () => {
    // 'search' already exists in the template, so use a novel slice
    const added = updateSliceRegistry(projectPath, ["custom-action"]);

    expect(added).toBe(1);

    const content = readProjectFile(
      projectPath,
      "src/config/slice-registry.ts"
    );
    expect(content).toContain("'custom-action'");
  });

  it("should not duplicate existing slices", () => {
    const added = updateSliceRegistry(projectPath, ["search"]);
    expect(added).toBe(0);
  });

  it("should be idempotent for slices", () => {
    const added = updateSliceRegistry(projectPath, ["custom-action"]);
    expect(added).toBe(0);
  });
});

describe("detectBaseUrl", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-discover-detect-url");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should detect URL from launchSettings.json", () => {
    // Create a mock Umbraco instance with launchSettings
    const propsDir = path.join(
      projectPath,
      "demo-site",
      "Properties"
    );
    fs.mkdirSync(propsDir, { recursive: true });
    fs.writeFileSync(
      path.join(propsDir, "launchSettings.json"),
      JSON.stringify({
        profiles: {
          UmbracoInstance: {
            applicationUrl: "https://localhost:44391;http://localhost:5000",
          },
        },
      })
    );

    const result = detectBaseUrl(projectPath);

    expect(result.url).toBe("https://localhost:44391");
    expect(result.source).toBe("launchSettings.json");
  });

  it("should prefer launchSettings over .env", () => {
    // .env also exists from the template
    const envPath = path.join(projectPath, ".env");
    fs.writeFileSync(envPath, "UMBRACO_BASE_URL=https://localhost:99999\n");

    const result = detectBaseUrl(projectPath);

    // launchSettings wins
    expect(result.url).toBe("https://localhost:44391");
    expect(result.source).toBe("launchSettings.json");
  });

  it("should fall back to .env when no launchSettings", () => {
    // Remove demo-site dir
    fs.rmSync(path.join(projectPath, "demo-site"), {
      recursive: true,
      force: true,
    });

    const result = detectBaseUrl(projectPath);

    expect(result.url).toBe("https://localhost:99999");
    expect(result.source).toBe(".env");
  });

  it("should fall back to orval.config.ts when no .env or launchSettings", () => {
    // Remove .env
    fs.unlinkSync(path.join(projectPath, ".env"));

    // Set a remote URL in orval.config.ts
    const orvalPath = path.join(projectPath, "orval.config.ts");
    let content = fs.readFileSync(orvalPath, "utf-8");
    content = content.replace(
      /target:\s*["']\.\/src\/api\/openapi\.yaml["']/,
      'target: "https://localhost:44331/umbraco/swagger/commerce/swagger.json"'
    );
    fs.writeFileSync(orvalPath, content);

    const result = detectBaseUrl(projectPath);

    expect(result.url).toBe("https://localhost:44331");
    expect(result.source).toBe("orval.config.ts");
  });

  it("should return empty when nothing is configured", () => {
    // Reset orval to local yaml
    const orvalPath = path.join(projectPath, "orval.config.ts");
    let content = fs.readFileSync(orvalPath, "utf-8");
    content = content.replace(
      /target:\s*["']https?:\/\/[^"']+["']/g,
      'target: "./src/api/openapi.yaml"'
    );
    fs.writeFileSync(orvalPath, content);

    const result = detectBaseUrl(projectPath);

    expect(result.url).toBeUndefined();
    expect(result.source).toBeUndefined();
  });
});

describe("readLaunchSettingsUrl", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-discover-launch");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should prefer HTTPS over HTTP", () => {
    const propsDir = path.join(
      projectPath,
      "demo-site",
      "Properties"
    );
    fs.mkdirSync(propsDir, { recursive: true });
    fs.writeFileSync(
      path.join(propsDir, "launchSettings.json"),
      JSON.stringify({
        profiles: {
          DemoSite: {
            applicationUrl: "http://localhost:5000;https://localhost:44391",
          },
        },
      })
    );

    const url = readLaunchSettingsUrl(projectPath);
    expect(url).toBe("https://localhost:44391");
  });

  it("should handle HTTP-only URLs", () => {
    const launchPath = path.join(
      projectPath,
      "demo-site",
      "Properties",
      "launchSettings.json"
    );
    fs.writeFileSync(
      launchPath,
      JSON.stringify({
        profiles: {
          TestInstance: {
            applicationUrl: "http://localhost:5000",
          },
        },
      })
    );

    const url = readLaunchSettingsUrl(projectPath);
    expect(url).toBe("http://localhost:5000");
  });

  it("should return undefined when no infrastructure directory", () => {
    const emptyProject = path.join(projectPath, "no-infra");
    fs.mkdirSync(emptyProject, { recursive: true });

    const url = readLaunchSettingsUrl(emptyProject);
    expect(url).toBeUndefined();
  });
});

describe("updateEnvBaseUrl", () => {
  let projectPath: string;

  beforeAll(() => {
    projectPath = createTestProject("test-discover-env");
  }, TEST_TIMEOUT);

  afterAll(() => {
    cleanupTestProject(projectPath);
  });

  it("should create .env from .env.example with updated base URL", () => {
    // Template has .env.example but no .env
    const envPath = path.join(projectPath, ".env");
    if (fs.existsSync(envPath)) {
      fs.unlinkSync(envPath);
    }

    const updated = updateEnvBaseUrl(
      projectPath,
      "https://localhost:44391"
    );

    expect(updated).toBe(true);
    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("UMBRACO_BASE_URL=https://localhost:44391");
  });

  it("should update existing UMBRACO_BASE_URL in .env", () => {
    const updated = updateEnvBaseUrl(
      projectPath,
      "https://localhost:55555"
    );

    expect(updated).toBe(true);
    const content = fs.readFileSync(
      path.join(projectPath, ".env"),
      "utf-8"
    );
    expect(content).toContain("UMBRACO_BASE_URL=https://localhost:55555");
    expect(content).not.toContain("UMBRACO_BASE_URL=https://localhost:44391");
  });

  it("should be idempotent", () => {
    const updated = updateEnvBaseUrl(
      projectPath,
      "https://localhost:55555"
    );

    expect(updated).toBe(false);
  });

  it("should append if UMBRACO_BASE_URL is missing from .env", () => {
    const envPath = path.join(projectPath, ".env");
    fs.writeFileSync(envPath, "SOME_OTHER_VAR=hello\n");

    const updated = updateEnvBaseUrl(
      projectPath,
      "https://localhost:44331"
    );

    expect(updated).toBe(true);
    const content = fs.readFileSync(envPath, "utf-8");
    expect(content).toContain("SOME_OTHER_VAR=hello");
    expect(content).toContain("UMBRACO_BASE_URL=https://localhost:44331");
  });
});

describe("combined workflow", () => {
  it("should produce consistent analysis and suggestions", () => {
    const spec = createMockSpec({
      title: "Umbraco Commerce API",
      tags: ["product", "order", "customer"],
      withSecurity: true,
    });

    const analysis = analyzeSpec(spec);
    const collections = groupsToCollectionNames(analysis.groups);
    const modes = suggestFallbackModes(analysis.groups, analysis.title);
    const permissions = extractPermissions(spec);

    // Analysis
    expect(analysis.groups).toHaveLength(3);
    expect(analysis.totalOperations).toBe(15); // 5 ops per group × 3 groups

    // Collections
    expect(collections).toHaveLength(3);
    expect(collections).toContain("product");
    expect(collections).toContain("order");
    expect(collections).toContain("customer");

    // Fallback modes
    expect(modes).toHaveLength(1);
    expect(modes[0].name).toBe("commerce-all");
    expect(modes[0].collections).toHaveLength(3);

    // Permissions
    expect(permissions.authSchemeType).toBe("oauth2");
    expect(permissions.authenticatedCount).toBe(15);
  });
});
