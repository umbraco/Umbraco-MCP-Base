import * as fs from "node:fs";
import * as path from "node:path";

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Convert an API name like "forms-management" to a camelCase identifier like "formsManagement".
 */
function toCamelCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part, i) =>
      i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    )
    .join("");
}

/**
 * Configure orval.config.ts with the selected API.
 * Replaces the template "exampleApi" placeholders with the actual API name and URL.
 */
export function configureOpenApi(projectDir: string, url: string, apiName?: string): boolean {
  if (!isValidUrl(url)) {
    throw new Error(`Invalid URL format: ${url}`);
  }

  const orvalConfigPath = path.join(projectDir, "orval.config.ts");

  if (!fs.existsSync(orvalConfigPath)) {
    throw new Error(`orval.config.ts not found at ${orvalConfigPath}`);
  }

  let content = fs.readFileSync(orvalConfigPath, "utf-8");
  const original = content;

  // Derive names from the API (e.g., "forms-management" → "formsManagement")
  const camelName = apiName ? toCamelCase(apiName) : undefined;

  // Replace input targets (both the complex and simple patterns)
  content = content.replace(
    /(input:\s*\{[^}]*?target:\s*)["']([^"']+)["']/g,
    `$1"${url}"`
  );

  if (content === original) {
    content = content.replace(
      /target:\s*["']\.\/src\/umbraco-api\/api\/openapi\.yaml["']/g,
      `target: "${url}"`
    );
  }

  // Rename config keys and output filenames from "exampleApi" to the real API name
  if (camelName && camelName !== "exampleApi") {
    content = content.replace(/exampleApi/g, camelName);
  }

  if (content !== original) {
    fs.writeFileSync(orvalConfigPath, content);
    return true;
  }

  return false;
}
