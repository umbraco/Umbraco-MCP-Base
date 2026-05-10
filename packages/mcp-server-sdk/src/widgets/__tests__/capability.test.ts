import { describe, expect, it, jest } from "@jest/globals";
import {
  getClientElicitationCapabilities,
  getSupportedElicitationKind,
  hostSupportsMcpApps,
} from "../capability.js";

describe("widgets/capability", () => {
  describe("getClientElicitationCapabilities", () => {
    it("returns the caps object when getClientCapabilities is provided", () => {
      const caps = { elicitation: { form: true } };
      const server = { getClientCapabilities: () => caps } as unknown;
      expect(getClientElicitationCapabilities(server)).toBe(caps);
    });

    it("returns undefined on test mocks without getClientCapabilities", () => {
      const server = { elicitInput: jest.fn() } as unknown;
      expect(getClientElicitationCapabilities(server)).toBeUndefined();
    });

    it("returns undefined when getClientCapabilities returns null", () => {
      const server = { getClientCapabilities: () => null } as unknown;
      expect(getClientElicitationCapabilities(server)).toBeUndefined();
    });
  });

  describe("hostSupportsMcpApps", () => {
    it("returns true when caps are entirely empty (Claude.ai web shape)", () => {
      const server = { getClientCapabilities: () => ({}) } as unknown;
      expect(hostSupportsMcpApps(server)).toBe(true);
    });

    it("returns true for ChatGPT-style caps with proprietary keys but no elicitation.form", () => {
      const server = {
        getClientCapabilities: () => ({
          experimental: { "openai/visibility.enabled": true },
        }),
      } as unknown;
      expect(hostSupportsMcpApps(server)).toBe(true);
    });

    it("returns false for terminal hosts that advertise elicitation.form", () => {
      const server = {
        getClientCapabilities: () => ({ elicitation: { form: true } }),
      } as unknown;
      expect(hostSupportsMcpApps(server)).toBe(false);
    });

    it("returns true when only base elicitation is advertised (no .form sub-cap)", () => {
      const server = {
        getClientCapabilities: () => ({ elicitation: {} }),
      } as unknown;
      expect(hostSupportsMcpApps(server)).toBe(true);
    });

    it("returns true when getClientCapabilities is missing — conservative default for unknown hosts", () => {
      const server = { elicitInput: jest.fn() } as unknown;
      expect(hostSupportsMcpApps(server)).toBe(true);
    });
  });

  describe("getSupportedElicitationKind", () => {
    it.each([
      [{ elicitation: { form: true } }, "form"],
      [{ elicitation: { form: false } }, "base"],
      [{ elicitation: {} }, "base"],
      [{}, "none"],
      [{ experimental: { "openai/foo": true } }, "none"],
    ])("classifies caps %j as %s", (caps, expected) => {
      const server = { getClientCapabilities: () => caps } as unknown;
      expect(getSupportedElicitationKind(server)).toBe(expected);
    });

    it("returns 'unknown' on test mocks without getClientCapabilities", () => {
      const server = { elicitInput: jest.fn() } as unknown;
      expect(getSupportedElicitationKind(server)).toBe("unknown");
    });
  });
});
