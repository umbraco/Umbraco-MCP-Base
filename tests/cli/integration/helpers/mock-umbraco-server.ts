/**
 * Minimal stand-in for the two Management API endpoints anything version-aware
 * needs: the OAuth client_credentials token endpoint and `server/information`.
 *
 * Shared because two suites need the same fake — the CLI version-check tests and
 * the target-major generation tests. Both bypass the `USE_MOCK_API` example-tool
 * mock store (as the real get-server-info tool does), so they need a real socket
 * rather than MSW.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const TOKEN_PATH = "/umbraco/management/api/v1/security/back-office/token";
const SERVER_INFORMATION_PATH =
  "/umbraco/management/api/v1/server/information";

export interface MockUmbracoServer {
  server: Server;
  /** `http://127.0.0.1:<port>` — an ephemeral port, so suites never collide. */
  baseUrl: string;
  /** Idempotent; safe to call from `afterAll` and from a `finally`. */
  close(): Promise<void>;
}

/**
 * Starts the stub on an ephemeral port.
 *
 * @param version - What `server/information` reports. Pass `null` to reply with
 *   a body that has no `version` field at all — a reachable instance that still
 *   cannot answer the question.
 */
export function startMockUmbracoServer(
  version: string | null
): Promise<MockUmbracoServer> {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url === TOKEN_PATH) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
        return;
      }
      if (req.method === "GET" && req.url === SERVER_INFORMATION_PATH) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            version === null ? {} : { version, assemblyVersion: version }
          )
        );
        return;
      }
      res.writeHead(404).end();
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            if (!server.listening) return done();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * Runs `body` against a freshly started stub and always closes it afterwards.
 * Saves each caller repeating the `try`/`finally` close dance.
 */
export async function withMockUmbracoServer<T>(
  version: string | null,
  body: (baseUrl: string) => Promise<T>
): Promise<T> {
  const mock = await startMockUmbracoServer(version);
  try {
    return await body(mock.baseUrl);
  } finally {
    await mock.close();
  }
}
