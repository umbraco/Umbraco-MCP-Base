// packages/mcp-server-sdk/src/cli/__tests__/permissive-user.test.ts
import { describe, it, expect } from "@jest/globals";
import { createPermissiveCodegenUser } from "../permissive-user.js";

describe("createPermissiveCodegenUser", () => {
  it("returns true for .includes on any property's array", () => {
    const user = createPermissiveCodegenUser();
    expect((user as any).allowedSections.includes("Umb.Section.Anything")).toBe(true);
    expect((user as any).fallbackPermissions.includes("Custom.Permission")).toBe(true);
  });

  it("returns true for .some / .every regardless of predicate", () => {
    const user = createPermissiveCodegenUser();
    expect((user as any).allowedSections.some((s: string) => s === "never-matches")).toBe(true);
    expect((user as any).fallbackPermissions.every(() => false)).toBe(true);
  });

  it("returns true for .find / .findIndex / .indexOf without enumerating values", () => {
    const user = createPermissiveCodegenUser();
    expect((user as any).fallbackPermissions.find(() => false)).toBeTruthy();
    expect((user as any).fallbackPermissions.findIndex(() => false)).toBe(0);
    expect((user as any).fallbackPermissions.indexOf("anything")).toBe(0);
  });

  it("supports nested object predicates like userGroupIds.some(g => g.id === ADMIN_KEY)", () => {
    const user = createPermissiveCodegenUser();
    const result = (user as any).userGroupIds.some(
      (g: { id: string }) => g.id.toUpperCase() === "ADMIN-KEY",
    );
    expect(result).toBe(true);
  });

  it("returns truthy for any property access on the user object", () => {
    const user = createPermissiveCodegenUser();
    expect((user as any).iAmANewSectionAddedTomorrow).toBeTruthy();
    expect((user as any).iAmANewSectionAddedTomorrow.some(() => false)).toBe(true);
  });

  it("does not enumerate any section/permission strings", async () => {
    // Read the source file as text and check no Umb.Section.* literals appear.
    // This codifies the AC: "doesn't enumerate section strings — uses Proxy or equivalent".
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "..", "permissive-user.ts"), "utf8");
    expect(src).not.toMatch(/Umb\.Section\./);
  });
});
