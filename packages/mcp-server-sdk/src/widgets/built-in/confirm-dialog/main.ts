/**
 * Built-in confirm-dialog widget.
 *
 * Renders inside an MCP Apps iframe. Receives the tool result via
 * `app.ontoolresult` — `structuredContent` carries `{ prompt, toolName, args }`
 * — and shows an Accept / Cancel pair. Accept calls the same tool back with
 * `confirmed: true` plus the original args; Cancel just tears the iframe down.
 */

import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

interface ConfirmDialogPayload {
  prompt: string;
  toolName: string;
  args: Record<string, unknown>;
  /**
   * One-shot token the server issued when it returned this widget
   * reference. Passed straight back when re-entering the tool.
   */
  confirmationToken?: string;
  acceptLabel?: string;
  cancelLabel?: string;
}

const root = document.getElementById("root")!;

function renderEmpty(message: string) {
  root.innerHTML = "";
  const p = document.createElement("p");
  p.textContent = message;
  p.className = "muted";
  root.appendChild(p);
}

function renderDialog(payload: ConfirmDialogPayload, app: App) {
  root.innerHTML = "";

  const card = document.createElement("div");
  card.className = "card";

  const message = document.createElement("p");
  message.className = "message";
  message.textContent = payload.prompt;
  card.appendChild(message);

  const actions = document.createElement("div");
  actions.className = "actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = payload.cancelLabel ?? "Cancel";

  const acceptBtn = document.createElement("button");
  acceptBtn.type = "button";
  acceptBtn.className = "btn btn-primary";
  acceptBtn.textContent = payload.acceptLabel ?? "Confirm";

  let acted = false;
  const setBusy = (busy: boolean) => {
    acceptBtn.disabled = busy;
    cancelBtn.disabled = busy;
    if (busy) acceptBtn.textContent = "Working…";
  };

  cancelBtn.addEventListener("click", async () => {
    if (acted) return;
    acted = true;
    setBusy(true);
    try {
      await app.updateModelContext({
        content: [
          { type: "text", text: "User cancelled the confirmation." },
        ],
      });
    } finally {
      void app.requestTeardown();
    }
  });

  acceptBtn.addEventListener("click", async () => {
    if (acted) return;
    acted = true;
    setBusy(true);
    try {
      await app.callServerTool({
        name: payload.toolName,
        arguments: {
          ...payload.args,
          confirmed: true,
          ...(payload.confirmationToken
            ? { confirmationToken: payload.confirmationToken }
            : {}),
        },
      });
    } finally {
      void app.requestTeardown();
    }
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(acceptBtn);
  card.appendChild(actions);
  root.appendChild(card);
}

async function main() {
  const app = new App(
    { name: "umbraco-mcp-confirm-dialog", version: "1" },
    {},
  );

  app.ontoolresult = (notification) => {
    const structured = notification.params.result?.structuredContent as
      | ConfirmDialogPayload
      | undefined;
    if (
      structured &&
      typeof structured.prompt === "string" &&
      typeof structured.toolName === "string"
    ) {
      renderDialog(structured, app);
    } else {
      renderEmpty("No confirmation prompt was provided.");
    }
  };

  applyDocumentTheme();
  applyHostStyleVariables();

  await app.connect();
}

renderEmpty("Loading…");
void main();
