import { describe, it, expect } from "@jest/globals";
import { validateResourceMatch } from "../resource-match.js";

describe("validateResourceMatch", () => {
  const canonical = "https://worker.example.com/at/demo";

  it("accepts byte-equal match", () => {
    expect(validateResourceMatch(canonical, canonical)).toEqual({ ok: true });
  });

  it("accepts when sent is undefined (synthesis path)", () => {
    expect(validateResourceMatch(undefined, canonical)).toEqual({ ok: true });
  });

  it("accepts when sent is empty string (treated as absent)", () => {
    expect(validateResourceMatch("", canonical)).toEqual({ ok: true });
  });

  it("accepts an array containing exactly the canonical value", () => {
    expect(validateResourceMatch([canonical], canonical)).toEqual({ ok: true });
  });

  it("rejects trailing-slash variant", () => {
    const r = validateResourceMatch(`${canonical}/`, canonical);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("does not match");
  });

  it("rejects /mcp suffix variant", () => {
    const r = validateResourceMatch(`${canonical}/mcp`, canonical);
    expect(r.ok).toBe(false);
  });

  it("rejects different-tenant alias", () => {
    const r = validateResourceMatch("https://worker.example.com/at/other", canonical);
    expect(r.ok).toBe(false);
  });

  it("rejects host mismatch", () => {
    const r = validateResourceMatch("https://attacker.example.com/at/demo", canonical);
    expect(r.ok).toBe(false);
  });

  it("rejects scheme mismatch (http vs https)", () => {
    const r = validateResourceMatch("http://worker.example.com/at/demo", canonical);
    expect(r.ok).toBe(false);
  });

  it("rejects array with multiple values, none equal to canonical", () => {
    const r = validateResourceMatch(
      ["https://worker.example.com/at/other", `${canonical}/x`],
      canonical
    );
    expect(r.ok).toBe(false);
  });

  it("accepts array where one value is exactly canonical (any match wins)", () => {
    expect(validateResourceMatch([`${canonical}/x`, canonical], canonical)).toEqual({
      ok: true,
    });
  });
});
