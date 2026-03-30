#!/usr/bin/env npx tsx
/**
 * Clean up preserved E2E test assets.
 *
 * Reads the manifest written by cli-e2e.test.ts (KEEP_E2E_ASSETS=true),
 * kills the Umbraco process, drops the database, and removes the temp dir.
 *
 * Run: npm run test:e2e:cleanup -w packages/create-mcp-server
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Connection, Request } from "tedious";

const MANIFEST_PATH = path.join(os.tmpdir(), "mcp-e2e-manifest.json");

function parseTediousConfig(connStr: string) {
  const parts = new Map<string, string>();
  for (const segment of connStr.split(";")) {
    const eqIdx = segment.indexOf("=");
    if (eqIdx === -1) continue;
    parts.set(segment.slice(0, eqIdx).trim().toLowerCase(), segment.slice(eqIdx + 1).trim());
  }
  const serverRaw = parts.get("server") ?? "localhost";
  const [host, portStr] = serverRaw.includes(",") ? serverRaw.split(",") : [serverRaw, "1433"];
  const config: Record<string, unknown> = {
    server: host,
    options: { port: parseInt(portStr, 10), encrypt: false, trustServerCertificate: parts.get("trustservercertificate")?.toLowerCase() === "true", database: "master" },
  };
  if (parts.get("user id")) {
    config.authentication = { type: "default", options: { userName: parts.get("user id"), password: parts.get("password") ?? "" } };
  }
  return config;
}

function execSql(connStr: string, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const config = parseTediousConfig(connStr);
    const connection = new Connection(config as Parameters<typeof Connection>[0]);
    connection.on("connect", (err) => {
      if (err) return reject(err);
      const request = new Request(sql, (reqErr) => { connection.close(); reqErr ? reject(reqErr) : resolve(); });
      connection.execSql(request);
    });
    connection.connect();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const revertOnly = args.includes("--revert");

  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log("No E2E manifest found. Nothing to clean up.");
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));

  // --revert: just remove skill-generated files so skills can be re-run
  if (revertOnly) {
    const toolsDir = path.join(manifest.projectDir, "src/umbraco-api/tools");
    if (fs.existsSync(toolsDir)) {
      for (const entry of fs.readdirSync(toolsDir)) {
        // Remove anything that's not chained (the only collection that should survive)
        if (entry !== "chained") {
          fs.rmSync(path.join(toolsDir, entry), { recursive: true, force: true });
          console.log(`Removed: ${entry}`);
        }
      }
    }
    console.log("Reverted skill output. Ready for re-run.");
    return;
  }

  console.log("E2E manifest:", manifest);

  // Kill Umbraco process
  if (manifest.umbracoProcessPid) {
    try {
      process.kill(manifest.umbracoProcessPid, "SIGTERM");
      console.log(`Killed Umbraco process ${manifest.umbracoProcessPid}`);
      await new Promise((r) => setTimeout(r, 3000));
    } catch {
      console.log(`Process ${manifest.umbracoProcessPid} already dead`);
    }
  }

  // Drop database
  const connStr = process.env.TEST_SQL_CONNECTION_STRING;
  if (connStr && manifest.dbName) {
    const baseConn = connStr.split(";").filter((p: string) => !p.trim().toLowerCase().startsWith("database=")).join(";");
    try {
      await execSql(baseConn, `ALTER DATABASE [${manifest.dbName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${manifest.dbName}]`);
      console.log(`Database dropped: ${manifest.dbName}`);
    } catch (err) {
      console.log(`Failed to drop database: ${err}`);
    }
  }

  // Remove temp dir
  const tempDir = path.dirname(manifest.projectDir);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`Temp dir removed: ${tempDir}`);
  } catch {
    console.log(`Failed to remove temp dir: ${tempDir}`);
  }

  // Remove manifest
  fs.unlinkSync(MANIFEST_PATH);
  console.log("Manifest removed. Cleanup complete.");
}

main().catch(console.error);
