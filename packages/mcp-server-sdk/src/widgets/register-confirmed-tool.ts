/**
 * `registerConfirmedTool` — cross-host confirmation wrapper.
 *
 * Returns a `ToolDefinition` whose handler routes based on the connected
 * client's capabilities at request time:
 *
 * - **GUI hosts** (Claude.ai, Claude Desktop, ChatGPT web/desktop) get the
 *   confirm-dialog widget rendered inline. The first call returns
 *   `_meta.ui.resourceUri` plus `structuredContent` carrying the prompt and
 *   the original args; the iframe shows Accept / Cancel and on Accept calls
 *   the same tool back with `confirmed: true`.
 * - **Terminal hosts** (Claude Code, MCP Inspector) skip the widget and
 *   call `requestApproval` synchronously. On Accept the wrapped handler
 *   runs in the same call — no second round-trip.
 *
 * The caller's `confirmHandler` only ever runs after explicit user
 * approval. The `confirmed` field is added to `inputSchema` automatically
 * and should not be set by the LLM — its description discourages that.
 */

import { z, type ZodRawShape } from "zod";

import {
  createToolResult,
  createToolResultError,
} from "../helpers/tool-result.js";
import {
  ElicitationUnsupportedError,
  requestApproval,
} from "./request-approval.js";
import { hostSupportsMcpApps } from "./capability.js";
import { getServerRef } from "../helpers/server-ref.js";
import { CONFIRM_DIALOG_URI } from "./built-in/confirm-dialog/dist-html.generated.js";
import {
  consumeConfirmationToken,
  issueConfirmationToken,
} from "./confirmation-tokens.js";
import type { ToolDefinition } from "../types/tool-definition.js";

type CallToolResultLike = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: { [x: string]: unknown };
  _meta?: { [x: string]: unknown };
  isError?: boolean;
};

/**
 * Configuration for {@link createConfirmedToolDefinition}.
 *
 * Extends the base `ToolDefinition` shape:
 * - `inputSchema` describes the *user-facing* input. The wrapper appends an
 *   internal `confirmed` flag automatically.
 * - `prompt` derives the message shown to the user from the call args.
 * - `confirmHandler` is the real handler. Runs only after Accept.
 *
 * The standard `ToolDefinition.handler` is filled in by the wrapper; do
 * not pass one yourself.
 */
export interface CreateConfirmedToolOptions<
  InputArgs extends ZodRawShape = ZodRawShape,
> extends Omit<
    ToolDefinition<InputArgs & { confirmed: z.ZodOptional<z.ZodBoolean> }>,
    "handler" | "inputSchema"
  > {
  /**
   * User-facing input schema. The wrapper adds `confirmed?: boolean` to it.
   */
  inputSchema: InputArgs;
  /**
   * Build the prompt shown to the user from the call args.
   */
  prompt: (args: ZodRawShapeToInfer<InputArgs>) => string;
  /**
   * The actual tool handler. Runs only after the user has confirmed.
   */
  confirmHandler: (
    args: ZodRawShapeToInfer<InputArgs>,
    extra: HandlerExtra,
  ) => Promise<unknown> | unknown;
  /**
   * UI resource URI that hosts will render. Defaults to the SDK's built-in
   * confirm-dialog widget. Override to ship your own widget.
   *
   * @default CONFIRM_DIALOG_URI
   */
  widgetResourceUri?: string;
  /**
   * Optional message returned to the LLM after the user cancels.
   *
   * @default `"User cancelled the confirmation."`
   */
  cancelledMessage?: string;
  /**
   * For terminal hosts that advertise no elicitation capability at all,
   * skip the prompt and proceed as if the user had confirmed.
   *
   * Only safe for non-destructive flows; prefer leaving this `false`.
   *
   * @default false
   */
  allowAutoAcceptOnUnsupportedHosts?: boolean;
}

interface HandlerExtra {
  requestId?: string | number;
  [key: string]: unknown;
}

type ZodRawShapeToInfer<S extends ZodRawShape> = {
  [K in keyof S]: z.infer<S[K]>;
};

/**
 * Wrap a tool with cross-host confirmation. Returns a `ToolDefinition`
 * ready to be registered through the project's normal tool-collection
 * machinery.
 */
export function createConfirmedToolDefinition<
  InputArgs extends ZodRawShape,
>(
  options: CreateConfirmedToolOptions<InputArgs>,
): ToolDefinition<InputArgs & { confirmed: z.ZodOptional<z.ZodBoolean> }> {
  const widgetUri = options.widgetResourceUri ?? CONFIRM_DIALOG_URI;
  const cancelledMessage =
    options.cancelledMessage ?? "User cancelled the confirmation.";

  const fullInputSchema = {
    ...options.inputSchema,
    confirmed: z
      .boolean()
      .optional()
      .describe(
        "Internal: set by the confirmation widget after the user accepts. " +
          "Do not set this yourself.",
      ),
    confirmationToken: z
      .string()
      .optional()
      .describe(
        "Internal: one-shot token issued by the server when the confirm " +
          "widget is shown. The widget passes it back; the LLM should not.",
      ),
  } as InputArgs & {
    confirmed: z.ZodOptional<z.ZodBoolean>;
    confirmationToken: z.ZodOptional<z.ZodString>;
  };

  const handler = async (
    rawArgs: unknown,
    extra: HandlerExtra,
  ): Promise<unknown> => {
    const args = (rawArgs ?? {}) as ZodRawShapeToInfer<InputArgs> & {
      confirmed?: boolean;
      confirmationToken?: string;
    };
    const { confirmed, confirmationToken, ...rest } = args;
    const userArgs = rest as unknown as ZodRawShapeToInfer<InputArgs>;

    if (confirmed === true) {
      // Widget branch: a valid one-shot token bound to these exact args is
      // required. This blocks the simplest LLM-replay path where the model
      // sets confirmed: true on its own without ever showing the dialog.
      if (!consumeConfirmationToken(confirmationToken, userArgs)) {
        return createToolResultError({
          message:
            "Confirmation rejected: missing or invalid confirmation token. " +
            "Call this tool without `confirmed` to display the confirmation " +
            "dialog; the dialog will provide a valid token when the user accepts.",
        });
      }
      return options.confirmHandler(userArgs, extra);
    }

    const promptMessage = options.prompt(userArgs);
    const server = safeGetServer();
    const useWidget = server ? hostSupportsMcpApps(server) : false;

    if (useWidget) {
      const token = issueConfirmationToken(userArgs);
      const widgetResult: CallToolResultLike = {
        content: [
          {
            type: "text",
            text:
              "A confirmation dialog is being shown to the user. " +
              "Wait for the result of their decision before continuing. " +
              "Do not call this tool again with `confirmed: true` yourself.",
          },
        ],
        structuredContent: {
          prompt: promptMessage,
          toolName: options.name,
          args: userArgs as unknown as Record<string, unknown>,
          confirmationToken: token,
        },
        _meta: { ui: { resourceUri: widgetUri } },
      };
      return widgetResult;
    }

    try {
      const accepted = await requestApproval(extra, promptMessage, {
        allowAutoAccept: options.allowAutoAcceptOnUnsupportedHosts ?? false,
      });
      if (!accepted) {
        return createToolResult({ message: cancelledMessage });
      }
      return options.confirmHandler(userArgs, extra);
    } catch (err) {
      if (err instanceof ElicitationUnsupportedError) {
        return createToolResultError(
          "This client does not support confirmation prompts. " +
            "Use a host that advertises `elicitation` or pass " +
            "`allowAutoAcceptOnUnsupportedHosts: true` when registering the tool.",
        );
      }
      throw err;
    }
  };

  return {
    ...options,
    inputSchema: fullInputSchema,
    handler: handler as unknown as ToolDefinition<
      InputArgs & { confirmed: z.ZodOptional<z.ZodBoolean> }
    >["handler"],
  } as ToolDefinition<
    InputArgs & { confirmed: z.ZodOptional<z.ZodBoolean> }
  >;
}

/**
 * Test mocks may not have `setServerRef` wired up; treat that as
 * "host capability unknown" and fall through to the elicitation path
 * (which itself tolerates test mocks).
 */
function safeGetServer(): unknown | undefined {
  try {
    return getServerRef();
  } catch {
    return undefined;
  }
}
