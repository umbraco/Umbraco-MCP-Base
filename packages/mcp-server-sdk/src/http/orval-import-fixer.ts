/**
 * Orval Import Fixer
 *
 * Fixes ESM import paths in Orval-generated files.
 * Orval generates imports without .js extensions which breaks ESM resolution.
 *
 * @example
 * ```typescript
 * // In orval.config.ts
 * import { orvalImportFixer } from "@umbraco-cms/mcp-server-sdk";
 *
 * export default defineConfig({
 *   "my-api": {
 *     // ... input/output config
 *     hooks: {
 *       afterAllFilesWrite: orvalImportFixer
 *     }
 *   }
 * });
 * ```
 */

import fs from "fs";
import path from "path";

/**
 * Fixes imports in a directory of schema files.
 * Adds .js extension to relative imports.
 */
function fixSchemaDirectory(dir: string): void {
  const schemaFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));

  schemaFiles.forEach((schemaFile) => {
    const schemaFilePath = path.join(dir, schemaFile);
    const content = fs
      .readFileSync(schemaFilePath, "utf8")
      .replace(/from\s+['"](\.\/.*?)(?<!\.ts)['"]/g, (match, p1) => {
        const resolvedPath = path.resolve(
          path.dirname(schemaFilePath),
          p1 + ".ts"
        );
        if (fs.existsSync(resolvedPath)) {
          return `from '${p1}.js'`;
        }
        return match;
      });

    fs.writeFileSync(schemaFilePath, content, "utf8");
  });
}

/**
 * Fixes imports in an API file.
 * Updates schema imports to include index.js.
 */
function fixApiFile(file: string): void {
  const content = fs.readFileSync(file, "utf8");

  const fixedContent = content.replace(
    /from\s+['"](\.\.\/schemas)['"]/g,
    "from '$1/index.js'"
  );

  fs.writeFileSync(file, fixedContent, "utf8");
}

/**
 * Orval hook to fix ESM imports in generated files.
 *
 * Use this as the `afterAllFilesWrite` hook in your Orval config.
 *
 * @param files - Array of file paths from Orval
 */
export function orvalImportFixer(files: string[]): void {
  files.forEach((file) => {
    if (fs.lstatSync(file).isDirectory()) {
      fixSchemaDirectory(file);
    } else {
      fixApiFile(file);
    }
  });
}
