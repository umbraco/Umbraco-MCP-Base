/**
 * Self-contained E2E for the "Use existing instance" init path.
 *
 * Spawns a copy of tests/umbraco-instance (.NET 10) configured against
 * SQL Server on a random port, scaffolds a project, drives the operations
 * the init "existing" branch runs (the prompts themselves are covered by
 * unit tests), then asserts on .env, orval.config.ts, and a real API call.
 *
 * Requires: TEST_SQL_CONNECTION_STRING + .NET 10 SDK.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Connection, Request } from "tedious";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const MONOREPO_ROOT = path.resolve(__dirname, "../../../..");
const UMBRACO_INSTANCE_DIR = path.join(MONOREPO_ROOT, "tests", "umbraco-instance");
const ADMIN_EMAIL = "admin@admin.com";
const ADMIN_PASSWORD = "1234567890";

const DB_NAME = `umbraco_existing_e2e_${randomUUID().slice(0, 8)}`;

function getBaseConnectionString(): string {
  const raw = process.env.TEST_SQL_CONNECTION_STRING ?? "";
  // Strip any Database= part to get the server-level connection string
  return raw
    .split(";")
    .filter((part) => !part.trim().toLowerCase().startsWith("database="))
    .join(";");
}

const BASE_CONNECTION_STRING = getBaseConnectionString();

function buildConnectionString(dbName?: string): string {
  return dbName ? `${BASE_CONNECTION_STRING};Database=${dbName}` : BASE_CONNECTION_STRING;
}

function parseTediousConfig(connStr: string) {
  const parts = new Map<string, string>();
  for (const segment of connStr.split(";")) {
    const eqIdx = segment.indexOf("=");
    if (eqIdx === -1) continue;
    const key = segment.slice(0, eqIdx).trim().toLowerCase();
    const value = segment.slice(eqIdx + 1).trim();
    parts.set(key, value);
  }

  const serverRaw = parts.get("server") ?? "localhost";
  const [host, portStr] = serverRaw.includes(",")
    ? serverRaw.split(",")
    : [serverRaw, "1433"];

  const config: Record<string, unknown> = {
    server: host,
    options: {
      port: parseInt(portStr, 10),
      encrypt: false,
      trustServerCertificate:
        parts.get("trustservercertificate")?.toLowerCase() === "true",
      database: parts.get("database") ?? "master",
    },
    authentication: {
      type: "default",
      options: {
        userName: parts.get("user id"),
        password: parts.get("password") ?? "",
      },
    },
  };

  return config;
}

function execSql(connStr: string, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const config = parseTediousConfig(connStr);
    const connection = new Connection(config as Parameters<typeof Connection>[0]);

    connection.on("connect", (err) => {
      if (err) return reject(err);
      const request = new Request(sql, (reqErr) => {
        connection.close();
        if (reqErr) return reject(reqErr);
        resolve();
      });
      connection.execSql(request);
    });

    connection.connect();
  });
}

const SKIP =
  !process.env.TEST_SQL_CONNECTION_STRING ||
  process.env.TEST_SQL_CONNECTION_STRING.includes("{changt-this}") ||
  !fs.existsSync(UMBRACO_INSTANCE_DIR);

const describeOrSkip = SKIP ? describe.skip : describe;

describeOrSkip("existing-instance E2E", () => {
  let tempDir: string;
  let projectDir: string;
  let umbracoInstanceCopy: string;
  let umbracoProcess: ChildProcess | undefined;
  let baseUrl: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-existing-e2e-"));
    projectDir = path.join(tempDir, "test-project");
    umbracoInstanceCopy = path.join(tempDir, "umbraco-instance");

    console.log(`[existing-e2e] Temp dir: ${tempDir}`);
    console.log(`[existing-e2e] DB name: ${DB_NAME}`);

    await execSql(buildConnectionString(), `CREATE DATABASE [${DB_NAME}]`);
    console.log(`[existing-e2e] Database created`);

    // Copy the instance so bin/ obj/ are isolated from any parallel build.
    fs.cpSync(UMBRACO_INSTANCE_DIR, umbracoInstanceCopy, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        if (base === "bin" || base === "obj") return false;
        if (src.endsWith(path.join("umbraco", "Data"))) return false;
        return true;
      },
    });

    const umbracoConnStr = buildConnectionString(DB_NAME);
    console.log(`[existing-e2e] Starting Umbraco (SQL Server) from copy...`);

    umbracoProcess = spawn(
      "dotnet",
      ["run", "--project", umbracoInstanceCopy, "--no-launch-profile"],
      {
        env: {
          ...process.env,
          ASPNETCORE_ENVIRONMENT: "Development",
          ASPNETCORE_URLS: "http://127.0.0.1:0",
          // Override the SQLite default to point at the per-test SQL Server DB.
          ConnectionStrings__umbracoDbDSN: umbracoConnStr,
          ConnectionStrings__umbracoDbDSN_ProviderName: "Microsoft.Data.SqlClient",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let detectedUrl: string | undefined;
    umbracoProcess.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      if (!detectedUrl) {
        const match = text.match(/Now listening on:\s*(http:\/\/[^\s]+)/);
        if (match) detectedUrl = match[1].replace(/\/+$/, "");
      }
      if (/Now listening|Application started|error|Error|fail/i.test(text)) {
        process.stdout.write(`[umbraco] ${text}`);
      }
    });
    umbracoProcess.stderr?.on("data", (chunk) => {
      process.stderr.write(`[umbraco err] ${chunk.toString()}`);
    });

    const deadline = Date.now() + 240_000;
    let lastError = "";
    while (Date.now() < deadline) {
      if (detectedUrl) {
        try {
          const res = await fetch(`${detectedUrl}/umbraco`, {
            signal: AbortSignal.timeout(5_000),
          });
          if (res.ok || res.status === 302) {
            baseUrl = detectedUrl;
            console.log(`[existing-e2e] Umbraco is up at ${baseUrl}`);
            await new Promise((r) => setTimeout(r, 3_000));
            return;
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(
      `Umbraco did not become healthy within 4 minutes. Last error: ${lastError || "never detected listening URL"}`,
    );
  }, 300_000);

  afterAll(async () => {
    if (umbracoProcess && !umbracoProcess.killed) {
      console.log("[existing-e2e] Stopping Umbraco...");
      umbracoProcess.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 3_000));
      if (!umbracoProcess.killed) {
        umbracoProcess.kill("SIGKILL");
      }
    }

    try {
      await execSql(
        buildConnectionString(),
        `ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB_NAME}]`,
      );
      console.log(`[existing-e2e] Database dropped`);
    } catch (err) {
      console.warn(`[existing-e2e] Failed to drop database: ${err}`);
    }

    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }, 60_000);

  test("Step 1: scaffold a fresh project", () => {
    const cliBin = path.resolve(__dirname, "../../dist/index.js");
    execFileSync("node", [cliBin, "test-project"], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: "inherit",
    });

    expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".env.example"))).toBe(true);

    const pkgPath = path.join(projectDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (pkg.dependencies?.["@umbraco-cms/mcp-server-sdk"]) {
      pkg.dependencies["@umbraco-cms/mcp-server-sdk"] =
        `file:${path.join(MONOREPO_ROOT, "packages/mcp-server-sdk")}`;
    }
    if (pkg.dependencies?.["@umbraco-cms/mcp-hosted"]) {
      pkg.dependencies["@umbraco-cms/mcp-hosted"] =
        `file:${path.join(MONOREPO_ROOT, "packages/hosted-mcp")}`;
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }, 60_000);

  test("Step 2: existing-instance pipeline wires .env and orval.config.ts", async () => {
    const { checkApiUser } = await import("../../src/discover/check-api-user.js");
    const { discoverSwaggerEndpoints } = await import(
      "../../src/discover/discover-swagger.js"
    );
    const { configureOpenApi } = await import("../../src/init/configure-openapi.js");
    const { updateEnvBaseUrl, updateEnvVar } = await import(
      "../../src/discover/index.js"
    );

    const apiUser = await checkApiUser(baseUrl, {
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASSWORD,
    });
    expect(apiUser.authenticated).toBe(true);

    const endpoints = await discoverSwaggerEndpoints(baseUrl);
    expect(endpoints.length).toBeGreaterThan(0);

    const selected =
      endpoints.find((e) => e.name.toLowerCase().includes("management")) ??
      endpoints[0];

    configureOpenApi(projectDir, selected.url, selected.name);
    updateEnvBaseUrl(projectDir, baseUrl);
    updateEnvVar(projectDir, "UMBRACO_CLIENT_ID", "umbraco-back-office-mcp");
    updateEnvVar(projectDir, "UMBRACO_CLIENT_SECRET", "1234567890");

    const envContent = fs.readFileSync(path.join(projectDir, ".env"), "utf-8");
    expect(envContent).toContain(`UMBRACO_BASE_URL=${baseUrl}`);
    expect(envContent).toContain("UMBRACO_CLIENT_ID=umbraco-back-office-mcp");
    expect(envContent).toContain("UMBRACO_CLIENT_SECRET=1234567890");

    const orvalContent = fs.readFileSync(
      path.join(projectDir, "orval.config.ts"),
      "utf-8",
    );
    expect(orvalContent).toContain(selected.url);
  }, 60_000);

  test("Step 3: API user can fetch a token and call the management API", async () => {
    const tokenRes = await fetch(
      `${baseUrl}/umbraco/management/api/v1/security/back-office/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: "umbraco-back-office-mcp",
          client_secret: "1234567890",
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    expect(tokenRes.ok).toBe(true);
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    expect(typeof access_token).toBe("string");

    const currentUserRes = await fetch(
      `${baseUrl}/umbraco/management/api/v1/user/current`,
      {
        headers: { Authorization: `Bearer ${access_token}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    expect(currentUserRes.ok).toBe(true);
    const user = (await currentUserRes.json()) as { name?: string };
    expect(user.name).toBe("MCP API User");
  }, 30_000);
});
