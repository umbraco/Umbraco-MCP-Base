import { describe, expect, it } from "@jest/globals";
import {
  buildPrefixRegex,
  extractSiteIdFromPath,
  extractSiteIdFromResource,
} from "../path-prefix.js";

describe("buildPrefixRegex", () => {
  it("matches the MCP endpoint with a trailing slash", () => {
    const regex = buildPrefixRegex("/at/:siteId");
    expect("/at/abc/".match(regex)?.[1]).toBe("abc");
  });

  it("matches the MCP endpoint without a trailing slash", () => {
    const regex = buildPrefixRegex("/at/:siteId");
    expect("/at/abc".match(regex)?.[1]).toBe("abc");
  });

  it("does not match a deeper path", () => {
    const regex = buildPrefixRegex("/at/:siteId");
    expect("/at/abc/extra".match(regex)).toBeNull();
  });

  it("does not match an unrelated path", () => {
    const regex = buildPrefixRegex("/at/:siteId");
    expect("/authorize".match(regex)).toBeNull();
    expect("/callback/abc".match(regex)).toBeNull();
    expect("/.well-known/oauth-authorization-server".match(regex)).toBeNull();
  });

  it("supports custom prefixes", () => {
    const regex = buildPrefixRegex("/sites/:siteId");
    expect("/sites/my-project/".match(regex)?.[1]).toBe("my-project");
  });

  it("captures Cloud-style aliases including dev- prefix", () => {
    const regex = buildPrefixRegex("/at/:siteId");
    expect(
      "/at/dev-hosted-mcp-worker-test/".match(regex)?.[1]
    ).toBe("dev-hosted-mcp-worker-test");
  });

  it("rejects a prefix without a leading slash", () => {
    expect(() => buildPrefixRegex("at/:siteId")).toThrow(/leading|start/i);
  });

  it("rejects a prefix with no parameter", () => {
    expect(() => buildPrefixRegex("/at")).toThrow(/parameter/i);
  });

  it("rejects a prefix with multiple parameters", () => {
    expect(() => buildPrefixRegex("/at/:env/:siteId")).toThrow(/parameter/i);
  });
});

describe("extractSiteIdFromPath", () => {
  const regex = buildPrefixRegex("/at/:siteId");

  it("returns the site id when the path matches", () => {
    expect(extractSiteIdFromPath("/at/abc/", regex)).toBe("abc");
  });

  it("returns null when the path does not match", () => {
    expect(extractSiteIdFromPath("/authorize", regex)).toBeNull();
  });
});

describe("extractSiteIdFromResource", () => {
  const regex = buildPrefixRegex("/at/:siteId");

  it("extracts from a full resource URL", () => {
    expect(
      extractSiteIdFromResource("https://mcp.example.com/at/abc/", regex)
    ).toBe("abc");
  });

  it("extracts from the first matching value when given an array", () => {
    expect(
      extractSiteIdFromResource(
        ["https://mcp.example.com/something-else", "https://mcp.example.com/at/abc/"],
        regex
      )
    ).toBe("abc");
  });

  it("extracts from a path-only resource value", () => {
    expect(extractSiteIdFromResource("/at/abc", regex)).toBe("abc");
  });

  it("returns null when undefined", () => {
    expect(extractSiteIdFromResource(undefined, regex)).toBeNull();
  });

  it("returns null when the resource does not match the prefix", () => {
    expect(
      extractSiteIdFromResource("https://mcp.example.com/elsewhere", regex)
    ).toBeNull();
  });
});
