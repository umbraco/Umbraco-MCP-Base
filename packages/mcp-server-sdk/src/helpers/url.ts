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
