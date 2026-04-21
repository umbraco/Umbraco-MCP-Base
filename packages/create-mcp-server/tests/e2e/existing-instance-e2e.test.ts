/**
 * Self-contained E2E for the "Use existing instance" init path.
 *
 * Spawns tests/umbraco-instance (SQLite, .NET 10), scaffolds a project,
 * drives the operations the init "existing" branch runs (the prompts
 * themselves are covered by unit tests), then asserts on .env,
 * orval.config.ts, a real API call, and TypeScript compilation.
 *
 * Requires: .NET 10 SDK. No SQL Server needed.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const MONOREPO_ROOT = path.resolve(__dirname, "../../../..");
const UMBRACO_INSTANCE_DIR = path.join(MONOREPO_ROOT, "tests", "umbraco-instance");
const ADMIN_EMAIL = "admin@admin.com";
const ADMIN_PASSWORD = "1234567890";

const SKIP = !fs.existsSync(UMBRACO_INSTANCE_DIR);
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
    console.log(`[existing-e2e] Copying ${UMBRACO_INSTANCE_DIR} → ${umbracoInstanceCopy}`);

    // Copy the instance so bin/, obj/, and umbraco/Data/ are isolated — otherwise
    // a dev's own running instance holds the MainDom lock and the SQLite file open.
    fs.cpSync(UMBRACO_INSTANCE_DIR, umbracoInstanceCopy, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src);
        if (base === "bin" || base === "obj") return false;
        // Skip the committed empty data dir so we start with a truly fresh SQLite
        if (src.endsWith(path.join("umbraco", "Data"))) return false;
        return true;
      },
    });

    console.log(`[existing-e2e] Starting Umbraco from copy...`);
    umbracoProcess = spawn(
      "dotnet",
      ["run", "--project", umbracoInstanceCopy, "--no-launch-profile"],
      {
        env: {
          ...process.env,
          ASPNETCORE_ENVIRONMENT: "Development",
          ASPNETCORE_URLS: "http://127.0.0.1:0",
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

    const deadline = Date.now() + 180_000;
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
      `Umbraco did not become healthy within 3 minutes. Last error: ${lastError || "never detected listening URL"}`,
    );
  }, 240_000);

  afterAll(async () => {
    if (umbracoProcess && !umbracoProcess.killed) {
      console.log("[existing-e2e] Stopping Umbraco...");
      umbracoProcess.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 3_000));
      if (!umbracoProcess.killed) {
        umbracoProcess.kill("SIGKILL");
      }
    }

    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }, 30_000);

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
