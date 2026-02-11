#!/usr/bin/env node

/**
 * Build script to copy the template directory into dist/template/
 * This runs after tsup compiles the TypeScript code.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths relative to this script
const packageRoot = path.resolve(__dirname, "..");
const monorepoRoot = path.resolve(packageRoot, "../..");
const templateSrc = path.resolve(monorepoRoot, "template");
const templateDest = path.resolve(packageRoot, "dist/template");

// Directories to always exclude when copying
const EXCLUDED_DIRS = new Set(["node_modules", "dist", ".git"]);

// Files to always exclude
const EXCLUDED_FILES = new Set([".env", ".env.local"]);

/**
 * Copy a directory recursively, excluding certain paths.
 */
function copyDirectory(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`Error: Template source directory not found: ${src}`);
    process.exit(1);
  }

  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      copyDirectory(srcPath, destPath);
    } else {
      if (EXCLUDED_FILES.has(entry.name)) {
        continue;
      }
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log("Copying template to dist/template/...");

// Remove existing template directory if it exists
if (fs.existsSync(templateDest)) {
  fs.rmSync(templateDest, { recursive: true });
}

copyDirectory(templateSrc, templateDest);

console.log("Template copied successfully.");
