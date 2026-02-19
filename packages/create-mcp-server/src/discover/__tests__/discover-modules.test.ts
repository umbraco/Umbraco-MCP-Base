/**
 * Tests for discover module pure-logic functions.
 *
 * Tests pure logic modules directly with mock data.
 * No scaffolding, no filesystem — these run instantly.
 */

import { analyzeSpec, type ApiAnalysis } from "../analyze-api.js";
import { suggestFallbackModes, groupsToCollectionNames } from "../suggest-modes.js";
import { extractPermissions } from "../extract-permissions.js";
import { parseSwaggerUiHtml } from "../discover-swagger.js";

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
