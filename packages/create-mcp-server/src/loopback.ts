const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * True when `url`'s hostname is exactly a loopback host (`localhost`,
 * `127.0.0.1` or `[::1]`). A substring match is not enough:
 * `https://localhost.example.com` is not local.
 */
export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}
