/**
 * CLI Version Check Integration Tests
 *
 * The SDK-side check is **opt-in**: `checkUmbracoVersion` only compares when
 * an `expectedUmbracoMajor` is supplied. The template wires this from
 * `serverConfig.custom.expectedUmbracoMajor ?? UMBRACO_TARGET_MAJOR`
 * (`template/src/config/umbraco-target.ts`), so a fresh scaffold's *default*
 * target is `UMBRACO_TARGET_MAJOR`, not "no check at all". `UMBRACO_EXPECTED_MAJOR`
 * / `--umbraco-expected-major` (`template/src/config/server-config.ts`)
 * overrides that default for a project that deliberately targets a different
 * Umbraco major.
 *
 * History:
 *  - umbraco/Umbraco-MCP-Base#201 / #212: `checkUmbracoVersion` computed a
 *    mismatch result but nothing ever surfaced it — the message sat in a
 *    singleton nobody read, and `withPreExecutionCheck` was never wired up.
 *  - umbraco/Umbraco-MCP-Base#220: the comparison used the MCP server's *own*
 *    package version, which is `1.0.0` in every freshly scaffolded project and
 *    unrelated to the Umbraco major it targets. Every new server therefore had
 *    its first tool call falsely blocked. The comparison is now against an
 *    explicit target major.
 *  - umbraco/Umbraco-MCP-Base#221 review: making the SDK check opt-in-and-off
 *    by default shipped the feature dark for every scaffold. The template now
 *    defaults `expectedUmbracoMajor` to `UMBRACO_TARGET_MAJOR` (kept in sync
 *    with `tests/umbraco-instance/TestUmbraco.csproj` — see
 *    `template/src/config/__tests__/umbraco-target.test.ts`), so the check
 *    runs out of the box against the Umbraco major this repo actually targets.
 *
 * These tests boot the *built* template binary (dist/index.js) against a tiny
 * local HTTP server standing in for Umbraco's OAuth token + server
 * information endpoints, and assert:
 *   1. no override, connected Umbraco matches `UMBRACO_TARGET_MAJOR` →
 *      complete silence, tools work (the #220 fix, still true with a real
 *      default target instead of no check)
 *   2. no override, connected Umbraco differs from `UMBRACO_TARGET_MAJOR` →
 *      the template default alone is enough to warn and block (the #221
 *      review fix — this is the case that was silently broken before it)
 *   3. explicit override + mismatch → warning reaches stderr, the MCP
 *      `initialize` response's `instructions`, and the first tool call
 *      (configureVersionCheckHook → withPreExecutionCheck), with a deliberate
 *      retry then succeeding
 *   4. explicit override + match → silence, tools work
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createCliTestClient, type CliTestClient } from "../helpers/cli-client.js";

/**
 * Minimal stand-in for Umbraco's Management API: serves the OAuth
 * client_credentials token endpoint and the server information endpoint that
 * the template's version-check wiring calls directly (bypassing the
 * USE_MOCK_API example-tool mock store, same as the real get-server-info tool).
 */
function startMockUmbracoServer(version: string): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/umbraco/management/api/v1/security/back-office/token") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
        return;
      }
      if (req.method === "GET" && req.url === "/umbraco/management/api/v1/server/information") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version, assemblyVersion: version }));
        return;
      }
      res.writeHead(404).end();
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe("Version Check (CLI)", () => {
  // Regression proof for #220: a scaffolded server (package version "1.0.0")
  // pointed at a real Umbraco must not be treated as a version mismatch.
  // No explicit override here — the template's UMBRACO_TARGET_MAJOR ("17")
  // applies, and the mock happens to match it, so this stays silent same as
  // before #221 (where it was silent because no check ran at all).
  describe("no override, connected Umbraco matches the template default", () => {
    let mockServer: Server;
    let client: CliTestClient;

    beforeAll(async () => {
      const mock = await startMockUmbracoServer("17.0.0");
      mockServer = mock.server;
      client = await createCliTestClient({
        captureStderr: true,
        // Deliberately no UMBRACO_EXPECTED_MAJOR — the default for a scaffold.
        env: { UMBRACO_BASE_URL: mock.baseUrl },
      });
    });

    afterAll(async () => {
      await client?.close();
      await new Promise<void>((r) => mockServer.close(() => r()));
    });

    it("stays silent: no warning on stderr, no instructions, first tool call succeeds", async () => {
      expect(client.getStderr()).not.toContain("Version Mismatch");
      expect(client.getInstructions() ?? "").not.toContain("Version Mismatch");

      const result = await client.callTool("list-examples", {});
      expect(result.isError).toBeFalsy();
    });
  });

  // #221 review: the SDK check is agnostic, but the template must default it
  // to a real target major (UMBRACO_TARGET_MAJOR = "17") so mismatches are
  // caught without the user ever discovering UMBRACO_EXPECTED_MAJOR exists.
  describe("no override, connected Umbraco differs from the template default", () => {
    let mockServer: Server;
    let client: CliTestClient;

    beforeAll(async () => {
      const mock = await startMockUmbracoServer("16.0.0");
      mockServer = mock.server;
      client = await createCliTestClient({
        captureStderr: true,
        // Deliberately no UMBRACO_EXPECTED_MAJOR: the template default ("17")
        // must be enough on its own to catch this mismatch.
        env: { UMBRACO_BASE_URL: mock.baseUrl },
      });
    });

    afterAll(async () => {
      await client?.close();
      await new Promise<void>((r) => mockServer.close(() => r()));
    });

    it("warns and blocks the first tool call using the template default target", async () => {
      expect(client.getStderr()).toContain("⚠️ Version Mismatch");
      expect(client.getInstructions()).toContain("⚠️ Version Mismatch");

      const blocked = await client.callTool("list-examples", {});
      expect(blocked.isError).toBe(true);
      expect(JSON.stringify(blocked.content)).toContain("⚠️ Version Mismatch");
    });
  });

  describe("expected major declared, mismatched", () => {
    let mockServer: Server;
    let client: CliTestClient;

    beforeAll(async () => {
      const mock = await startMockUmbracoServer("16.0.0");
      mockServer = mock.server;
      client = await createCliTestClient({
        captureStderr: true,
        env: { UMBRACO_BASE_URL: mock.baseUrl, UMBRACO_EXPECTED_MAJOR: "17" },
      });
    });

    afterAll(async () => {
      await client?.close();
      await new Promise<void>((r) => mockServer.close(() => r()));
    });

    it("logs the mismatch warning to stderr", () => {
      expect(client.getStderr()).toContain("⚠️ Version Mismatch");
    });

    it("surfaces the mismatch warning via server instructions", () => {
      expect(client.getInstructions()).toContain("⚠️ Version Mismatch");
    });

    it("blocks the first tool call, then allows a retry to succeed", async () => {
      // Use a tool with no required arguments so we're exercising the
      // pre-execution hook, not MCP's own input-schema validation.
      const toolName = "list-examples";

      const blocked = await client.callTool(toolName, {});
      expect(blocked.isError).toBe(true);
      const blockedText = JSON.stringify(blocked.content);
      expect(blockedText).toContain("⚠️ Version Mismatch");
      expect(blockedText).toContain("retry");

      // Deliberate retry after seeing the warning: should execute normally
      // (list-examples goes through the USE_MOCK_API mock store, so this
      // exercises the full success path, not just "not blocked").
      const retried = await client.callTool(toolName, {});
      expect(retried.isError).toBeFalsy();
    });
  });

  describe("expected major declared, matching", () => {
    let mockServer: Server;
    let client: CliTestClient;

    beforeAll(async () => {
      const mock = await startMockUmbracoServer("17.0.0");
      mockServer = mock.server;
      client = await createCliTestClient({
        captureStderr: true,
        env: { UMBRACO_BASE_URL: mock.baseUrl, UMBRACO_EXPECTED_MAJOR: "17" },
      });
    });

    afterAll(async () => {
      await client?.close();
      await new Promise<void>((r) => mockServer.close(() => r()));
    });

    it("stays silent: no warning on stderr, no instructions, first tool call succeeds", async () => {
      expect(client.getStderr()).not.toContain("Version Mismatch");
      expect(client.getInstructions() ?? "").not.toContain("Version Mismatch");

      const result = await client.callTool("list-examples", {});
      expect(result.isError).toBeFalsy();
    });
  });
});
