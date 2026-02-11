/**
 * Files and directories to exclude when scaffolding a new project.
 * Add patterns here to remove them from the scaffolded output.
 *
 * Supports:
 * - Exact paths: 'src/example.ts'
 * - Directories: 'src/tools/example/' (trailing slash)
 * - Simple globs with * wildcard
 */
export const SCAFFOLD_EXCLUSIONS = [
  // Always excluded (build artifacts, local config)
  "node_modules/",
  "dist/",
  ".env",

  // Add files to remove from scaffolded projects here:
  // 'src/tools/example/',
  // 'src/tools/example-2/',
];

/**
 * Check if a relative path should be excluded based on the exclusion patterns.
 */
export function shouldExclude(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, "/");

  for (const pattern of SCAFFOLD_EXCLUSIONS) {
    // Directory pattern (ends with /)
    if (pattern.endsWith("/")) {
      const dirPattern = pattern.slice(0, -1);
      if (
        normalizedPath === dirPattern ||
        normalizedPath.startsWith(dirPattern + "/")
      ) {
        return true;
      }
    }
    // Simple wildcard pattern
    else if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
      );
      if (regex.test(normalizedPath)) {
        return true;
      }
    }
    // Exact match
    else if (normalizedPath === pattern) {
      return true;
    }
  }

  return false;
}
