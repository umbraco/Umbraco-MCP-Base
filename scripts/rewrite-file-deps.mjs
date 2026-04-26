#!/usr/bin/env node
/**
 * Prepack hook: rewrite `file:../<sibling>` deps in a workspace package's
 * package.json to the sibling's actual version, just before npm pack/publish
 * generates the tarball. Pairs with restore-package-json.mjs (postpack) to
 * leave the source untouched after publish completes.
 *
 * Background: this monorepo declares cross-package deps with `file:` for
 * workspace-friendly local dev. npm doesn't rewrite `file:` on publish, so
 * tarballs ship the literal path, breaking consumers (a `file:` dep on the
 * consumer's filesystem is meaningless and corrupts npm's resolver state).
 *
 * Run from a workspace package's directory (npm sets cwd for lifecycle scripts).
 * Backs up the original package.json to .package.json.bak so postpack can
 * restore it. If the backup already exists (e.g. previous run crashed), refuses
 * to run — fix the previous state first.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

const cwd = process.cwd();
const pkgPath = resolve(cwd, "package.json");
const backupPath = resolve(cwd, ".package.json.bak");

if (existsSync(backupPath)) {
  console.error(
    `[rewrite-file-deps] Refusing to run: ${backupPath} already exists.\n` +
      `A previous prepack likely failed to clean up. Inspect, restore, and delete the backup before retrying.`,
  );
  process.exit(1);
}

const original = readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(original);

let rewroteAny = false;
const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

for (const field of depFields) {
  const deps = pkg[field];
  if (!deps) continue;
  for (const [name, value] of Object.entries(deps)) {
    if (typeof value !== "string" || !value.startsWith("file:")) continue;
    const siblingRel = value.slice("file:".length);
    const siblingPkgPath = resolve(cwd, siblingRel, "package.json");
    if (!existsSync(siblingPkgPath)) {
      throw new Error(
        `[rewrite-file-deps] ${field}.${name} = "${value}", but ${siblingPkgPath} does not exist.`,
      );
    }
    const siblingPkg = JSON.parse(readFileSync(siblingPkgPath, "utf8"));
    if (typeof siblingPkg.version !== "string") {
      throw new Error(
        `[rewrite-file-deps] ${siblingPkgPath} has no string "version" field.`,
      );
    }
    deps[name] = siblingPkg.version;
    console.log(
      `[rewrite-file-deps] ${field}.${name}: ${value} -> ${siblingPkg.version}`,
    );
    rewroteAny = true;
  }
}

if (!rewroteAny) {
  console.log("[rewrite-file-deps] No file: deps to rewrite, skipping.");
  process.exit(0);
}

// Save original (for postpack restore) and write rewritten package.json.
copyFileSync(pkgPath, backupPath);
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`[rewrite-file-deps] Wrote rewritten ${pkgPath} (backup at ${backupPath})`);
