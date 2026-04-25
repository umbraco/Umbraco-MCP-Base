/**
 * Strips trailing slashes from a base URL so it can be safely concatenated with
 * paths that already begin with a leading `/` (such as those produced by the
 * Orval-generated API clients). Returns the URL unchanged when no trailing
 * slashes are present, so callers can pass either form.
 */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
