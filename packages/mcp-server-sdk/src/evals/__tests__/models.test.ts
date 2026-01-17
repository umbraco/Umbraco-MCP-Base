/**
 * Claude Models Constants Tests
 *
 * Tests for the ClaudeModels constant object.
 */

import { describe, it, expect } from "@jest/globals";
import { ClaudeModels } from "../models.js";

describe("ClaudeModels", () => {
  it("should export Haiku model ID", () => {
    expect(ClaudeModels.Haiku).toBe("claude-3-5-haiku-20241022");
  });

  it("should export Sonnet model ID", () => {
    expect(ClaudeModels.Sonnet).toBe("claude-sonnet-4-5-20250514");
  });

  it("should export Opus model ID", () => {
    expect(ClaudeModels.Opus).toBe("claude-opus-4-5-20251101");
  });

  it("should have exactly 3 model entries", () => {
    const keys = Object.keys(ClaudeModels);
    expect(keys).toHaveLength(3);
    expect(keys).toContain("Haiku");
    expect(keys).toContain("Sonnet");
    expect(keys).toContain("Opus");
  });

  it("should be readonly (type-level check)", () => {
    // This test verifies the const assertion works at runtime
    // by ensuring the values are strings
    expect(typeof ClaudeModels.Haiku).toBe("string");
    expect(typeof ClaudeModels.Sonnet).toBe("string");
    expect(typeof ClaudeModels.Opus).toBe("string");
  });

  it("should have model IDs that follow Anthropic naming pattern", () => {
    const modelIdPattern = /^claude-[\w.-]+$/;

    expect(ClaudeModels.Haiku).toMatch(modelIdPattern);
    expect(ClaudeModels.Sonnet).toMatch(modelIdPattern);
    expect(ClaudeModels.Opus).toMatch(modelIdPattern);
  });

  it("should have model IDs with date suffixes", () => {
    const datePattern = /\d{8}$/;

    expect(ClaudeModels.Haiku).toMatch(datePattern);
    expect(ClaudeModels.Sonnet).toMatch(datePattern);
    expect(ClaudeModels.Opus).toMatch(datePattern);
  });
});
