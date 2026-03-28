/**
 * Full E2E test for the create-mcp-server CLI flow:
 *   create → init → start Umbraco → health check → API user creation → verify
 *
 * Requires:
 *   - TEST_SQL_CONNECTION_STRING env var (server-level, e.g. "Server=localhost,1433;User Id=sa;Password=xxx;TrustServerCertificate=True")
 *   - PSW CLI installed (dotnet tool install -g PackageScriptWriter.Cli)
 *   - .NET 10+
 *
 * Run: TEST_SQL_CONNECTION_STRING="..." npm run test:e2e -w packages/create-mcp-server
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

// Allow self-signed certs for localhost Umbraco
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const BASE_CONNECTION_STRING = getBaseConnectionString();
const DB_NAME = `umbraco_e2e_${randomUUID().slice(0, 8)}`;

function getBaseConnectionString(): string {
  const raw = process.env.TEST_SQL_CONNECTION_STRING ?? "";
  // Strip any Database= part to get the server-level connection string
  return raw
    .split(";")
    .filter((part) => !part.trim().toLowerCase().startsWith("database="))
    .join(";");
}

function buildConnectionString(dbName?: string): string {
  if (dbName) {
    return `${BASE_CONNECTION_STRING};Database=${dbName}`;
  }
  return BASE_CONNECTION_STRING;
}

/**
 * Parse a SQL Server connection string into tedious config.
 */
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
  };

  if (parts.get("user id")) {
    config.authentication = {
      type: "default",
      options: {
        userName: parts.get("user id"),
        password: parts.get("password") ?? "",
      },
    };
  }

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

// ─── Skip guard ──────────────────────────────────────────────────────────────
const SKIP =
  !process.env.TEST_SQL_CONNECTION_STRING ||
  process.env.TEST_SQL_CONNECTION_STRING.includes("{changt-this}");

const describeOrSkip = SKIP ? describe.skip : describe;

describeOrSkip("CLI full E2E", () => {
  let tempDir: string;
  let projectDir: string;
  let instanceDir: string;
  let umbracoProcess: ChildProcess | undefined;
  let baseUrl: string;

  // ── Setup: create temp dir & database ────────────────────────────────────
  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-e2e-"));
    projectDir = path.join(tempDir, "test-project");

    console.log(`[E2E] Temp dir: ${tempDir}`);
    console.log(`[E2E] DB name: ${DB_NAME}`);

    // Create the test database
    await execSql(
      buildConnectionString(),
      `CREATE DATABASE [${DB_NAME}]`,
    );
    console.log(`[E2E] Database created: ${DB_NAME}`);
  }, 60_000);

  // ── Teardown: kill Umbraco, drop database, remove temp dir ───────────────
  afterAll(async () => {
    if (umbracoProcess) {
      console.log("[E2E] Stopping Umbraco...");
      umbracoProcess.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 3000));
      if (!umbracoProcess.killed) {
        umbracoProcess.kill("SIGKILL");
      }
    }

    try {
      await execSql(
        buildConnectionString(),
        `ALTER DATABASE [${DB_NAME}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB_NAME}]`,
      );
      console.log(`[E2E] Database dropped: ${DB_NAME}`);
    } catch (err) {
      console.warn(`[E2E] Failed to drop database: ${err}`);
    }

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log(`[E2E] Temp dir cleaned up`);
    } catch {
      // Ignore cleanup errors
    }
  }, 30_000);

  // ── Step 1: Scaffold ────────────────────────────────────────────────────
  test("Step 1: create — scaffolds project", () => {
    // Run the built CLI binary (not source) because scaffoldProject uses __dirname
    // to find dist/template/ which doesn't work when imported from ts-jest source
    const cliBin = path.resolve(__dirname, "../../dist/index.js");
    execFileSync("node", [cliBin, "test-project"], {
      cwd: tempDir,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: "inherit",
    });

    // Verify key files exist
    expect(fs.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(projectDir, "umbraco", "McpOAuthComposer.cs")),
    ).toBe(true);
    expect(fs.existsSync(path.join(projectDir, ".env.example"))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "index.ts"))).toBe(true);

    // Verify package.json has correct name
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf-8"),
    );
    expect(pkg.name).toBe("test-project");

    console.log("[E2E] Step 1 passed: project scaffolded");
  });

  // ── Step 2: Init — create Umbraco instance ──────────────────────────────
  test("Step 2: init — creates Umbraco instance with correct config", async () => {
    const { setupInstance } = await import("../../src/init/setup-instance.js");

    instanceDir = path.join(projectDir, "demo-site");

    const result = await setupInstance({
      packageName: "Umbraco.Forms",
      instanceDir,
      projectDir,
      connectionString: buildConnectionString(DB_NAME),
    });

    // Verify appsettings.local.json has connection string (gitignored)
    const localSettings = JSON.parse(
      fs.readFileSync(path.join(instanceDir, "appsettings.local.json"), "utf-8"),
    );
    expect(localSettings.ConnectionStrings).toBeDefined();
    expect(localSettings.ConnectionStrings.umbracoDbDSN).toContain(DB_NAME);
    expect(localSettings.ConnectionStrings.umbracoDbDSN_ProviderName).toBe(
      "Microsoft.Data.SqlClient",
    );

    // Verify appsettings.Development.json has unattended install config
    const devSettings = JSON.parse(
      fs.readFileSync(
        path.join(instanceDir, "appsettings.Development.json"),
        "utf-8",
      ),
    );
    expect(devSettings.Umbraco.CMS.Unattended.InstallUnattended).toBe(true);
    expect(devSettings.Umbraco.CMS.Unattended.UnattendedUserEmail).toBe(
      "admin@test.com",
    );

    // Verify McpOAuthComposer.cs was copied
    expect(
      fs.existsSync(path.join(instanceDir, "McpOAuthComposer.cs")),
    ).toBe(true);

    // Verify Program.cs was patched with both snippets
    const programCs = fs.readFileSync(
      path.join(instanceDir, "Program.cs"),
      "utf-8",
    );
    expect(programCs).toContain("appsettings.local.json");
    expect(programCs).toContain("DisableTransportSecurityRequirement");

    // Verify McpOAuthComposer has try-catch resilience
    const composer = fs.readFileSync(
      path.join(instanceDir, "McpOAuthComposer.cs"),
      "utf-8",
    );
    expect(composer).toContain("try");
    expect(composer).toContain("catch");

    // Verify dotnet build succeeds
    console.log("[E2E] Building Umbraco instance...");
    execFileSync("dotnet", ["build"], {
      cwd: instanceDir,
      encoding: "utf-8",
      timeout: 180_000,
      stdio: "inherit",
    });

    console.log("[E2E] Step 2 passed: instance created with correct config");
  }, 300_000);

  // ── Step 3: Start Umbraco and wait for healthy ──────────────────────────
  test("Step 3: start Umbraco and wait for healthy", async () => {
    console.log("[E2E] Starting Umbraco...");

    umbracoProcess = spawn(
      "dotnet",
      ["run", "--no-build"],
      {
        cwd: instanceDir,
        env: {
          ...process.env,
          ASPNETCORE_ENVIRONMENT: "Development",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    // Capture the actual listening URL from stdout
    let detectedUrl: string | undefined;

    // Only log important Umbraco output to avoid truncation from verbose SQL migration logs
    const importantPatterns = /Now listening|Application started|unattended|error|Error|WARN|fail|McpOAuth|Skipped/i;

    umbracoProcess.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line && importantPatterns.test(line)) {
        console.log(`[Umbraco] ${line}`);
      }

      // Parse "Now listening on: http://localhost:XXXX"
      const match = line.match(/Now listening on: (http:\/\/localhost:\d+)/);
      if (match && !detectedUrl) {
        detectedUrl = match[1];
        console.log(`[E2E] Detected HTTP URL: ${detectedUrl}`);
      }
    });
    umbracoProcess.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trim();
      if (line) console.log(`[Umbraco:err] ${line}`);
    });

    umbracoProcess.on("exit", (code) => {
      console.log(`[Umbraco] Process exited with code ${code}`);
    });

    // Wait for Umbraco to become healthy (poll until we detect a URL + swagger responds)
    const maxWait = 240_000; // 4 minutes (unattended install can be slow)
    const pollInterval = 3_000;
    const start = Date.now();

    let healthy = false;
    while (Date.now() - start < maxWait) {
      // Check if process died
      if (umbracoProcess.exitCode !== null) {
        console.log(`[E2E] Umbraco process died with code ${umbracoProcess.exitCode}`);
        break;
      }

      // Need to detect the URL first
      if (!detectedUrl) {
        await new Promise((r) => setTimeout(r, pollInterval));
        continue;
      }

      try {
        const resp = await fetch(`${detectedUrl}/umbraco/swagger/`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (resp.ok) {
          healthy = true;
          baseUrl = detectedUrl;
          break;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    expect(healthy).toBe(true);
    console.log(
      `[E2E] Step 3 passed: Umbraco healthy at ${baseUrl} (${Math.round((Date.now() - start) / 1000)}s)`,
    );
  }, 300_000);

  // ── Step 4: Check API user creation ─────────────────────────────────────
  test("Step 4: discover — API user creation works", async () => {
    const { checkApiUser } = await import("../../src/discover/check-api-user.js");

    const result = await checkApiUser(baseUrl);

    console.log("[E2E] API user result:", result);

    expect(result.authenticated).toBe(true);
    if (result.created) {
      console.log("[E2E] API user was auto-created");
    } else {
      console.log("[E2E] API user already existed");
    }

    console.log("[E2E] Step 4 passed: API user authenticated");
  }, 30_000);

  // ── Step 5: Verify API user with direct token request ───────────────────
  let accessToken: string;

  test("Step 5: verify API user can get access token", async () => {
    const tokenUrl = `${baseUrl}/umbraco/management/api/v1/security/back-office/token`;

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: "umbraco-back-office-mcp",
        client_secret: "1234567890",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    expect(response.ok).toBe(true);

    const data = (await response.json()) as { access_token?: string };
    expect(data.access_token).toBeDefined();
    expect(typeof data.access_token).toBe("string");
    accessToken = data.access_token!;

    console.log("[E2E] Step 5 passed: API user token obtained");
  }, 15_000);

  // ── Step 5b: Verify API user exists in Umbraco user list ────────────────
  test("Step 5b: verify API user exists via management API", async () => {
    // Use the token from step 5 to query the current user endpoint
    const currentUserUrl = `${baseUrl}/umbraco/management/api/v1/user/current`;

    const response = await fetch(currentUserUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    expect(response.ok).toBe(true);

    const user = (await response.json()) as {
      name?: string;
      email?: string;
      isAdmin?: boolean;
      kind?: string;
    };

    expect(user.name).toBe("MCP API User");
    expect(user.email).toBe("mcp-api@localhost");
    expect(user.isAdmin).toBe(true);

    console.log(`[E2E] Step 5b passed: API user verified — ${user.name} (${user.email})`);
  }, 15_000);

  // ── Step 6: Discover APIs and produce .discover.json ──────────────────
  test("Step 6: discover — swagger discovery and .discover.json", async () => {
    const { discoverSwaggerEndpoints } = await import("../../src/discover/discover-swagger.js");
    const { analyzeApi } = await import("../../src/discover/analyze-api.js");
    const { groupsToCollectionNames } = await import("../../src/discover/suggest-modes.js");
    const { updateEnvBaseUrl, updateEnvVar } = await import("../../src/discover/index.js");

    // Discover swagger endpoints from the running instance
    const endpoints = await discoverSwaggerEndpoints(baseUrl);
    expect(endpoints.length).toBeGreaterThan(0);
    console.log(`[E2E] Found ${endpoints.length} API(s): ${endpoints.map((e) => e.name).join(", ")}`);

    // Verify Forms API was discovered (we installed Umbraco.Forms)
    const formsApi = endpoints.find((e) =>
      e.name.toLowerCase().includes("forms"),
    );
    expect(formsApi).toBeDefined();
    console.log(`[E2E] Forms API found: ${formsApi!.name}`);

    // Pick the core Umbraco Management API (not Forms/Commerce management APIs)
    const managementApi = endpoints.find((e) =>
      e.name === "Umbraco Management API",
    ) ?? endpoints.find((e) =>
      e.name.toLowerCase() === "umbraco management api",
    ) ?? endpoints[0];

    // Analyze the API
    const analysis = await analyzeApi(managementApi.url);
    expect(analysis.groups.length).toBeGreaterThan(0);
    expect(analysis.totalOperations).toBeGreaterThan(0);
    console.log(`[E2E] API: ${analysis.title} — ${analysis.groups.length} groups, ${analysis.totalOperations} operations`);

    // Update .env with base URL and credentials (as discover + init would)
    updateEnvBaseUrl(projectDir, baseUrl);
    updateEnvVar(projectDir, "UMBRACO_CLIENT_ID", "umbraco-back-office-mcp");
    updateEnvVar(projectDir, "UMBRACO_CLIENT_SECRET", "1234567890");

    // Write .discover.json manifest (as discover does at step 14)
    const manifest = {
      apiName: analysis.title,
      swaggerUrl: managementApi.url,
      baseUrl,
      collections: groupsToCollectionNames(analysis.groups),
    };

    const manifestPath = path.join(projectDir, ".discover.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

    // Verify .discover.json exists and has expected structure
    expect(fs.existsSync(manifestPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(written.apiName).toBeDefined();
    expect(written.swaggerUrl).toContain("/umbraco/swagger/");
    expect(written.baseUrl).toBe(baseUrl);
    expect(Array.isArray(written.collections)).toBe(true);
    expect(written.collections.length).toBeGreaterThan(0);

    // Verify .env was updated
    const envContent = fs.readFileSync(path.join(projectDir, ".env"), "utf-8");
    expect(envContent).toContain(`UMBRACO_BASE_URL=${baseUrl}`);

    console.log(`[E2E] Step 6 passed: .discover.json written with ${written.collections.length} collections`);
  }, 30_000);

  // ── Step 7: Health check function works ─────────────────────────────────
  test("Step 7: health check reports healthy", async () => {
    const { checkHealth } = await import("../../src/discover/health-check.js");

    const result = await checkHealth(baseUrl);
    expect(result.healthy).toBe(true);

    console.log("[E2E] Step 7 passed: health check reports healthy");
  }, 15_000);

  // ── Step 8: Generate API client from discovered API ──────────────────────
  test("Step 8: generate API client from running instance", async () => {
    const { generateClient } = await import("../../src/discover/generate-client.js");
    const { configureOpenApi } = await import("../../src/init/configure-openapi.js");
    const { discoverSwaggerEndpoints } = await import("../../src/discover/discover-swagger.js");

    // Find the management API swagger URL
    const endpoints = await discoverSwaggerEndpoints(baseUrl);
    const managementApi = endpoints.find((e) =>
      e.name.toLowerCase().includes("management"),
    ) ?? endpoints[0];

    // Configure orval.config.ts to point at the live swagger URL
    configureOpenApi(projectDir, managementApi.url, managementApi.name);

    // Generate client (this also runs npm install if node_modules missing)
    console.log("[E2E] Generating API client...");
    const result = generateClient(projectDir);

    expect(result.success).toBe(true);
    console.log("[E2E] Step 8 passed: API client generated");
  }, 180_000);

  // ── Step 9: TypeScript compile on scaffolded project ────────────────────
  test("Step 9: scaffolded project TypeScript compiles cleanly", () => {
    console.log("[E2E] Running TypeScript compile check...");
    execFileSync("npm", ["run", "compile"], {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 60_000,
      stdio: "inherit",
    });

    console.log("[E2E] Step 9 passed: TypeScript compiles cleanly");
  }, 120_000);

  // ── Step 10: Run scaffolded project unit tests ──────────────────────────
  test("Step 10: scaffolded project unit tests pass", () => {
    // Run only config/mock tests, not the example integration tests which
    // need a specific API that doesn't exist on a vanilla Umbraco instance
    console.log("[E2E] Running scaffolded project unit tests...");
    try {
      execFileSync(
        "node",
        ["--experimental-vm-modules", "node_modules/jest/bin/jest.js", "--testPathPattern=src/config/__tests__", "--runInBand"],
        {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 120_000,
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_TLS_REJECT_UNAUTHORIZED: "0",
        },
      });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string };
      if (e.stdout) console.log("[test stdout]", e.stdout.slice(-3000));
      if (e.stderr) console.log("[test stderr]", e.stderr.slice(-3000));
      throw err;
    }

    console.log("[E2E] Step 10 passed: unit tests pass");
  }, 180_000);

  // ── Step 11: Real API call with generated client against running Umbraco ─
  test("Step 11: real Management API call succeeds", async () => {
    // Call the server information endpoint — this proves:
    // 1. The Umbraco instance is running and accessible
    // 2. The API user token works for Management API calls
    // 3. The API returns valid data
    const serverInfoUrl = `${baseUrl}/umbraco/management/api/v1/server/information`;

    const response = await fetch(serverInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    expect(response.ok).toBe(true);

    const info = (await response.json()) as {
      version?: string;
      assemblyVersion?: string;
    };

    expect(info.version).toBeDefined();
    expect(typeof info.version).toBe("string");
    console.log(`[E2E] Server version: ${info.version}`);

    // Also call a list endpoint to verify full API access with data
    const languageUrl = `${baseUrl}/umbraco/management/api/v1/language?skip=0&take=10`;

    const languageResponse = await fetch(languageUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });

    expect(languageResponse.ok).toBe(true);

    const languages = (await languageResponse.json()) as {
      total?: number;
      items?: unknown[];
    };

    expect(languages.total).toBeDefined();
    expect(languages.total).toBeGreaterThan(0); // At least the default language
    console.log(`[E2E] Languages: ${languages.total}`);

    console.log("[E2E] Step 11 passed: real API calls succeed");
  }, 15_000);
});
