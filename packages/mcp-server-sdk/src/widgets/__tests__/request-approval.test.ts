import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { setServerRef, clearServerRef } from "../../helpers/server-ref.js";
import {
  ElicitationUnsupportedError,
  requestApproval,
} from "../request-approval.js";

describe("widgets/requestApproval", () => {
  const mockElicitInput = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const mockRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const originalAutoConfirm = process.env.UMBRACO_AUTO_CONFIRM;

  afterEach(() => {
    clearServerRef();
    mockElicitInput.mockReset();
    mockRequest.mockReset();
    if (originalAutoConfirm === undefined) {
      delete process.env.UMBRACO_AUTO_CONFIRM;
    } else {
      process.env.UMBRACO_AUTO_CONFIRM = originalAutoConfirm;
    }
  });

  describe("with elicitation.form capability (Claude Code et al.)", () => {
    beforeEach(() => {
      setServerRef({
        elicitInput: mockElicitInput,
        request: mockRequest,
        getClientCapabilities: () => ({ elicitation: { form: true } }),
      } as any);
    });

    it("returns true on accept", async () => {
      mockElicitInput.mockResolvedValue({ action: "accept" });
      await expect(requestApproval(undefined, "Proceed?")).resolves.toBe(true);
      expect(mockElicitInput).toHaveBeenCalledTimes(1);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it("returns false on decline", async () => {
      mockElicitInput.mockResolvedValue({ action: "decline" });
      await expect(requestApproval(undefined, "Proceed?")).resolves.toBe(false);
    });

    it("returns false on cancel", async () => {
      mockElicitInput.mockResolvedValue({ action: "cancel" });
      await expect(requestApproval(undefined, "Proceed?")).resolves.toBe(false);
    });

    it("sends an empty-properties schema (no checkbox)", async () => {
      mockElicitInput.mockResolvedValue({ action: "accept" });
      await requestApproval({ requestId: "req-1" }, "Proceed?");
      const call = mockElicitInput.mock.calls[0]![0] as {
        message: string;
        requestedSchema: { type: string; properties: Record<string, unknown> };
      };
      expect(call.message).toBe("Proceed?");
      expect(call.requestedSchema.type).toBe("object");
      expect(call.requestedSchema.properties).toEqual({});
    });

    it("forwards relatedRequestId to the elicitInput call", async () => {
      mockElicitInput.mockResolvedValue({ action: "accept" });
      await requestApproval({ requestId: "req-7" }, "Proceed?");
      const opts = mockElicitInput.mock.calls[0]![1];
      expect(opts).toEqual({ relatedRequestId: "req-7" });
    });
  });

  describe("with base elicitation but no .form sub-capability (ChatGPT, Claude.ai web)", () => {
    beforeEach(() => {
      setServerRef({
        elicitInput: mockElicitInput,
        request: mockRequest,
        getClientCapabilities: () => ({ elicitation: {} }),
      } as any);
    });

    it("uses raw elicitation/create instead of elicitInput", async () => {
      mockRequest.mockResolvedValue({ action: "accept" });
      await expect(requestApproval(undefined, "Proceed?")).resolves.toBe(true);
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockElicitInput).not.toHaveBeenCalled();
      const [req] = mockRequest.mock.calls[0]! as [
        { method: string; params: Record<string, unknown> },
      ];
      expect(req.method).toBe("elicitation/create");
    });

    it("returns false on decline", async () => {
      mockRequest.mockResolvedValue({ action: "decline" });
      await expect(requestApproval(undefined, "Proceed?")).resolves.toBe(false);
    });
  });

  describe("with no elicitation capability advertised", () => {
    beforeEach(() => {
      setServerRef({
        elicitInput: mockElicitInput,
        request: mockRequest,
        getClientCapabilities: () => ({}),
      } as any);
    });

    it("throws ElicitationUnsupportedError by default", async () => {
      await expect(requestApproval(undefined, "Proceed?")).rejects.toThrow(
        ElicitationUnsupportedError,
      );
      expect(mockElicitInput).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it("returns true when allowAutoAccept is set", async () => {
      await expect(
        requestApproval(undefined, "Proceed?", { allowAutoAccept: true }),
      ).resolves.toBe(true);
      expect(mockElicitInput).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe("with a test-mock server (no getClientCapabilities)", () => {
    beforeEach(() => {
      setServerRef({ elicitInput: mockElicitInput } as any);
    });

    it("falls back to the form path so existing tests don't need cap setup", async () => {
      mockElicitInput.mockResolvedValue({ action: "accept" });
      await expect(requestApproval(undefined, "Proceed?")).resolves.toBe(true);
      expect(mockElicitInput).toHaveBeenCalledTimes(1);
    });
  });

  describe("UMBRACO_AUTO_CONFIRM environment override", () => {
    beforeEach(() => {
      setServerRef({
        elicitInput: mockElicitInput,
        request: mockRequest,
        getClientCapabilities: () => ({}),
      } as any);
    });

    it("returns true immediately without contacting the host when set to 'true'", async () => {
      process.env.UMBRACO_AUTO_CONFIRM = "true";
      await expect(requestApproval(undefined, "Proceed?")).resolves.toBe(true);
      expect(mockElicitInput).not.toHaveBeenCalled();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it("does NOT short-circuit when set to anything other than 'true'", async () => {
      process.env.UMBRACO_AUTO_CONFIRM = "1";
      await expect(requestApproval(undefined, "Proceed?")).rejects.toThrow(
        ElicitationUnsupportedError,
      );
    });
  });
});
