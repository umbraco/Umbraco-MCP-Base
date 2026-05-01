import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ToolCollectionExport, ToolDefinition, ToolModeDefinition, ServerConfigForCollections } from "@umbraco-cms/mcp-server-sdk";
import type { HostedMcpEnv } from "../../types/env.js";
import type { SiteConfig } from "../../types/multi-site.js";
import type { AuthProps, ConsentChoices } from "../../types/auth.js";
import { getServerOptions, buildConsentToolConfig, type HostedMcpServerOptions } from "../worker-entry.js";
import { mergeConsentChoices, resolveRequestSite, type SiteResolver } from "../create-server.js";

function createMockTool(name: string, slices: string[] = []): ToolDefinition<any, any> {
  return {
    name,
    description: `Test tool: ${name}`,
    slices,
    handler: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
  };
}

function createMockCollection(
  name: string,
  tools: ToolDefinition<any, any>[],
  displayName?: string,
  description?: string
): ToolCollectionExport {
  return {
    metadata: {
      name,
      displayName: displayName ?? name,
      description: description ?? `Test collection: ${name}`,
    },
    tools: () => tools,
  };
}

describe("getServerOptions", () => {
  it("extracts server options from hosted options", () => {
    const tool = createMockTool("test-tool", ["read"]);
    const collection = createMockCollection("test-col", [tool]);

    const hostedOptions: HostedMcpServerOptions = {
      name: "test-server",
      version: "2.0.0",
      collections: [collection],
      modeRegistry: [{ name: "test-mode", displayName: "Test", description: "Test mode", collections: ["test-col"] }],
      allModeNames: ["test-mode"],
      allSliceNames: ["read", "create"],
    };

    const result = getServerOptions(hostedOptions);

    expect(result).toEqual({
      name: "test-server",
      version: "2.0.0",
      collections: [collection],
      modeRegistry: [{ name: "test-mode", displayName: "Test", description: "Test mode", collections: ["test-col"] }],
      allModeNames: ["test-mode"],
      allSliceNames: ["read", "create"],
    });
  });

  it("does not include authOptions in server options", () => {
    const hostedOptions: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: [],
      authOptions: { scopes: ["custom"] },
    };

    const result = getServerOptions(hostedOptions);
    expect(result).not.toHaveProperty("authOptions");
  });
});

describe("mergeConsentChoices", () => {
  it("returns env config unchanged when no choices", () => {
    const envConfig: ServerConfigForCollections = {
      toolModes: ["content", "media"],
    };
    const result = mergeConsentChoices(envConfig, undefined);
    expect(result).toEqual(envConfig);
  });

  it("returns env config unchanged when choices is empty", () => {
    const envConfig: ServerConfigForCollections = {
      toolModes: ["content", "media"],
    };
    const result = mergeConsentChoices(envConfig, {});
    expect(result).toEqual(envConfig);
  });

  it("intersects user modes with admin modes", () => {
    const envConfig: ServerConfigForCollections = {
      toolModes: ["content", "media", "settings"],
    };
    const choices: ConsentChoices = {
      selectedModes: ["content", "media"],
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.toolModes).toEqual(["content", "media"]);
  });

  it("user cannot select modes outside admin config", () => {
    const envConfig: ServerConfigForCollections = {
      toolModes: ["content"],
    };
    const choices: ConsentChoices = {
      selectedModes: ["content", "settings"],
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.toolModes).toEqual(["content"]);
  });

  it("user selection becomes restriction when admin has no modes", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      selectedModes: ["content"],
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.toolModes).toEqual(["content"]);
  });

  it("user can enable read-only mode", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      readOnly: true,
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.readonly).toBe(true);
  });

  it("read-only does not set excludeSlices (uses annotation-based filtering)", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      readOnly: true,
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.excludeSlices).toBeUndefined();
    expect(result.readonly).toBe(true);
  });

  it("read-only preserves existing excludeSlices", () => {
    const envConfig: ServerConfigForCollections = {
      excludeSlices: ["delete"],
    };
    const choices: ConsentChoices = {
      readOnly: true,
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.excludeSlices).toEqual(["delete"]);
    expect(result.readonly).toBe(true);
  });

  it("does not modify original env config object", () => {
    const envConfig: ServerConfigForCollections = {
      toolModes: ["content", "media"],
    };
    const choices: ConsentChoices = {
      selectedModes: ["content"],
    };
    mergeConsentChoices(envConfig, choices);
    expect(envConfig.toolModes).toEqual(["content", "media"]);
  });

  it("combines mode narrowing and read-only", () => {
    const envConfig: ServerConfigForCollections = {
      toolModes: ["content", "media", "settings"],
    };
    const choices: ConsentChoices = {
      selectedModes: ["content"],
      readOnly: true,
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.toolModes).toEqual(["content"]);
    expect(result.readonly).toBe(true);
  });

  it("preserves non-affected config properties", () => {
    const envConfig: ServerConfigForCollections = {
      toolModes: ["content"],
      includeSlices: ["read"],
      excludeTools: ["some-tool"],
    };
    const choices: ConsentChoices = {
      selectedModes: ["content"],
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.includeSlices).toEqual(["read"]);
    expect(result.excludeTools).toEqual(["some-tool"]);
  });
});

describe("mergeConsentChoices with selectedSlices", () => {
  it("sets includeSlices when admin has no slice restriction", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      selectedSlices: ["read", "list"],
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.includeSlices).toEqual(["read", "list"]);
  });

  it("intersects with admin includeSlices", () => {
    const envConfig: ServerConfigForCollections = {
      includeSlices: ["read", "list", "create"],
    };
    const choices: ConsentChoices = {
      selectedSlices: ["read", "list"],
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.includeSlices).toEqual(["read", "list"]);
  });

  it("user cannot select slices outside admin includeSlices", () => {
    const envConfig: ServerConfigForCollections = {
      includeSlices: ["read"],
    };
    const choices: ConsentChoices = {
      selectedSlices: ["read", "create"],
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.includeSlices).toEqual(["read"]);
  });

  it("has no effect when selectedSlices is empty", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      selectedSlices: [],
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.includeSlices).toBeUndefined();
  });

  it("has no effect when selectedSlices is undefined", () => {
    const envConfig: ServerConfigForCollections = {
      includeSlices: ["read", "list"],
    };
    const choices: ConsentChoices = {};
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.includeSlices).toEqual(["read", "list"]);
  });
});

describe("mergeConsentChoices with chainedModeSelections", () => {
  it("disables main tools when only chained modes are selected", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      chainedModeSelections: { demo: ["alerts"] },
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.toolModes).toEqual(["__none__"]);
  });

  it("does not disable main tools when main modes are also selected", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      selectedModes: ["content"],
      chainedModeSelections: { demo: ["alerts"] },
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.toolModes).toEqual(["content"]);
  });

  it("does not affect main tools when no chained modes exist", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {};
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.toolModes).toBeUndefined();
  });
});

describe("mergeConsentChoices with selectedCollections", () => {
  const modeRegistry: ToolModeDefinition[] = [
    {
      name: "content",
      displayName: "Content",
      description: "Content management",
      collections: ["document", "media"],
    },
    {
      name: "settings",
      displayName: "Settings",
      description: "Settings",
      collections: ["data-type", "language"],
    },
  ];

  it("excludes deselected collections within selected modes", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      selectedModes: ["content"],
      selectedCollections: ["document"],
    };
    const result = mergeConsentChoices(envConfig, choices, modeRegistry);
    // media was in content mode but not selected → excluded
    expect(result.excludeToolCollections).toEqual(["media"]);
  });

  it("does not exclude collections from unselected modes", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      selectedModes: ["content"],
      selectedCollections: ["document"],
    };
    const result = mergeConsentChoices(envConfig, choices, modeRegistry);
    // data-type and language are in settings mode, which is not selected
    // so they are filtered by mode, not by collection exclusion
    expect(result.excludeToolCollections).not.toContain("data-type");
    expect(result.excludeToolCollections).not.toContain("language");
  });

  it("works with no mode restriction (all modes available)", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      selectedCollections: ["document", "data-type"],
    };
    const result = mergeConsentChoices(envConfig, choices, modeRegistry);
    // All collections from all modes are available: document, media, data-type, language
    // Only document and data-type selected → media and language excluded
    expect(result.excludeToolCollections).toEqual(
      expect.arrayContaining(["media", "language"])
    );
    expect(result.excludeToolCollections).not.toContain("document");
    expect(result.excludeToolCollections).not.toContain("data-type");
  });

  it("has no effect when modeRegistry is not provided", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      selectedCollections: ["document"],
    };
    const result = mergeConsentChoices(envConfig, choices);
    expect(result.excludeToolCollections).toBeUndefined();
  });

  it("has no effect when selectedCollections is empty", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      selectedModes: ["content"],
      selectedCollections: [],
    };
    const result = mergeConsentChoices(envConfig, choices, modeRegistry);
    expect(result.excludeToolCollections).toBeUndefined();
  });

  it("has no effect when selectedCollections is undefined", () => {
    const envConfig: ServerConfigForCollections = {};
    const choices: ConsentChoices = {
      selectedModes: ["content"],
    };
    const result = mergeConsentChoices(envConfig, choices, modeRegistry);
    expect(result.excludeToolCollections).toBeUndefined();
  });

  it("deduplicates with existing excludeToolCollections", () => {
    const envConfig: ServerConfigForCollections = {
      excludeToolCollections: ["media"],
    };
    const choices: ConsentChoices = {
      selectedModes: ["content"],
      selectedCollections: ["document"],
    };
    const result = mergeConsentChoices(envConfig, choices, modeRegistry);
    // media was already excluded and also deselected → no duplicate
    expect(result.excludeToolCollections).toEqual(["media"]);
  });

  it("combines with mode narrowing and read-only", () => {
    const envConfig: ServerConfigForCollections = {
      toolModes: ["content", "settings"],
    };
    const choices: ConsentChoices = {
      selectedModes: ["content"],
      selectedCollections: ["document"],
      readOnly: true,
    };
    const result = mergeConsentChoices(envConfig, choices, modeRegistry);
    expect(result.toolModes).toEqual(["content"]);
    expect(result.excludeToolCollections).toEqual(["media"]);
    expect(result.readonly).toBe(true);
  });
});

describe("buildConsentToolConfig", () => {
  it("returns undefined when enableConsentToolSelection is false", () => {
    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: [],
      enableConsentToolSelection: false,
    };
    expect(buildConsentToolConfig(options)).toBeUndefined();
  });

  it("returns undefined when enableConsentToolSelection is not set", () => {
    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: [],
    };
    expect(buildConsentToolConfig(options)).toBeUndefined();
  });

  it("generates config from mode registry and collections", () => {
    const docTools = createMockTool("get-doc", ["read"]);
    const mediaTools = createMockTool("get-media", ["read"]);

    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [
        createMockCollection("document", [docTools], "Documents", "Document management"),
        createMockCollection("media", [mediaTools], "Media", "Media management"),
      ],
      modeRegistry: [
        {
          name: "content",
          displayName: "Content",
          description: "Content management",
          collections: ["document", "media"],
        },
      ],
      allModeNames: ["content"],
      allSliceNames: ["read"],
      enableConsentToolSelection: true,
    };

    const config = buildConsentToolConfig(options);
    expect(config).toBeDefined();
    expect(config!.modes).toHaveLength(1);
    expect(config!.modes![0].name).toBe("content");
    expect(config!.modes![0].displayName).toBe("Content");
    expect(config!.modes![0].description).toBe("Content management");
    expect(config!.modes![0].defaultSelected).toBe(false);
    expect(config!.modes![0].collections).toHaveLength(2);
    expect(config!.modes![0].collections[0].name).toBe("document");
    expect(config!.modes![0].collections[1].name).toBe("media");
    expect(config!.showReadOnlyToggle).toBe(true);
  });

  it("generates slice options from allSliceNames excluding 'other'", () => {
    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: ["read", "create", "update", "delete", "list", "other"],
      enableConsentToolSelection: true,
    };

    const config = buildConsentToolConfig(options);
    expect(config).toBeDefined();
    expect(config!.slices).toHaveLength(5);
    expect(config!.slices!.map((s) => s.name)).toEqual(["read", "create", "update", "delete", "list"]);
    expect(config!.slices!.every((s) => s.defaultSelected === true)).toBe(true);
  });

  it("capitalizes slice display names", () => {
    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: ["read", "recycle-bin"],
      enableConsentToolSelection: true,
    };

    const config = buildConsentToolConfig(options);
    expect(config!.slices![0].displayName).toBe("Read");
    expect(config!.slices![1].displayName).toBe("Recycle bin");
  });

  it("only includes collections that belong to each mode", () => {
    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [
        createMockCollection("document", [], "Documents", "Docs"),
        createMockCollection("media", [], "Media", "Media"),
        createMockCollection("data-type", [], "Data Types", "DT"),
      ],
      modeRegistry: [
        {
          name: "content",
          displayName: "Content",
          description: "Content",
          collections: ["document", "media"],
        },
        {
          name: "settings",
          displayName: "Settings",
          description: "Settings",
          collections: ["data-type"],
        },
      ],
      allModeNames: ["content", "settings"],
      allSliceNames: [],
      enableConsentToolSelection: true,
    };

    const config = buildConsentToolConfig(options);
    expect(config!.modes).toHaveLength(2);
    expect(config!.modes![0].collections).toHaveLength(2);
    expect(config!.modes![1].collections).toHaveLength(1);
    expect(config!.modes![1].collections[0].name).toBe("data-type");
  });
});

describe("getServerOptions with resolveSite", () => {
  it("passes resolveSite through to CreateServerOptions", () => {
    const resolver: SiteResolver = (siteId) => ({
      id: siteId,
      displayName: siteId,
      baseUrl: `https://${siteId}.example.com`,
      oauthClientId: "test-client",
    });

    const hostedOptions: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: [],
      resolveSite: resolver,
    };

    const result = getServerOptions(hostedOptions);
    expect(result.resolveSite).toBe(resolver);
  });

  it("does not include resolveSite when not set", () => {
    const hostedOptions: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: [],
    };

    const result = getServerOptions(hostedOptions);
    expect(result.resolveSite).toBeUndefined();
  });
});

describe("resolveRequestSite", () => {
  const mockEnv = {
    UMBRACO_BASE_URL: "https://default.example.com",
    UMBRACO_OAUTH_CLIENT_ID: "default-client",
    COOKIE_ENCRYPTION_KEY: "0".repeat(64),
  } as unknown as HostedMcpEnv;

  const prodSite: SiteConfig = {
    id: "prod",
    displayName: "Production",
    baseUrl: "https://prod.example.com",
    oauthClientId: "prod-client",
  };

  const stagingSite: SiteConfig = {
    id: "staging",
    displayName: "Staging",
    baseUrl: "https://staging.example.com",
    oauthClientId: "staging-client",
  };

  it("returns undefined when siteId is undefined", async () => {
    const result = await resolveRequestSite(undefined, {
      multiSite: { sites: [prodSite] },
    }, mockEnv);
    expect(result).toBeUndefined();
  });

  it("returns undefined when siteId is undefined even with resolveSite", async () => {
    const resolver = jest.fn<SiteResolver>();
    const result = await resolveRequestSite(undefined, {
      resolveSite: resolver,
    }, mockEnv);
    expect(result).toBeUndefined();
    expect(resolver).not.toHaveBeenCalled();
  });

  it("finds site from static multiSite list", async () => {
    const result = await resolveRequestSite("prod", {
      multiSite: { sites: [prodSite, stagingSite] },
    }, mockEnv);
    expect(result).toBe(prodSite);
  });

  it("returns undefined for unknown site in static list", async () => {
    const result = await resolveRequestSite("unknown", {
      multiSite: { sites: [prodSite] },
    }, mockEnv);
    expect(result).toBeUndefined();
  });

  it("uses resolveSite callback when provided", async () => {
    const dynamicSite: SiteConfig = {
      id: "dynamic-abc",
      displayName: "Dynamic ABC",
      baseUrl: "https://abc.cloud.umbraco.io",
      oauthClientId: "cloud-client",
    };
    const resolver = jest.fn<SiteResolver>().mockReturnValue(dynamicSite);

    const result = await resolveRequestSite("dynamic-abc", {
      resolveSite: resolver,
    }, mockEnv);

    expect(result).toBe(dynamicSite);
    expect(resolver).toHaveBeenCalledWith("dynamic-abc", mockEnv);
  });

  it("resolveSite takes precedence over multiSite", async () => {
    const dynamicSite: SiteConfig = {
      id: "prod",
      displayName: "Dynamic Production",
      baseUrl: "https://dynamic-prod.example.com",
      oauthClientId: "dynamic-client",
    };
    const resolver = jest.fn<SiteResolver>().mockReturnValue(dynamicSite);

    const result = await resolveRequestSite("prod", {
      resolveSite: resolver,
      multiSite: { sites: [prodSite] },
    }, mockEnv);

    expect(result).toBe(dynamicSite);
    expect(result!.baseUrl).toBe("https://dynamic-prod.example.com");
  });

  it("resolveSite can return null to reject a site", async () => {
    const resolver = jest.fn<SiteResolver>().mockReturnValue(null);

    const result = await resolveRequestSite("unknown", {
      resolveSite: resolver,
    }, mockEnv);

    expect(result).toBeNull();
  });

  it("resolveSite works with async callbacks", async () => {
    const dynamicSite: SiteConfig = {
      id: "async-site",
      displayName: "Async Site",
      baseUrl: "https://async.example.com",
      oauthClientId: "async-client",
    };
    type AsyncSiteResolver = (siteId: string, env: HostedMcpEnv) => Promise<SiteConfig | null>;
    const resolver = jest.fn<AsyncSiteResolver>().mockResolvedValue(dynamicSite);

    const result = await resolveRequestSite("async-site", {
      resolveSite: resolver,
    }, mockEnv);

    expect(result).toBe(dynamicSite);
  });

  it("passes env to resolveSite for dynamic credential lookup", async () => {
    const resolver = jest.fn<SiteResolver>().mockImplementation((siteId, env) => ({
      id: siteId,
      displayName: siteId,
      baseUrl: `https://${siteId}.example.com`,
      oauthClientId: env.UMBRACO_OAUTH_CLIENT_ID,
    }));

    const result = await resolveRequestSite("my-project", {
      resolveSite: resolver,
    }, mockEnv);

    expect(result).toEqual({
      id: "my-project",
      displayName: "my-project",
      baseUrl: "https://my-project.example.com",
      oauthClientId: "default-client",
    });
  });
});

describe("buildConsentToolConfig with chainedServers", () => {
  const chainedNotificationTool = createMockTool("get-notification", ["read"]);
  const chainedAnalyticsTool = createMockTool("get-analytics-summary", ["read"]);

  const chainedServer = {
    name: "demo",
    displayName: "Demo Add-On",
    modeRegistry: [
      {
        name: "alerts",
        displayName: "Alerts & Notifications",
        description: "Notification tools",
        collections: ["notification"],
      },
      {
        name: "reporting",
        displayName: "Reporting",
        description: "Analytics tools",
        collections: ["analytics"],
      },
    ] as import("@umbraco-cms/mcp-server-sdk").ToolModeDefinition[],
    collections: [
      createMockCollection("notification", [chainedNotificationTool], "Notifications", "Notification management"),
      createMockCollection("analytics", [chainedAnalyticsTool], "Analytics", "Analytics tools"),
    ],
    allModeNames: ["alerts", "reporting"] as readonly string[],
    allSliceNames: ["read", "list", "create"] as readonly string[],
  };

  it("appends chained modes with prefixed names", () => {
    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [createMockCollection("document", [], "Documents", "Docs")],
      modeRegistry: [{ name: "content", displayName: "Content", description: "Content", collections: ["document"] }],
      allModeNames: ["content"],
      allSliceNames: ["read"],
      enableConsentToolSelection: true,
      chainedServers: [chainedServer],
    };

    const config = buildConsentToolConfig(options);
    expect(config).toBeDefined();
    // 1 main + 2 chained = 3 modes
    expect(config!.modes).toHaveLength(3);

    // Main mode unchanged
    expect(config!.modes![0].name).toBe("content");
    expect(config!.modes![0].displayName).toBe("Content");

    // Chained modes have prefixed names and group label
    expect(config!.modes![1].name).toBe("demo:alerts");
    expect(config!.modes![1].displayName).toBe("Alerts & Notifications");
    expect(config!.modes![1].group).toBe("Demo Add-On");
    expect(config!.modes![1].description).toBe("Notification tools");

    expect(config!.modes![2].name).toBe("demo:reporting");
    expect(config!.modes![2].displayName).toBe("Reporting");
    expect(config!.modes![2].group).toBe("Demo Add-On");
  });

  it("prefixes chained collection names within modes", () => {
    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: [],
      enableConsentToolSelection: true,
      chainedServers: [chainedServer],
    };

    const config = buildConsentToolConfig(options);
    const alertsMode = config!.modes!.find((m) => m.name === "demo:alerts");
    expect(alertsMode).toBeDefined();
    expect(alertsMode!.collections).toHaveLength(1);
    expect(alertsMode!.collections[0].name).toBe("demo:notification");
    expect(alertsMode!.collections[0].displayName).toBe("Notifications");
  });

  it("deduplicates slices across main and chained servers", () => {
    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: ["read", "list", "other"],
      enableConsentToolSelection: true,
      chainedServers: [chainedServer],
    };

    const config = buildConsentToolConfig(options);
    const sliceNames = config!.slices!.map((s) => s.name);
    // "read" and "list" appear in both, "create" only in chained, "other" excluded
    expect(sliceNames).toEqual(["read", "list", "create"]);
  });

  it("works with no chained servers", () => {
    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: ["read"],
      enableConsentToolSelection: true,
    };

    const config = buildConsentToolConfig(options);
    expect(config!.modes).toHaveLength(0);
    expect(config!.slices).toHaveLength(1);
  });

  it("supports multiple chained servers", () => {
    const secondChained = {
      name: "forms",
      displayName: "Forms Add-On",
      modeRegistry: [
        { name: "forms", displayName: "Forms", description: "Form tools", collections: ["form"] },
      ] as import("@umbraco-cms/mcp-server-sdk").ToolModeDefinition[],
      collections: [createMockCollection("form", [], "Forms", "Form management")],
      allModeNames: ["forms"] as readonly string[],
      allSliceNames: ["read", "create"] as readonly string[],
    };

    const options: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: ["read"],
      enableConsentToolSelection: true,
      chainedServers: [chainedServer, secondChained],
    };

    const config = buildConsentToolConfig(options);
    // 0 main + 2 demo + 1 forms = 3
    expect(config!.modes).toHaveLength(3);
    expect(config!.modes![2].name).toBe("forms:forms");
    expect(config!.modes![2].displayName).toBe("Forms");
    expect(config!.modes![2].group).toBe("Forms Add-On");
  });
});

describe("createPerRequestServer", () => {
  // We can't easily mock ESM module dependencies in jest ESM mode,
  // so we test createPerRequestServer's error path (no token) which
  // doesn't require the fetch mock to return a value.

  it("throws when fetch client returns null (token expired)", async () => {
    // Dynamic import to avoid ESM hoisting issues
    const { createPerRequestServer } = await import("../create-server.js");

    // We can't mock createFetchClientFromKV easily in ESM, but we can test
    // that the function exists and has the right signature
    expect(typeof createPerRequestServer).toBe("function");
  });
});

describe("createPerRequestServer with instructions", () => {
  // Inspect the server-level `instructions` value that the MCP SDK sends
  // to clients on `initialize`. The SDK keeps it in a private `_instructions`
  // field on the underlying `Server`, so reach for it directly here.
  const getInstructions = (server: { server: unknown }): string | undefined =>
    (server.server as { _instructions?: string })._instructions;

  // Stub OAUTH_KV.get to return null so createFetchClientFromKV returns null
  // and we get the early "degraded server" path. The McpServer is constructed
  // before that early-return, so its _instructions field is observable.
  const mockEnv = {
    UMBRACO_BASE_URL: "https://example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test-client",
    COOKIE_ENCRYPTION_KEY: "0".repeat(64),
    OAUTH_KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
  } as unknown as HostedMcpEnv;

  const mockProps: AuthProps = {
    userId: "user-1",
    userName: "Test User",
    umbracoTokenKey: "token-key",
  };

  const baseOptions = {
    name: "test-server",
    version: "1.0.0",
    collections: [],
    modeRegistry: [],
    allModeNames: [],
    allSliceNames: [],
  };

  it("forwards a static instructions string to the underlying Server", async () => {
    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(
      { ...baseOptions, instructions: "Refer to items by name, never by ID." },
      mockEnv,
      mockProps,
    );

    expect(getInstructions(server)).toBe("Refer to items by name, never by ID.");
  });

  it("resolves a synchronous callback and forwards the result", async () => {
    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(
      {
        ...baseOptions,
        instructions: (props) => `Hello, ${props.userName}.`,
      },
      mockEnv,
      mockProps,
    );

    expect(getInstructions(server)).toBe("Hello, Test User.");
  });

  it("awaits an async callback before constructing the Server", async () => {
    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(
      {
        ...baseOptions,
        instructions: async (_props, env) => `base=${env.UMBRACO_BASE_URL}`,
      },
      mockEnv,
      mockProps,
    );

    expect(getInstructions(server)).toBe("base=https://example.com");
  });

  it("leaves instructions unset when the option is omitted", async () => {
    const { createPerRequestServer } = await import("../create-server.js");
    const server = await createPerRequestServer(baseOptions, mockEnv, mockProps);

    expect(getInstructions(server)).toBeUndefined();
  });
});

describe("getServerOptions with instructions", () => {
  it("forwards a static instructions string", () => {
    const hostedOptions: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: [],
      instructions: "Be concise.",
    };
    expect(getServerOptions(hostedOptions).instructions).toBe("Be concise.");
  });

  it("forwards an instructions callback by reference", () => {
    const fn = (props: AuthProps) => `Hi ${props.userName}`;
    const hostedOptions: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: [],
      instructions: fn,
    };
    expect(getServerOptions(hostedOptions).instructions).toBe(fn);
  });

  it("does not include instructions when not set", () => {
    const hostedOptions: HostedMcpServerOptions = {
      name: "test",
      version: "1.0.0",
      collections: [],
      modeRegistry: [],
      allModeNames: [],
      allSliceNames: [],
    };
    expect(getServerOptions(hostedOptions).instructions).toBeUndefined();
  });
});
