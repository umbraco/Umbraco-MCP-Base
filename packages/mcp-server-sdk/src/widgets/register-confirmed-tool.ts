/**
 * `createConfirmedToolDefinition` — cross-host confirmation wrapper.
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
 * # Trust model — read before shipping
 *
 * The `confirmed: true` flag is the **only** gate between the LLM's tool
 * call and the destructive action. There is no cryptographic proof that
 * the flag was set by a human clicking the widget; an LLM that sets it
 * directly will bypass the confirmation step entirely.
 *
 * An earlier iteration tried to bind a stateless HMAC token to the call,
 * shipped via `structuredContent`. Empirical spike data (this repo, 2026-05)
 * showed ChatGPT's MCP App runtime strips `structuredContent` from the
 * widget's `ui/notifications/tool-result` notification, so the widget
 * cannot read the token. And even when a covert channel exists, the LLM
 * has the same protocol access as the widget — any resource the widget
 * can read, the LLM can read — so token validation is not robustly
 * securable until the MCP Apps spec adds a host-attested widget identity.
 *
 * In the meantime:
 * - The host's per-tool permission UI (Claude Desktop, Claude.ai web) is
 *   the actual security boundary — it shows the user the call + args
 *   before the tool ever runs.
 * - The `confirmed` field description discourages the LLM from setting it.
 * - Terminal-host flows still go through real elicitation (spec-defined).
 *
 * If you ship a tool wrapped here, treat the widget consent as a UX
 * affordance, not as a security check.
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
          "Do not set this yourself — the host shows a confirmation dialog " +
          "to the user; the widget will set this flag on Accept.",
      ),
  } as InputArgs & {
    confirmed: z.ZodOptional<z.ZodBoolean>;
  };

  const handler = async (
    rawArgs: unknown,
    extra: HandlerExtra,
  ): Promise<unknown> => {
    const args = (rawArgs ?? {}) as ZodRawShapeToInfer<InputArgs> & {
      confirmed?: boolean;
    };
    const { confirmed, ...rest } = args;
    const userArgs = rest as unknown as ZodRawShapeToInfer<InputArgs>;

    if (confirmed === true) {
      // Trust the flag — see the module-level "Trust model" header for why
      // we don't (currently) validate a cryptographic token here.
      return options.confirmHandler(userArgs, extra);
    }

    const promptMessage = options.prompt(userArgs);
    const server = safeGetServer();
    const useWidget = server ? hostSupportsMcpApps(server) : false;

    if (useWidget) {
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
