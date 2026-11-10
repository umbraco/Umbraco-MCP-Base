/**
 * Chained MCP Tools in Readonly Mode (CLI)
 *
 * Readonly mode has to cover the tools proxied from a chained MCP server, and
 * it has to do so whether it is set as an environment variable or as a CLI
 * flag: the chained server inherits this process's environment, but not its
 * command line.
 *
 * Uses the template's mock chained server (USE_MOCK_MCP_CHAIN), which lists
 * two tools annotated read-only and one write tool (`update-message`). It is
 * not built on the SDK and ignores `--umbraco-readonly`, so these tests cover
 * a chained server that does not filter for itself.
 */

import { createCliTestClient, type CliTestClient } from "../helpers/cli-client.js";

const MOCK_CHAIN = { USE_MOCK_MCP_CHAIN: "true" };

async function proxiedToolNames(client: CliTestClient): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => t.name).filter((name) => name.startsWith("cms--")).sort();
}

describe("Chained tools in readonly mode (CLI)", () => {
  let client: CliTestClient | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it("proxies every chained tool when readonly is off", async () => {
    client = await createCliTestClient({ env: MOCK_CHAIN });

    expect(await proxiedToolNames(client)).toEqual([
      "cms--echo-message",
      "cms--get-server-info",
      "cms--update-message",
    ]);
  });

  it("proxies only read-only chained tools with --umbraco-readonly", async () => {
    client = await createCliTestClient({ env: MOCK_CHAIN, args: ["--umbraco-readonly"] });

    expect(await proxiedToolNames(client)).toEqual([
      "cms--echo-message",
      "cms--get-server-info",
    ]);
  });

  it("proxies only read-only chained tools with UMBRACO_READONLY=true", async () => {
    client = await createCliTestClient({ env: { ...MOCK_CHAIN, UMBRACO_READONLY: "true" } });

    expect(await proxiedToolNames(client)).toEqual([
      "cms--echo-message",
      "cms--get-server-info",
    ]);
  });

  it("refuses a call to a chained write tool in readonly mode", async () => {
    client = await createCliTestClient({ env: MOCK_CHAIN, args: ["--umbraco-readonly"] });

    // The tool is not registered, so the call fails at the parent: either a
    // protocol error or an isError result, depending on the MCP SDK version.
    let failed = false;
    try {
      const result = await client.callTool("cms--update-message", { message: "x" });
      failed = result.isError === true;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it("passes the chained server's annotations to the client", async () => {
    client = await createCliTestClient({ env: MOCK_CHAIN });

    const { tools } = await client.listTools();
    const byName = new Map(
      (tools as Array<{ name: string; annotations?: { readOnlyHint?: boolean } }>).map((t) => [t.name, t]),
    );

    expect(byName.get("cms--get-server-info")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("cms--update-message")?.annotations?.readOnlyHint).not.toBe(true);
  });
});
