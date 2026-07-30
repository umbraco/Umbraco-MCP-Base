/**
 * Target-Major Stamp Integration Tests
 *
 * Spawns the built `umbraco-mcp-stamp-target-major` bin
 * (`packages/mcp-server-sdk/dist/cli/stamp-target-major.js`) the way
 * `npm run generate` does — a real child process, real argv parsing, real file
 * I/O, against the real `dist` artifact rather than the TypeScript source.
 *
 * Why this stays an integration test now that no orval transformer is involved:
 * everything between "npm script line" and "constant on disk" only exists in
 * the built binary — the shebang and `bin` wiring, `parseArgs`, `.env` loading,
 * reading `--spec` off disk, and the non-zero exit that has to fail
 * `npm run generate`. A unit test importing the module can't observe any of it,
 * and a broken build artifact would leave the version check running on a stale
 * major (umbraco/Umbraco-MCP-Base#220).
 *
 * The Umbraco instance is stubbed (token + `server/information`), so these
 * tests need no running Umbraco.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withMockUmbracoServer } from "../helpers/mock-umbraco-server.js";

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);
const STAMP_BIN = path.join(
  REPO_ROOT,
  "packages/mcp-server-sdk/dist/cli/stamp-target-major.js"
);
const GENERATED_PATH = "src/config/umbraco-target.generated.ts";

/** A spec that reports what every real Umbraco reports: no usable version. */
const LATEST_SPEC = {
  openapi: "3.0.4",
  info: { title: "Umbraco Management API", version: "Latest" },
  paths: {},
};

/**
 * Environment for the child process. Credentials are configurable only via
 * these three variables — there is no flag equivalent — so the test drives
 * exactly the path a real `npm run generate` does. Omitting the base URL is how
 * a project opts out of the lookup.
 */
function childEnv(instanceBaseUrl?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.UMBRACO_BASE_URL;
  delete env.UMBRACO_CLIENT_ID;
  delete env.UMBRACO_CLIENT_SECRET;

  if (instanceBaseUrl) {
    env.UMBRACO_BASE_URL = instanceBaseUrl;
    env.UMBRACO_CLIENT_ID = "id";
    env.UMBRACO_CLIENT_SECRET = "secret";
  }
  return env;
}

/**
 * Writes a throwaway project (optionally a spec file) and runs the bin in it.
 * Returns the child's combined output plus the generated constant, if any.
 */
async function runStamp(options: {
  instanceBaseUrl?: string;
  major?: string;
  /** `info.version` of the spec written to disk; omit to pass no `--spec`. */
  specVersion?: string;
}): Promise<{ ok: boolean; output: string; generated: string | null }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "target-major-stamp-"));

  try {
    const args = [STAMP_BIN, "--output", `./${GENERATED_PATH}`];

    if (options.specVersion !== undefined) {
      fs.writeFileSync(
        path.join(dir, "spec.json"),
        JSON.stringify(
          { ...LATEST_SPEC, info: { ...LATEST_SPEC.info, version: options.specVersion } },
          null,
          2
        )
      );
      args.push("--spec", "./spec.json");
    }

    if (options.major) args.push("--major", options.major);

    let ok = true;
    let output = "";
    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, args, {
        cwd: dir,
        env: childEnv(options.instanceBaseUrl),
      });
      output = stdout + stderr;
    } catch (error) {
      ok = false;
      const e = error as { stdout?: string; stderr?: string; message: string };
      output = (e.stdout ?? "") + (e.stderr ?? "") + e.message;
    }

    const generatedPath = path.join(dir, GENERATED_PATH);
    const generated = fs.existsSync(generatedPath)
      ? fs.readFileSync(generatedPath, "utf8")
      : null;

    return { ok, output, generated };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("Target major stamp (built CLI)", () => {
  beforeAll(() => {
    if (!fs.existsSync(STAMP_BIN)) {
      throw new Error(
        `SDK not built. Run \`npm run build\` first. Looked for ${STAMP_BIN}`
      );
    }
  });

  it("resolves the major from the instance when the spec says 'Latest'", async () => {
    // The case the spec cannot serve, which is every real Umbraco spec.
    await withMockUmbracoServer("18.0.2", async (instanceBaseUrl) => {
      const { ok, generated } = await runStamp({
        instanceBaseUrl,
        specVersion: "Latest",
      });

      expect(ok).toBe(true);
      expect(generated).toContain('export const UMBRACO_TARGET_MAJOR = "18";');
      expect(generated).toContain("18.0.2");
      expect(generated).toContain("server/information");
    });
  }, 120_000);

  it("falls back to the spec's info.version when the instance is unreachable", async () => {
    // Offline generation from a committed spec carrying a real semver — the
    // template's own `openapi.yaml` (17.4.0) is exactly this case. Reading and
    // parsing that file is the CLI's own job now, not orval's.
    const { ok, output, generated } = await runStamp({
      // A port nothing listens on: reachable config, unreachable instance.
      instanceBaseUrl: "http://127.0.0.1:1",
      specVersion: "17.4.0",
    });

    expect(ok).toBe(true);
    expect(generated).toContain('export const UMBRACO_TARGET_MAJOR = "17";');
    expect(generated).toContain("17.4.0");
    // The fallback is announced: an add-on's spec reports its own release.
    expect(output).toContain("Falling back to the spec");
  }, 120_000);

  it("fails generation rather than emitting a guessed major", async () => {
    // No instance, no usable info.version, no explicit major: the build must
    // stop. Warning-and-continuing here is what reintroduced #220.
    const { ok, output, generated } = await runStamp({ specVersion: "Latest" });

    expect(ok).toBe(false);
    expect(output).toContain("Cannot determine the target Umbraco major");
    expect(generated).toBeNull();
  }, 120_000);

  it("honours an explicit major with no instance available", async () => {
    // The documented escape hatch for offline generation.
    const { ok, generated } = await runStamp({ major: "17" });

    expect(ok).toBe(true);
    expect(generated).toContain('export const UMBRACO_TARGET_MAJOR = "17";');
  }, 120_000);
});
