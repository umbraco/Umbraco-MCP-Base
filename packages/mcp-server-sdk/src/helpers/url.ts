/**
 * Strips trailing slashes from a base URL so it can be safely concatenated with
 * paths that already begin with a leading `/` (such as those produced by the
 * Orval-generated API clients). Returns the URL unchanged when no trailing
 * slashes are present, so callers can pass either form.
 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * True when `url`'s hostname is exactly a loopback host. A substring match is
 * not enough: `https://localhost.example.com` is not local.
 * Keep in sync with create-mcp-server's src/loopback.ts.
 */
export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * TLS certificate verification is left to Node.js (on by default). A local
 * Umbraco with a self-signed certificate needs NODE_TLS_REJECT_UNAUTHORIZED=0;
 * refuse to talk to a non-local site with it set, so the client secret is never
 * sent over an unverified connection. The message also goes to stderr, because
 * stdout carries the MCP stdio protocol.
 */
export function assertTlsNotDisabledForRemote(baseUrl: string): void {
  if (typeof process === "undefined" || process.env?.NODE_TLS_REJECT_UNAUTHORIZED !== "0") return;
  if (isLoopbackUrl(baseUrl)) return;
  const message =
    "[umbraco-mcp] NODE_TLS_REJECT_UNAUTHORIZED=0 is set and the Umbraco base URL is not local, " +
    "so its TLS certificate would not be verified. Refusing to start. Remove NODE_TLS_REJECT_UNAUTHORIZED " +
    "(it is only for a local Umbraco on localhost, 127.0.0.1 or [::1]), or trust the certificate " +
    "with NODE_EXTRA_CA_CERTS instead.";
  console.error(message);
  throw new Error(message);
}
