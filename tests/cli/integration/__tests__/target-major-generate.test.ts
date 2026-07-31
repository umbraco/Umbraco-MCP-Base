/**
 * Target-Major Generation Integration Tests
 *
 * Runs **real orval** over a spec whose `info.version` is `"Latest"` — the value
 * every Umbraco Management API spec hard-codes — and asserts the generated
 * `UMBRACO_TARGET_MAJOR` still comes out correct.
 *
 * Why this needs to be an integration test rather than a unit test: the whole
 * mechanism rests on orval `await`ing its input transformer
 * (`applyInputTransformer` does `await transformerFn(data)`). That is orval's
 * behaviour, not ours, and a unit test that calls the transformer directly can
 * never catch it regressing on an orval upgrade. If orval ever stops awaiting,
 * the constant silently stops being written and the version check reverts to
 * blocking on a stale major (umbraco/Umbraco-MCP-Base#220).
 *
 * The Umbraco instance is stubbed (token + `server/information`), so these tests
 * need no running Umbraco — just orval, which the template already depends on.
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
const ORVAL_BIN = path.join(REPO_ROOT, "node_modules/orval/dist/bin/orval.mjs");
const SDK_DIST = path.join(REPO_ROOT, "packages/mcp-server-sdk/dist/index.js");
const GENERATED_PATH = "src/config/umbraco-target.generated.ts";

/** A spec that reports what every real Umbraco reports: no usable version. */
const LATEST_SPEC = {
  openapi: "3.0.4",
  info: { title: "Umbraco Management API", version: "Latest" },
  paths: {
    "/umbraco/management/api/v1/culture": {
      get: {
        operationId: "getCulture",
        responses: { "200": { description: "OK" } },
      },
    },
  },
};

/**
 * Environment for the orval child process. Credentials are configurable only
 * via these three variables — there is no options-object equivalent — so the
 * test drives exactly the path a real `npm run generate` does. Omitting the
 * base URL is how a project opts out of the lookup.
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
 * Writes a throwaway project (spec + orval config) and runs orval in it.
 * Returns orval's combined output plus the generated constant, if any.
 */
async function runOrval(options: {
  instanceBaseUrl?: string;
}): Promise<{ ok: boolean; output: string; generated: string | null }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "target-major-orval-"));

  try {
    fs.writeFileSync(
      path.join(dir, "spec.json"),
      JSON.stringify(LATEST_SPEC, null, 2)
    );

    fs.writeFileSync(
      path.join(dir, "orval.config.mjs"),
      `import { createUmbracoTargetMajorTransformer, relaxUntypedArrays } from ${JSON.stringify(SDK_DIST)};

const stamp = createUmbracoTargetMajorTransformer({
  outputPath: "./${GENERATED_PATH}",
});

export default {
  api: {
    input: {
      target: "./spec.json",
      unsafeDisableValidation: true,
      override: { transformer: (spec) => stamp(relaxUntypedArrays(spec)) },
    },
    output: { target: "./src/generated.ts", client: "axios", mode: "single", clean: false },
  },
};
`
    );

    let ok = true;
    let output = "";
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [ORVAL_BIN, "--config", "./orval.config.mjs"],
        { cwd: dir, env: childEnv(options.instanceBaseUrl) }
      );
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

describe("Target major generation (real orval)", () => {
  beforeAll(() => {
    if (!fs.existsSync(SDK_DIST)) {
      throw new Error(
        `SDK not built. Run \`npm run build\` first. Looked for ${SDK_DIST}`
      );
    }
    if (!fs.existsSync(ORVAL_BIN)) {
      throw new Error(`orval not installed. Looked for ${ORVAL_BIN}`);
    }
  });

  it("resolves the major from the instance when the spec says 'Latest'", async () => {
    // The case that used to freeze the constant forever: a real Umbraco spec.
    await withMockUmbracoServer("18.0.2", async (instanceBaseUrl) => {
      const { ok, generated } = await runOrval({ instanceBaseUrl });

      expect(ok).toBe(true);
      // Proves orval awaited the async transformer — without that, generated is
      // null because orval finishes before the lookup resolves.
      expect(generated).toContain('export const UMBRACO_TARGET_MAJOR = "18";');
      expect(generated).toContain("18.0.2");
      expect(generated).toContain("server/information");
    });
  }, 120_000);

  it("fails generation rather than emitting a guessed major", async () => {
    // No instance, no usable info.version, no explicit major: the build must
    // stop. Warning-and-continuing here is what reintroduced #220.
    const { ok, output, generated } = await runOrval({});

    expect(ok).toBe(false);
    expect(output).toContain("Cannot determine the target Umbraco major");
    expect(generated).toBeNull();
  }, 120_000);

});
