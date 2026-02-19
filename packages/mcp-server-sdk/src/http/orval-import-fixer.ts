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
 * Adds .js extensions to relative imports (required for ESM).
 * Handles both single-file and multi-file Orval output modes.
 */
function fixApiFile(file: string): void {
  let content = fs.readFileSync(file, "utf8");

  // Fix all relative imports that don't have a file extension
  content = content.replace(
    /from\s+['"](\.[^'"]+)['"]/g,
    (match, importPath) => {
      // Skip if already has a recognized file extension
      if (/\.[jt]sx?$|\.json$/.test(importPath)) {
        return match;
      }

      const resolved = path.resolve(path.dirname(file), importPath);

      // If it's a directory, add /index.js
      if (fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory()) {
        return `from '${importPath}/index.js'`;
      }

      // If a .ts file exists, add .js (ESM convention)
      if (fs.existsSync(resolved + ".ts") || fs.existsSync(resolved + ".tsx")) {
        return `from '${importPath}.js'`;
      }

      return match;
    }
  );

  fs.writeFileSync(file, content, "utf8");
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
