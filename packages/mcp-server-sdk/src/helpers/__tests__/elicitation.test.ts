import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { confirmAction } from "../elicitation.js";
import { setServerRef, clearServerRef } from "../server-ref.js";

describe("confirmAction", () => {
  const mockElicitInput = jest.fn();

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
});
