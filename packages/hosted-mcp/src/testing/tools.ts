/**
 * Tool listing and execution helpers for E2E tests.
 */

import type { Page } from "@playwright/test";

/**
 * Navigate to the Tools tab, click List Tools, and extract tool names.
 *
 * @param page - The Inspector page (must already be connected)
 * @param knownTools - List of tool names to scan for visibility
 */
export async function getToolNames(
  page: Page,
  knownTools: string[],
): Promise<string[]> {
  await page.getByText("Connected").waitFor({ state: "visible", timeout: 15000 });

  const toolsTab = page.getByRole("tab", { name: /Tools/i });
  await toolsTab.waitFor({ timeout: 10000 });
  await toolsTab.click();

  const listToolsButton = page.getByRole("button", { name: /List Tools/i });
  await listToolsButton.waitFor({ timeout: 10000 });
  await listToolsButton.click();

  // Wait for at least one known tool to appear
  await page
    .locator(knownTools.map((t) => `:text-is("${t}")`).join(", "))
    .first()
    .waitFor({ state: "visible", timeout: 10000 });

  const visibleTools: string[] = [];
  for (const tool of knownTools) {
    const isVisible = await page
      .getByText(tool, { exact: true })
      .first()
      .isVisible()
      .catch(() => false);
    if (isVisible) visibleTools.push(tool);
  }
  return visibleTools;
}

/**
 * Click a tool in the list, run it, and return the result text.
 *
 * @param page - The Inspector page
 * @param toolName - Name of the tool to click
 * @param resultMarker - Text to wait for in the result (e.g. "assemblyVersion")
 */
export async function callTool(
  page: Page,
  toolName: string,
  resultMarker: string,
): Promise<string> {
  await page.getByText(toolName, { exact: true }).first().click();

  const runButton = page.getByRole("button", { name: /Run|Execute/i });
  await runButton.waitFor({ timeout: 5000 });
  await runButton.click();

  await page.getByText(resultMarker).first().waitFor({ state: "visible", timeout: 10000 });

  return (await page.locator("body").textContent()) ?? "";
}
