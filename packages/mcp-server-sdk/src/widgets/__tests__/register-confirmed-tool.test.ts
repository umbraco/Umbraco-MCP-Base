import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { z } from "zod";
import { setServerRef, clearServerRef } from "../../helpers/server-ref.js";
import { createConfirmedToolDefinition } from "../register-confirmed-tool.js";
import { CONFIRM_DIALOG_URI } from "../built-in/confirm-dialog/dist-html.generated.js";

describe("widgets/createConfirmedToolDefinition", () => {
  const confirmHandler = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const elicitInput = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const request = jest.fn<(...args: unknown[]) => Promise<unknown>>();

  afterEach(() => {
    clearServerRef();
    confirmHandler.mockReset();
    elicitInput.mockReset();
    request.mockReset();
    delete process.env.UMBRACO_AUTO_CONFIRM;
  });

  function makeTool() {
    return createConfirmedToolDefinition({
      name: "demo.publish",
      description: "Publish a thing",
      slices: ["publish"],
      inputSchema: { id: z.string() },
      prompt: ({ id }) => `Publish ${id}?`,
      confirmHandler: async (args, extra) => {
        return confirmHandler(args, extra);
      },
    });
  }

  describe("schema augmentation", () => {
    it("adds an optional `confirmed` boolean to inputSchema", () => {
      const tool = makeTool();
      expect(tool.inputSchema).toBeDefined();
      const shape = tool.inputSchema as Record<string, z.ZodTypeAny>;
      expect(shape.confirmed).toBeDefined();
      const parsed = z.object(shape).parse({ id: "x" });
      expect(parsed).toEqual({ id: "x" });
    });

    it("preserves the user-provided fields", () => {
      const tool = makeTool();
      const shape = tool.inputSchema as Record<string, z.ZodTypeAny>;
      expect(shape.id).toBeDefined();
    });
  });

  describe("when called with confirmed: true", () => {
    it("runs the confirmHandler and skips capability checks", async () => {
      const tool = makeTool();
      confirmHandler.mockResolvedValue({ ok: true });

      const result = await tool.handler(
        { id: "abc", confirmed: true } as any,
        {} as any,
      );

      expect(result).toEqual({ ok: true });
      expect(confirmHandler).toHaveBeenCalledTimes(1);
      const [args] = confirmHandler.mock.calls[0]!;
      expect(args).toEqual({ id: "abc" });
      expect(elicitInput).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });

    it("strips the confirmed flag before passing args to the handler", async () => {
      const tool = makeTool();
      confirmHandler.mockResolvedValue({});
      await tool.handler(
        { id: "abc", confirmed: true } as any,
        {} as any,
      );
      const [args] = confirmHandler.mock.calls[0]!;
      expect((args as Record<string, unknown>).confirmed).toBeUndefined();
    });
  });

  describe("on a GUI host (no elicitation.form)", () => {
    beforeEach(() => {
      setServerRef({
        elicitInput,
        request,
        getClientCapabilities: () => ({}),
      } as any);
    });

    it("returns a widget reference and does not call confirmHandler", async () => {
      const tool = makeTool();
      const result = (await tool.handler(
        { id: "abc" } as any,
        {} as any,
      )) as Record<string, any>;

      expect(result._meta).toEqual({
        ui: { resourceUri: CONFIRM_DIALOG_URI },
      });
      expect(result.structuredContent).toEqual({
        prompt: "Publish abc?",
        toolName: "demo.publish",
        args: { id: "abc" },
      });
      expect(result.content[0].type).toBe("text");
      expect(confirmHandler).not.toHaveBeenCalled();
      expect(elicitInput).not.toHaveBeenCalled();
    });

    it("respects a custom widgetResourceUri", async () => {
      const customUri = "ui://my-mcp/widgets/my-confirm.html";
      const tool = createConfirmedToolDefinition({
        name: "demo.custom",
        description: "x",
        slices: [],
        inputSchema: { id: z.string() },
        prompt: () => "?",
        confirmHandler: async () => ({}),
        widgetResourceUri: customUri,
      });

      const result = (await tool.handler(
        { id: "x" } as any,
        {} as any,
      )) as Record<string, any>;
      expect(result._meta.ui.resourceUri).toBe(customUri);
    });
  });

  describe("on a terminal host (elicitation.form)", () => {
    beforeEach(() => {
      setServerRef({
        elicitInput,
        request,
        getClientCapabilities: () => ({ elicitation: { form: true } }),
      } as any);
    });

    it("calls requestApproval and runs confirmHandler on accept", async () => {
      elicitInput.mockResolvedValue({ action: "accept" });
      confirmHandler.mockResolvedValue({ ok: 1 });
      const tool = makeTool();

      const result = await tool.handler(
        { id: "abc" } as any,
        { requestId: "r1" } as any,
      );

      expect(elicitInput).toHaveBeenCalledTimes(1);
      const [{ message }] = elicitInput.mock.calls[0]! as [{ message: string }];
      expect(message).toBe("Publish abc?");
      expect(confirmHandler).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: 1 });
    });

    it("returns a cancelled tool result on decline (handler not invoked)", async () => {
      elicitInput.mockResolvedValue({ action: "decline" });
      const tool = makeTool();

      const result = (await tool.handler(
        { id: "abc" } as any,
        {} as any,
      )) as Record<string, any>;

      expect(confirmHandler).not.toHaveBeenCalled();
      expect(result.structuredContent).toEqual({
        message: "User cancelled the confirmation.",
      });
    });

    it("supports a custom cancelledMessage", async () => {
      elicitInput.mockResolvedValue({ action: "cancel" });
      const tool = createConfirmedToolDefinition({
        name: "demo.publish",
        description: "x",
        slices: [],
        inputSchema: { id: z.string() },
        prompt: () => "?",
        confirmHandler: async () => ({}),
        cancelledMessage: "Aborted by the user.",
      });

      const result = (await tool.handler(
        { id: "x" } as any,
        {} as any,
      )) as Record<string, any>;
      expect(result.structuredContent.message).toBe("Aborted by the user.");
    });
  });

  describe("on a host with no elicitation capability at all", () => {
    beforeEach(() => {
      setServerRef({
        elicitInput,
        request,
        getClientCapabilities: () => ({}),
      } as any);
    });

    it("uses the widget path (GUI fallback) and never elicits", async () => {
      const tool = makeTool();
      const result = (await tool.handler(
        { id: "abc" } as any,
        {} as any,
      )) as Record<string, any>;
      expect(result._meta.ui.resourceUri).toBe(CONFIRM_DIALOG_URI);
      expect(elicitInput).not.toHaveBeenCalled();
    });
  });

  describe("when no server ref is set", () => {
    it("rejects with the helpful 'Server reference not set' error so misconfiguration surfaces in dev", async () => {
      const tool = makeTool();
      await expect(
        tool.handler({ id: "abc" } as any, {} as any),
      ).rejects.toThrow(/Server reference not set/);
      expect(confirmHandler).not.toHaveBeenCalled();
    });
  });

  describe("UMBRACO_AUTO_CONFIRM env override", () => {
    beforeEach(() => {
      setServerRef({
        elicitInput,
        request,
        getClientCapabilities: () => ({ elicitation: { form: true } }),
      } as any);
    });

    it("auto-confirms terminal-path calls when set", async () => {
      process.env.UMBRACO_AUTO_CONFIRM = "true";
      confirmHandler.mockResolvedValue({ ok: 9 });
      const tool = makeTool();

      const result = await tool.handler({ id: "abc" } as any, {} as any);

      expect(elicitInput).not.toHaveBeenCalled();
      expect(confirmHandler).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: 9 });
    });
  });
});
