#!/usr/bin/env node
/**
 * Drive an MCP server over stdio with raw JSON-RPC and check the things that
 * have broken consumers after SDK bumps without failing their own tests:
 *
 *   - stdout carries nothing but JSON-RPC (stray logs corrupt the stream)
 *   - every tool lists, with an object inputSchema / outputSchema
 *   - each --call returns a non-error result whose structuredContent
 *     validates against that tool's advertised outputSchema
 *   - initialize `instructions` (where the version-mismatch warning lands)
 *
 *   node scripts/smoke/stdio-check.mjs <server-dir> [--entry dist/index.js]
 *        [--call <tool> '<json-args>']... [--expect-error <tool> '<json-args>']...
 *        [--env KEY=VALUE]... [--min-tools N] [--print-tools]
 *        [--elicitation decline|ignore] [--call-timeout-ms N] [--server-arg <flag>]...
 *
 * Exit code 1 on any failed check.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../package.json"));
const { Validator } = await import(require.resolve("@cfworker/json-schema"));

const argv = process.argv.slice(2);
const serverDir = resolve(argv[0] ?? ".");
let entry = "dist/index.js";
let minTools = 1;
let printTools = false;
let elicitationMode = "decline";
let elicitations = 0;
let callTimeoutMs = 120_000;
const serverArgs = [];
const calls = [];
const env = { ...process.env };
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--entry") entry = argv[++i];
  else if (a === "--min-tools") minTools = Number(argv[++i]);
  else if (a === "--print-tools") printTools = true;
  else if (a === "--elicitation") elicitationMode = argv[++i];
  else if (a === "--call-timeout-ms") callTimeoutMs = Number(argv[++i]);
  else if (a === "--server-arg") serverArgs.push(argv[++i]);
  else if (a === "--call" || a === "--expect-error") calls.push({ tool: argv[++i], args: JSON.parse(argv[++i] ?? "{}"), expectError: a === "--expect-error" });
  else if (a === "--env") {
    const [k, ...v] = argv[++i].split("=");
    env[k] = v.join("=");
  }
}

const failures = [];
const fail = (msg) => {
  failures.push(msg);
  console.log(`  FAIL ${msg}`);
};
const pass = (msg) => console.log(`  ok   ${msg}`);

const child = spawn(process.execPath, [entry, ...serverArgs], { cwd: serverDir, env, stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));

const pending = new Map();
let buf = "";
const pollution = [];
child.stdout.on("data", (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      pollution.push(line);
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "elicitation/create" || msg.method === "sampling/createMessage") {
      elicitations++;
      // Decline anything interactive (a smoke run never confirms a write), or
      // leave it unanswered with --elicitation ignore to exercise the
      // server's confirmation timeout.
      if (elicitationMode !== "ignore") {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { action: "decline" } }) + "\n");
      }
    }
  }
});

let nextId = 1;
function rpc(method, params, timeoutMs = 60_000) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${method} timed out after ${timeoutMs}ms`)), timeoutMs);
    pending.set(id, (m) => (clearTimeout(t), res(m)));
  });
}

const exited = new Promise((res) => child.on("exit", (code) => res(code)));

try {
  console.log(`\nstdio-check ${serverDir}/${entry}`);
  const init = await Promise.race([
    rpc("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: { elicitation: {} },
      clientInfo: { name: "mcp-smoke", version: "0" },
    }),
    exited.then((code) => {
      throw new Error(`server exited (${code}) before initialize`);
    }),
  ]);
  if (init.error) throw new Error(`initialize: ${JSON.stringify(init.error)}`);
  pass(`initialize → ${init.result.serverInfo?.name}@${init.result.serverInfo?.version} (protocol ${init.result.protocolVersion})`);
  if (init.result.instructions) console.log(`       instructions: ${init.result.instructions.replace(/\s+/g, " ").slice(0, 300)}`);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const tools = [];
  let cursor;
  do {
    const r = await rpc("tools/list", cursor ? { cursor } : {});
    if (r.error) throw new Error(`tools/list: ${JSON.stringify(r.error)}`);
    tools.push(...r.result.tools);
    cursor = r.result.nextCursor;
  } while (cursor);
  const byName = new Map(tools.map((t) => [t.name, t]));
  (tools.length >= minTools ? pass : fail)(`tools/list → ${tools.length} tools (min ${minTools})`);
  if (printTools) {
    for (const t of tools) {
      const a = t.annotations ?? {};
      console.log(`       - ${t.name}${a.readOnlyHint ? " [ro]" : ""}${a.destructiveHint ? " [destructive]" : ""}`);
    }
  }
  const badIn = tools.filter((t) => t.inputSchema?.type !== "object").map((t) => t.name);
  (badIn.length ? fail : pass)(`inputSchema is an object schema on every tool${badIn.length ? `: ${badIn.join(", ")}` : ""}`);
  const withOut = tools.filter((t) => t.outputSchema);
  const badOut = withOut.filter((t) => t.outputSchema.type !== "object").map((t) => t.name);
  (badOut.length ? fail : pass)(`outputSchema is an object schema where present (${withOut.length} tools)${badOut.length ? `: ${badOut.join(", ")}` : ""}`);
  const unknownTypes = tools.filter((t) => JSON.stringify(t.inputSchema).includes('"unknown"')).map((t) => t.name);
  (unknownTypes.length ? fail : pass)(`no "unknown" types in input schemas${unknownTypes.length ? `: ${unknownTypes.slice(0, 10).join(", ")}` : ""}`);

  for (const c of calls) {
    const tool = byName.get(c.tool);
    if (!tool) {
      fail(`call ${c.tool}: not in tools/list`);
      continue;
    }
    const before = elicitations;
    const r = await rpc("tools/call", { name: c.tool, arguments: c.args }, callTimeoutMs);
    if (elicitations > before) {
      console.log(`       (${elicitations - before} confirmation request(s) ${elicitationMode === "ignore" ? "left unanswered" : "declined"})`);
    }
    const res = r.result;
    const text = (res?.content ?? []).map((x) => x.text ?? "").join(" ").replace(/\s+/g, " ").slice(0, 200);
    if (c.expectError) {
      const errored = Boolean(r.error || res?.isError);
      (errored ? pass : fail)(
        `call ${c.tool} ${JSON.stringify(c.args)} → ${errored ? "error as expected" : "expected an error, got success"}: ${r.error ? JSON.stringify(r.error).slice(0, 200) : text}`,
      );
      continue;
    }
    if (r.error || res?.isError) {
      fail(`call ${c.tool} ${JSON.stringify(c.args)} → ${r.error ? JSON.stringify(r.error) : text}`);
      continue;
    }
    if (tool.outputSchema) {
      if (!res.structuredContent) {
        fail(`call ${c.tool}: has outputSchema but no structuredContent`);
        continue;
      }
      const v = new Validator(tool.outputSchema, "2020-12", false).validate(res.structuredContent);
      (v.valid ? pass : fail)(`call ${c.tool} → structuredContent ${v.valid ? "validates" : "INVALID: " + JSON.stringify(v.errors.slice(0, 3))}`);
    } else {
      pass(`call ${c.tool} → ${text.slice(0, 120)}`);
    }
  }
} catch (err) {
  fail(String(err.message ?? err));
} finally {
  // Give a late stray log line a chance to land before judging stdout.
  await new Promise((r) => setTimeout(r, 300));
  (pollution.length ? fail : pass)(`stdout is pure JSON-RPC${pollution.length ? ` — ${pollution.length} stray line(s): ${pollution.slice(0, 3).join(" | ").slice(0, 300)}` : ""}`);
  child.stdin.end();
  child.kill();
  const errTail = stderr.trim().split("\n").filter((l) => !/NODE_TLS_REJECT_UNAUTHORIZED|trace-warnings/.test(l)).slice(-8);
  if (errTail.length) console.log(`  stderr (tail):\n    ${errTail.join("\n    ")}`);
  console.log(failures.length ? `\n${failures.length} check(s) FAILED` : "\nall checks passed");
  process.exit(failures.length ? 1 : 0);
}
