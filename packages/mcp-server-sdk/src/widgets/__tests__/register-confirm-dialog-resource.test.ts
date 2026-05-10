import { describe, expect, it, jest } from "@jest/globals";
import { registerConfirmDialogResource } from "../register-confirm-dialog-resource.js";
import {
  CONFIRM_DIALOG_HTML,
  CONFIRM_DIALOG_URI,
} from "../built-in/confirm-dialog/dist-html.generated.js";

describe("widgets/registerConfirmDialogResource", () => {
  it("registers the built-in HTML against the canonical URI", async () => {
    const registerResource =
      jest.fn<(...args: unknown[]) => unknown>();
    const server = { registerResource } as any;

    registerConfirmDialogResource(server);

    expect(registerResource).toHaveBeenCalledTimes(1);
    const [name, uri, config, callback] = registerResource.mock.calls[0]! as [
      string,
      string,
      Record<string, unknown>,
      (uri: URL) => Promise<{
        contents: Array<{ mimeType: string; text: string; uri: string }>;
      }>,
    ];
    expect(name).toBe("Umbraco MCP confirm dialog");
    expect(uri).toBe(CONFIRM_DIALOG_URI);
    expect(config.mimeType).toBe("text/html;profile=mcp-app");

    const result = await callback(new URL(CONFIRM_DIALOG_URI));
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe("text/html;profile=mcp-app");
    expect(result.contents[0].text).toBe(CONFIRM_DIALOG_HTML);
    expect(result.contents[0].uri).toBe(CONFIRM_DIALOG_URI);
  });

  it("respects custom name and description", () => {
    const registerResource =
      jest.fn<(...args: unknown[]) => unknown>();
    const server = { registerResource } as any;

    registerConfirmDialogResource(server, {
      name: "Custom name",
      description: "Custom description",
    });

    const [name, , config] = registerResource.mock.calls[0]! as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(name).toBe("Custom name");
    expect(config.description).toBe("Custom description");
  });

  it("ships a non-trivial bundled HTML payload", () => {
    expect(CONFIRM_DIALOG_HTML.length).toBeGreaterThan(1000);
    expect(CONFIRM_DIALOG_HTML).toContain("<!DOCTYPE html>");
    expect(CONFIRM_DIALOG_URI.startsWith("ui://")).toBe(true);
  });
});
