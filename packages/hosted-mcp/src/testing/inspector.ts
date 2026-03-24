/**
 * MCP Inspector lifecycle helpers for E2E tests.
 *
 * Starts the MCP Inspector as a child process and captures the URL with auth token.
 * Returns an InspectorHandle for clean lifecycle management (no module-level state).
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { Page } from "@playwright/test";

export interface InspectorHandle {
  url: string;
  stop: () => Promise<void>;
}

export interface InspectorPorts {
  client: number;
  proxy: number;
}

const DEFAULT_PORTS: InspectorPorts = { client: 6274, proxy: 6277 };

export async function startInspector(
  ports?: Partial<InspectorPorts>,
): Promise<InspectorHandle> {
  const { client, proxy } = { ...DEFAULT_PORTS, ...ports };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for MCP Inspector to start"));
    }, 30000);

    const proc = spawn(
      "npx",
      ["@modelcontextprotocol/inspector"],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        env: {
          ...process.env,
          CLIENT_PORT: String(client),
          SERVER_PORT: String(proxy),
          MCP_AUTO_OPEN_ENABLED: "false",
        },
      },
    );

    let output = "";
    let resolvedUrl: string | undefined;

    proc.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
      const match = output.match(
        /MCP Inspector is up and running at:\s+(http:\/\/localhost:\d+\S+)/,
      );
      if (match) {
        clearTimeout(timer);
        resolvedUrl = match[1];
        resolve({
          url: resolvedUrl,
          stop: () => stopProcess(proc),
        });
      }
    });

    proc.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`MCP Inspector failed to start: ${err.message}`));
    });

    proc.on("exit", (code) => {
      if (!resolvedUrl) {
        clearTimeout(timer);
        reject(
          new Error(
            `MCP Inspector exited with code ${code} before ready.\nOutput: ${output}`,
          ),
        );
      }
    });
  });
}

async function stopProcess(proc: ChildProcess): Promise<void> {
  try {
    process.kill(-proc.pid!, "SIGTERM");
  } catch {
    proc.kill("SIGTERM");
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      try { process.kill(-proc.pid!, "SIGKILL"); } catch { /* ignore */ }
      resolve();
    }, 5000);
    proc.on("exit", () => { clearTimeout(timeout); resolve(); });
  });
}

/**
 * Connect the MCP Inspector to a Worker's MCP endpoint.
 *
 * Sets transport to Streamable HTTP, enters the URL, selects Direct
 * connection, and clicks Connect. Returns the popup page (or the
 * current page) that will navigate through the OAuth flow.
 */
export async function connectInspector(
  page: Page,
  workerUrl: string,
  inspectorUrl: string,
): Promise<Page> {
  await page.goto(inspectorUrl);
  await page.waitForLoadState("networkidle");

  // Select Streamable HTTP transport
  const transportCombo = page.getByRole("combobox", { name: "Transport Type" });
  await transportCombo.click();
  await page.getByRole("option", { name: "Streamable HTTP" }).click();

  // Enter the Worker's MCP endpoint URL
  const urlInput = page.getByRole("textbox", { name: "URL" });
  await urlInput.waitFor({ timeout: 5000 });
  await urlInput.clear();
  await urlInput.fill(workerUrl);

  // Select Direct connection (browser handles OAuth redirect)
  const connectionTypeCombo = page.getByRole("combobox", { name: "Connection Type" });
  await connectionTypeCombo.click();
  await page.getByRole("option", { name: "Direct" }).click();

  // Click Connect — Inspector may open a popup or navigate the current page
  const isAuthorizeUrl = (url: URL) =>
    url.pathname === "/authorize" || url.pathname.includes("authorize") || url.pathname.includes("/umbraco");

  const popupPromise = page.context().waitForEvent("page").catch(() => null);
  const navigationPromise = page.waitForURL(isAuthorizeUrl).then(() => null as Page | null);

  await page.getByRole("button", { name: "Connect" }).click();

  const popup = await Promise.race([popupPromise, navigationPromise]);
  const oauthPage = popup ?? page;

  if (popup) {
    await popup.waitForURL(isAuthorizeUrl, { timeout: 15000 });
  }

  return oauthPage;
}
