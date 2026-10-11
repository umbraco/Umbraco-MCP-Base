/**
 * `resource_metadata` helpers shared by `createWorkerExport`'s 401 rewrite and
 * `createSiteRoutingApiHandler`'s expired-sign-in 401 (#103, #371).
 */

import { describe, expect, it } from "@jest/globals";
import {
  resourceMetadataUrlFor,
  rewriteResourceMetadataForTenant,
} from "../resource-metadata.js";

const ORIGIN = "https://worker.example.com";
const ROOT_PRM = `${ORIGIN}/.well-known/oauth-protected-resource`;

describe("resourceMetadataUrlFor", () => {
  it("uses the provider's path-suffixed formula on a tenant path", () => {
    expect(resourceMetadataUrlFor(`${ORIGIN}/at/abc/mcp`)).toBe(`${ROOT_PRM}/at/abc/mcp`);
  });

  it("uses the provider's path-suffixed formula on a non-tenant path", () => {
    expect(resourceMetadataUrlFor(`${ORIGIN}/mcp`)).toBe(`${ROOT_PRM}/mcp`);
  });

  it("ignores the query string, as the provider does", () => {
    expect(resourceMetadataUrlFor(`${ORIGIN}/mcp?x=1`)).toBe(`${ROOT_PRM}/mcp`);
  });

  it("throws on a malformed URL (a Request never carries one)", () => {
    expect(() => resourceMetadataUrlFor("not a url")).toThrow(/Invalid URL/);
  });
});

describe("rewriteResourceMetadataForTenant", () => {
  it("rewrites the root PRM to the tenant PRM on a tenant path", () => {
    expect(rewriteResourceMetadataForTenant(ROOT_PRM, `${ORIGIN}/at/abc/mcp`)).toBe(`${ROOT_PRM}/at/abc`);
  });

  it("leaves the root PRM alone on a non-tenant path", () => {
    expect(rewriteResourceMetadataForTenant(ROOT_PRM, `${ORIGIN}/mcp`)).toBe(ROOT_PRM);
  });

  it("leaves a value that isn't the root PRM alone", () => {
    const value = `${ROOT_PRM}/at/abc/mcp`;
    expect(rewriteResourceMetadataForTenant(value, `${ORIGIN}/at/abc/mcp`)).toBe(value);
  });

  it("does not treat a bare /at/<alias> (no trailing segment) as a tenant path", () => {
    expect(rewriteResourceMetadataForTenant(ROOT_PRM, `${ORIGIN}/at/abc`)).toBe(ROOT_PRM);
  });

  it("throws on a malformed request URL", () => {
    expect(() => rewriteResourceMetadataForTenant(ROOT_PRM, "not a url")).toThrow(/Invalid URL/);
  });
});
