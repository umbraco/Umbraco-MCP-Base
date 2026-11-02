/**
 * Node.js Version Check
 *
 * Warns at startup when the server runs on a Node.js release affected by
 * CVE-2026-111497 (out-of-bounds write in the bundled Brotli decoder). Node's
 * built-in fetch decompresses Brotli responses transparently, so a malicious
 * or compromised Umbraco instance, or a network attacker, could reach the
 * decoder. Only a Node.js upgrade fixes it, so this warns rather than blocks.
 *
 * The warning goes to stderr, because stdout carries the MCP stdio protocol.
 */

export const NODE_BROTLI_CVE = "CVE-2026-111497";

/** First patched release per supported line. Keep in sync with engines.node. */
export const FIXED_NODE_VERSIONS: Readonly<Record<number, string>> = {
  22: "22.23.4",
  24: "24.22.1",
  26: "26.12.1",
};

export const SUPPORTED_NODE_RANGE = "^22.23.4 || ^24.22.1 || >=26.12.1";

const LATEST_FIXED_MAJOR = 26;

export type NodeVersionAssessment =
  | { status: "ok"; version: string }
  | { status: "vulnerable"; version: string; minimumFixed: string }
  | { status: "unsupported"; version: string }
  | { status: "unknown"; version: string };

const parse = (version: string): [number, number, number] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const isBefore = (a: [number, number, number], b: [number, number, number]): boolean => {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
};

/**
 * Classifies a Node.js version against CVE-2026-111497.
 * Lines older than 22, and odd (non-LTS, end-of-life) lines 23 and 25, get no fix.
 */
export function assessNodeVersion(version: string): NodeVersionAssessment {
  const parsed = parse(version);
  if (!parsed) return { status: "unknown", version };

  const [major] = parsed;
  const fixed = FIXED_NODE_VERSIONS[major] ?? (major > LATEST_FIXED_MAJOR ? FIXED_NODE_VERSIONS[LATEST_FIXED_MAJOR] : undefined);
  if (!fixed) return { status: "unsupported", version };

  return isBefore(parsed, parse(fixed)!)
    ? { status: "vulnerable", version, minimumFixed: fixed }
    : { status: "ok", version };
}

/** Returns the warning for an assessment, or null when there is nothing to warn about. */
export function formatNodeVersionWarning(assessment: NodeVersionAssessment): string | null {
  const fixedList = `${FIXED_NODE_VERSIONS[22]}, ${FIXED_NODE_VERSIONS[24]} or ${FIXED_NODE_VERSIONS[26]}`;
  switch (assessment.status) {
    case "vulnerable":
      return (
        `[umbraco-mcp] WARNING: Node.js v${assessment.version.replace(/^v/, "")} is affected by ${NODE_BROTLI_CVE} ` +
        "(out-of-bounds write in the bundled Brotli decoder). This server calls the Umbraco Management API with " +
        "Node's built-in fetch, which decompresses Brotli responses, so a malicious or compromised Umbraco instance " +
        `or a network attacker could exploit it. Upgrade Node.js to ${fixedList} (or newer in the same line). ` +
        "Continuing anyway."
      );
    case "unsupported":
      return (
        `[umbraco-mcp] WARNING: Node.js v${assessment.version.replace(/^v/, "")} does not receive security fixes ` +
        `(including ${NODE_BROTLI_CVE}). Upgrade Node.js to ${fixedList} (or newer in the same line). Continuing anyway.`
      );
    default:
      return null;
  }
}

// Cloudflare Workers with nodejs_compat expose a `process` object whose
// versions.node does not describe the runtime, so never assess there.
const isCloudflareWorker = (): boolean =>
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

const currentNodeVersion = (): string | null => {
  if (typeof process === "undefined" || isCloudflareWorker()) return null;
  return process.versions?.node ?? null;
};

let checked = false;

/**
 * Logs a warning to stderr if the current Node.js version is affected by
 * CVE-2026-111497 or no longer supported. Runs once per process, never throws.
 *
 * @returns The warning message, or null when the version is fine or unknown
 */
export function checkNodeVersion(options: { version?: string; log?: (message: string) => void } = {}): string | null {
  if (checked) return null;
  checked = true;

  const version = options.version ?? currentNodeVersion();
  if (!version) return null;

  const message = formatNodeVersionWarning(assessNodeVersion(version));
  if (message) (options.log ?? console.error)(message);
  return message;
}

/** Resets the once-per-process guard. For tests only. */
export function resetNodeVersionCheck(): void {
  checked = false;
}
