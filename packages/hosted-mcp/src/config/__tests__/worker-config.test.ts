import { loadWorkerConfig } from "../worker-config.js";
import type { HostedMcpEnv } from "../../types/env.js";

function createMockEnv(overrides: Partial<HostedMcpEnv> = {}): HostedMcpEnv {
  return {
    UMBRACO_BASE_URL: "https://example.com",
    UMBRACO_OAUTH_CLIENT_ID: "test-client",
    UMBRACO_OAUTH_CLIENT_SECRET: "test-secret",
    COOKIE_ENCRYPTION_KEY: "abc123",
    OAUTH_KV: {} as KVNamespace,
    MCP_AGENT: {} as DurableObjectNamespace,
    OAUTH_PROVIDER: {} as any,
    ...overrides,
  };
}

describe("loadWorkerConfig", () => {
  it("returns empty config when no env vars are set", () => {
    const config = loadWorkerConfig(createMockEnv());
    expect(config).toEqual({});
  });

  it("parses UMBRACO_TOOL_MODES as CSV", () => {
    const config = loadWorkerConfig(
      createMockEnv({ UMBRACO_TOOL_MODES: "content,media,settings" })
    );
    expect(config.toolModes).toEqual(["content", "media", "settings"]);
  });

  it("trims whitespace from CSV values", () => {
    const config = loadWorkerConfig(
      createMockEnv({ UMBRACO_TOOL_MODES: " content , media " })
    );
    expect(config.toolModes).toEqual(["content", "media"]);
  });

  it("ignores empty strings in CSV", () => {
    const config = loadWorkerConfig(
      createMockEnv({ UMBRACO_TOOL_MODES: "content,,media," })
    );
    expect(config.toolModes).toEqual(["content", "media"]);
  });

  it("parses UMBRACO_INCLUDE_SLICES", () => {
    const config = loadWorkerConfig(
      createMockEnv({ UMBRACO_INCLUDE_SLICES: "read,list" })
    );
    expect(config.includeSlices).toEqual(["read", "list"]);
  });

  it("parses UMBRACO_EXCLUDE_SLICES", () => {
    const config = loadWorkerConfig(
      createMockEnv({ UMBRACO_EXCLUDE_SLICES: "delete,create" })
    );
    expect(config.excludeSlices).toEqual(["delete", "create"]);
  });

  it("does not set toolModes when UMBRACO_TOOL_MODES is empty", () => {
    const config = loadWorkerConfig(
      createMockEnv({ UMBRACO_TOOL_MODES: "" })
    );
    expect(config.toolModes).toBeUndefined();
  });

  it("does not set toolModes when UMBRACO_TOOL_MODES is undefined", () => {
    const config = loadWorkerConfig(
      createMockEnv({ UMBRACO_TOOL_MODES: undefined })
    );
    expect(config.toolModes).toBeUndefined();
  });

  describe("UMBRACO_READONLY", () => {
    it('sets readOnly to true when "true"', () => {
      const config = loadWorkerConfig(
        createMockEnv({ UMBRACO_READONLY: "true" })
      );
      expect(config.readonly).toBe(true);
    });

    it("does not set readOnly when UMBRACO_READONLY is not true", () => {
      const config = loadWorkerConfig(
        createMockEnv({ UMBRACO_READONLY: "false" })
      );
      expect(config.readonly).toBeUndefined();
    });

    it("does not add write slices to excludeSlices (uses annotation-based filtering)", () => {
      const config = loadWorkerConfig(
        createMockEnv({ UMBRACO_READONLY: "true" })
      );
      expect(config.excludeSlices).toBeUndefined();
      expect(config.readonly).toBe(true);
    });

    it("preserves existing excludeSlices when readOnly is set", () => {
      const config = loadWorkerConfig(
        createMockEnv({
          UMBRACO_EXCLUDE_SLICES: "search",
          UMBRACO_READONLY: "true",
        })
      );
      expect(config.excludeSlices).toEqual(["search"]);
      expect(config.readonly).toBe(true);
    });
  });

  it("handles all options set together", () => {
    const config = loadWorkerConfig(
      createMockEnv({
        UMBRACO_TOOL_MODES: "content",
        UMBRACO_INCLUDE_SLICES: "read,list",
        UMBRACO_EXCLUDE_SLICES: "tree",
      })
    );
    expect(config.toolModes).toEqual(["content"]);
    expect(config.includeSlices).toEqual(["read", "list"]);
    expect(config.excludeSlices).toEqual(["tree"]);
  });
});
