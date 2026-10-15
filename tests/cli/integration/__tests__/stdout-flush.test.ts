/**
 * CLI stdout flush tests
 *
 * handleCliCommands used to call process.exit() right after console.log. Writes
 * to a pipe are asynchronous on POSIX, so output beyond the 64 KB pipe buffer
 * was truncated while the exit code stayed 0. These tests spawn a real process
 * with stdout piped and assert the full output arrives.
 *
 * Requires: npm run build (uses the SDK's built dist)
 */

import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkEntry = resolve(__dirname, "../../../../packages/mcp-server-sdk/dist/index.js");

const PAYLOAD_BYTES = 300_000; // well beyond the 64 KB pipe buffer

const script = `
import { handleCliCommands } from ${JSON.stringify(sdkEntry)};
const mode = process.argv[1];
const big = "x".repeat(${PAYLOAD_BYTES});
const tool = {
  name: "big-tool",
  description: big,
  slices: ["read"],
  inputSchema: {},
  handler: async () => ({
    content: [{ type: "text", text: JSON.stringify({ big }) }],
    isError: mode === "call-error",
  }),
};
const collections = [{
  metadata: { name: "big", displayName: "big", description: "big" },
  tools: () =>
    mode === "list"
      ? Array.from({ length: 3000 }, (_, i) => ({ ...tool, name: "big-tool-" + i, description: "short" }))
      : [tool],
}];
const cliFlags =
  mode === "describe" ? { describeTool: "big-tool" } :
  mode === "list" ? { listTools: true } :
  mode === "context" ? { generateContext: true } :
  { callTool: "big-tool" };
await handleCliCommands(collections, { cliFlags });
`;

function run(mode: string): Promise<{ code: number | null; stdout: Buffer }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, mode], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.resume(); // keep reading so a large stderr can't block the child
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout: Buffer.concat(chunks) }));
  });
}

describe("CLI output flushing with piped stdout", () => {
  it("--describe-tool delivers complete JSON larger than 64 KB", async () => {
    const { code, stdout } = await run("describe");
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(PAYLOAD_BYTES);
    expect(JSON.parse(stdout.toString("utf-8")).description).toHaveLength(PAYLOAD_BYTES);
  });

  it("--list-tools delivers the full table", async () => {
    const { code, stdout } = await run("list");
    expect(code).toBe(0);
    const lines = stdout.toString("utf-8").trimEnd().split("\n");
    expect(stdout.length).toBeGreaterThan(64 * 1024);
    expect(lines[lines.length - 1]).toContain("big-tool-2999");
  });

  it("--generate-context delivers the full context larger than 64 KB", async () => {
    const { code, stdout } = await run("context");
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(PAYLOAD_BYTES);
    expect(stdout.toString("utf-8")).toContain("x".repeat(PAYLOAD_BYTES));
  });

  it("--call delivers complete JSON larger than 64 KB", async () => {
    const { code, stdout } = await run("call");
    expect(code).toBe(0);
    expect(JSON.parse(stdout.toString("utf-8")).big).toHaveLength(PAYLOAD_BYTES);
  });

  it("--call keeps exit code 1 for isError results while flushing output", async () => {
    const { code, stdout } = await run("call-error");
    expect(code).toBe(1);
    expect(JSON.parse(stdout.toString("utf-8")).big).toHaveLength(PAYLOAD_BYTES);
  });
});
