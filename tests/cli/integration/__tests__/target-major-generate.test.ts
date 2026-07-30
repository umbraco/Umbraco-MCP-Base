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

interface StampRun {
  ok: boolean;
  /** stdout only — the CLI's success reporting. */
  stdout: string;
  /** stderr only — usage and the fatal message. */
  stderr: string;
  /** stdout + stderr, for assertions that don't care which stream. */
  output: string;
  generated: string | null;
}

/**
 * Spawns the bin in `dir` with exactly `args` (no `--output` added), so tests
 * can exercise argv handling the CLI's own `parseArgs` does — including the
 * cases where required arguments are absent or empty.
 */
async function runStampArgs(
  dir: string,
  args: string[],
  instanceBaseUrl?: string
): Promise<StampRun> {
  let ok = true;
  let stdout = "";
  let stderr = "";

  try {
    const result = await execFileAsync(process.execPath, [STAMP_BIN, ...args], {
      cwd: dir,
      env: childEnv(instanceBaseUrl),
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    ok = false;
    const e = error as { stdout?: string; stderr?: string; message: string };
    stdout = e.stdout ?? "";
    stderr = (e.stderr ?? "") + e.message;
  }

  const generatedPath = path.join(dir, GENERATED_PATH);
  const generated = fs.existsSync(generatedPath)
    ? fs.readFileSync(generatedPath, "utf8")
    : null;

  return { ok, stdout, stderr, output: stdout + stderr, generated };
}

/** Runs `body` against a throwaway project directory, then removes it. */
async function withProject<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "target-major-stamp-"));
  try {
    return await body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes a spec carrying `version` into `dir`, and returns its `--spec` value. */
function writeSpec(dir: string, version: string): string {
  fs.writeFileSync(
    path.join(dir, "spec.json"),
    JSON.stringify(
      { ...LATEST_SPEC, info: { ...LATEST_SPEC.info, version } },
      null,
      2
    )
  );
  return "./spec.json";
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
  /** A `--spec` value passed verbatim — for pointing at something unreadable. */
  specPath?: string;
}): Promise<StampRun> {
  return withProject(async (dir) => {
    const args = ["--output", `./${GENERATED_PATH}`];

    if (options.specVersion !== undefined) {
      args.push("--spec", writeSpec(dir, options.specVersion));
    } else if (options.specPath !== undefined) {
      args.push("--spec", options.specPath);
    }

    if (options.major) args.push("--major", options.major);

    return runStampArgs(dir, args, options.instanceBaseUrl);
  });
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

  it("names the real reason an unreadable --spec failed", async () => {
    // A typo'd path. Without the reason threaded through, the error would claim
    // the spec was read and merely said "Latest" — sending the user to debug
    // Umbraco's version quirk instead of their own argument.
    const { ok, output } = await runStamp({ specPath: "./nope.yaml" });

    expect(ok).toBe(false);
    expect(output).toContain("./nope.yaml could not be read");
    expect(output).toContain("ENOENT");
    expect(output).not.toContain('hard-codes this to "Latest"');
  }, 120_000);

  describe("lazy --spec resolution", () => {
    // `--spec` is the last-resort source. Reading it on a run another source
    // already answered is wasted work — a whole extra HTTP fetch for an
    // http(s) spec — and warns about a file nothing consulted.

    it("does not read the spec when --major is given", async () => {
      // Arrange / Act - an unreadable spec proves it was never opened.
      const { ok, output, generated } = await runStamp({
        major: "18",
        specPath: "./nope.yaml",
      });

      // Assert
      expect(ok).toBe(true);
      expect(generated).toContain('export const UMBRACO_TARGET_MAJOR = "18";');
      expect(output).not.toContain("Could not read the spec");
    }, 120_000);

    it("does not read the spec when the instance answers", async () => {
      await withMockUmbracoServer("18.0.2", async (instanceBaseUrl) => {
        // Act
        const { ok, output, generated } = await runStamp({
          instanceBaseUrl,
          specPath: "./nope.yaml",
        });

        // Assert
        expect(ok).toBe(true);
        expect(generated).toContain('export const UMBRACO_TARGET_MAJOR = "18";');
        expect(output).not.toContain("Could not read the spec");
      });
    }, 120_000);
  });

  describe("argument handling", () => {
    // Everything below only exists in the built binary's `parseArgs` wiring and
    // exit codes — invisible to a test that imports the module.

    it("rejects an empty --major rather than ignoring it", async () => {
      // `--major ""` is *present*, so it must reach validation. Forwarding it on
      // truthiness instead of presence would silently drop it, fall through to
      // another source, and stamp a major the caller never asked for.
      const run = await withProject((dir) =>
        runStampArgs(dir, ["--output", `./${GENERATED_PATH}`, "--major", ""])
      );

      expect(run.ok).toBe(false);
      expect(run.output).toContain("Invalid `major` option");
      expect(run.generated).toBeNull();
    }, 120_000);

    it("prints usage to stderr and exits non-zero without --output", async () => {
      // Act
      const run = await withProject((dir) => runStampArgs(dir, ["--major", "18"]));

      // Assert - a missing required argument must fail `npm run generate`, and
      // say how to fix it.
      expect(run.ok).toBe(false);
      expect(run.stderr).toContain("Usage: umbraco-mcp-stamp-target-major");
      expect(run.stderr).toContain("--output is required");
      expect(run.generated).toBeNull();
    }, 120_000);

    it.each([["-h"], ["--help"]])(
      "prints usage and exits 0 for %s without resolving anything",
      async (flag) => {
        // Arrange - credentials point at a port nothing listens on, and the
        // spec does not exist. Help must touch neither.
        const run = await withProject((dir) =>
          runStampArgs(
            dir,
            [flag, "--output", `./${GENERATED_PATH}`, "--spec", "./nope.yaml"],
            "http://127.0.0.1:1"
          )
        );

        // Assert
        expect(run.ok).toBe(true);
        expect(run.stdout).toContain("Usage: umbraco-mcp-stamp-target-major");
        expect(run.generated).toBeNull();
        expect(run.output).not.toContain("Could not read the spec");
        expect(run.output).not.toContain("Could not read the target Umbraco major");
      },
      120_000
    );

    it("passes --constant-name through argv to the generated file", async () => {
      // A typo in the parseArgs key mapping ("constant-name" → constantName)
      // would silently fall back to the default name, and only bite a consumer
      // whose import then fails to resolve.
      const run = await withProject((dir) =>
        runStampArgs(dir, [
          "--output",
          `./${GENERATED_PATH}`,
          "--major",
          "18",
          "--constant-name",
          "MY_TARGET",
        ])
      );

      expect(run.ok).toBe(true);
      expect(run.generated).toContain('export const MY_TARGET = "18";');
    }, 120_000);

    it("reports (unchanged) on a second identical run", async () => {
      // The `wrote: false` path, as the user sees it. A no-op regeneration must
      // leave the working tree clean and say so.
      const runs = await withProject(async (dir) => {
        const args = ["--output", `./${GENERATED_PATH}`, "--major", "18"];
        return [
          await runStampArgs(dir, args),
          await runStampArgs(dir, args),
        ] as const;
      });

      expect(runs[0].ok).toBe(true);
      expect(runs[0].stdout).toContain('Target major "18"');
      expect(runs[0].stdout).not.toContain("(unchanged)");

      expect(runs[1].ok).toBe(true);
      expect(runs[1].stdout).toContain("(unchanged)");
    }, 120_000);
  });
});
