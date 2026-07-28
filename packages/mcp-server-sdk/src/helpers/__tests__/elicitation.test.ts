import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { confirmAction, ElicitationUnsupportedError } from "../elicitation.js";
import { setServerRef, clearServerRef } from "../server-ref.js";

describe("confirmAction", () => {
  const mockElicitInput = jest.fn<(...args: any[]) => Promise<any>>();

  beforeEach(() => {
    setServerRef({ elicitInput: mockElicitInput } as any);
    mockElicitInput.mockReset();
  });

  afterEach(() => {
    clearServerRef();
  });

  it("should return true when user accepts and confirms", async () => {
    mockElicitInput.mockResolvedValue({ action: "accept", content: { confirm: true } });

    const result = await confirmAction({ requestId: "req-1" }, "Publish this?");

    expect(result).toBe(true);
  });

  it("should return false when user declines", async () => {
    mockElicitInput.mockResolvedValue({ action: "decline", content: {} });

    const result = await confirmAction({ requestId: "req-1" }, "Delete this?");

    expect(result).toBe(false);
  });

  it("should return false when user accepts but unchecks confirm", async () => {
    mockElicitInput.mockResolvedValue({ action: "accept", content: { confirm: false } });

    const result = await confirmAction({ requestId: "req-1" }, "Rollback?");

    expect(result).toBe(false);
  });

  it("should return false when user cancels", async () => {
    mockElicitInput.mockResolvedValue({ action: "cancel", content: {} });

    const result = await confirmAction({ requestId: "req-1" }, "Unpublish?");

    expect(result).toBe(false);
  });

  it("should pass message and default true to elicitInput", async () => {
    mockElicitInput.mockResolvedValue({ action: "accept", content: { confirm: true } });

    await confirmAction({ requestId: "req-1" }, "Create page?");

    expect(mockElicitInput).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Create page?",
        requestedSchema: expect.objectContaining({
          properties: expect.objectContaining({
            confirm: expect.objectContaining({
              type: "boolean",
              default: true,
            }),
          }),
        }),
      }),
      { relatedRequestId: "req-1" },
    );
  });

  it("should use custom title and defaultValue", async () => {
    mockElicitInput.mockResolvedValue({ action: "accept", content: { confirm: true } });

    await confirmAction({ requestId: "req-2" }, "Delete page?", {
      title: "Confirm delete",
      defaultValue: false,
    });

    expect(mockElicitInput).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedSchema: expect.objectContaining({
          properties: expect.objectContaining({
            confirm: expect.objectContaining({
              title: "Confirm delete",
              default: false,
            }),
          }),
        }),
      }),
      { relatedRequestId: "req-2" },
    );
  });

  it("should handle undefined extra gracefully", async () => {
    mockElicitInput.mockResolvedValue({ action: "accept", content: { confirm: true } });

    const result = await confirmAction(undefined, "Do it?");

    expect(result).toBe(true);
    expect(mockElicitInput).toHaveBeenCalledWith(
      expect.any(Object),
      { relatedRequestId: undefined },
    );
  });

  it("should handle extra without requestId", async () => {
    mockElicitInput.mockResolvedValue({ action: "accept", content: { confirm: true } });

    const result = await confirmAction({}, "Do it?");

    expect(result).toBe(true);
    expect(mockElicitInput).toHaveBeenCalledWith(
      expect.any(Object),
      { relatedRequestId: undefined },
    );
  });

  it("should throw when server ref not set", async () => {
    clearServerRef();

    await expect(confirmAction({ requestId: "req-1" }, "Do it?"))
      .rejects.toThrow("Server reference not set");
  });

  describe("capability awareness", () => {
    afterEach(() => {
      clearServerRef();
    });

    it("uses elicitInput when client advertises elicitation.form", async () => {
      const elicitInput = jest.fn<any>().mockResolvedValue({
        action: "accept",
        content: { confirm: true },
      });
      const request = jest.fn<any>();
      setServerRef({
        elicitInput,
        request,
        getClientCapabilities: () => ({ elicitation: { form: {} } }),
      } as any);

      const result = await confirmAction({ requestId: "req-form" }, "Publish?");

      expect(result).toBe(true);
      expect(elicitInput).toHaveBeenCalledTimes(1);
      expect(request).not.toHaveBeenCalled();
    });

    it("falls back to bare elicitation/create when client advertises elicitation but not form", async () => {
      const elicitInput = jest.fn<any>();
      const request = jest.fn<any>().mockResolvedValue({
        action: "accept",
        content: { confirm: true },
      });
      setServerRef({
        elicitInput,
        request,
        getClientCapabilities: () => ({ elicitation: {} }),
      } as any);

      const result = await confirmAction({ requestId: "req-basic" }, "Publish?");

      expect(result).toBe(true);
      expect(elicitInput).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "elicitation/create",
          params: expect.objectContaining({
            message: "Publish?",
            requestedSchema: expect.objectContaining({
              properties: expect.objectContaining({
                confirm: expect.objectContaining({ type: "boolean" }),
              }),
            }),
          }),
        }),
        expect.anything(),
        { relatedRequestId: "req-basic" },
      );
    });

    it("does not include a mode field in the bare elicitation/create params", async () => {
      const request = jest.fn<(...args: any[]) => Promise<any>>().mockResolvedValue({
        action: "accept",
        content: { confirm: true },
      });
      setServerRef({
        elicitInput: jest.fn(),
        request,
        getClientCapabilities: () => ({ elicitation: {} }),
      } as any);

      await confirmAction({ requestId: "req-no-mode" }, "Publish?");

      const params = request.mock.calls[0][0].params;
      expect(params).not.toHaveProperty("mode");
    });

    it("returns false when basic elicitation is declined", async () => {
      const request = jest.fn<any>().mockResolvedValue({
        action: "decline",
        content: {},
      });
      setServerRef({
        elicitInput: jest.fn(),
        request,
        getClientCapabilities: () => ({ elicitation: {} }),
      } as any);

      const result = await confirmAction({ requestId: "req-1" }, "Delete?");

      expect(result).toBe(false);
    });

    it("returns false when basic elicitation accepts but confirm is false", async () => {
      const request = jest.fn<any>().mockResolvedValue({
        action: "accept",
        content: { confirm: false },
      });
      setServerRef({
        elicitInput: jest.fn(),
        request,
        getClientCapabilities: () => ({ elicitation: {} }),
      } as any);

      const result = await confirmAction({ requestId: "req-1" }, "Delete?");

      expect(result).toBe(false);
    });

    it("throws ElicitationUnsupportedError when client advertises no elicitation capability", async () => {
      const elicitInput = jest.fn<any>();
      const request = jest.fn<any>();
      setServerRef({
        elicitInput,
        request,
        getClientCapabilities: () => ({}),
      } as any);

      await expect(confirmAction({ requestId: "req-1" }, "Do it?"))
        .rejects.toBeInstanceOf(ElicitationUnsupportedError);
      expect(elicitInput).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });

    it("throws ElicitationUnsupportedError when getClientCapabilities returns null", async () => {
      const elicitInput = jest.fn<any>();
      setServerRef({
        elicitInput,
        request: jest.fn(),
        getClientCapabilities: () => null,
      } as any);

      await expect(confirmAction({ requestId: "req-1" }, "Do it?"))
        .rejects.toBeInstanceOf(ElicitationUnsupportedError);
    });
  });
});
