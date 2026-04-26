#!/usr/bin/env node
/**
 * Postpack hook: restore package.json from the backup that rewrite-file-deps.mjs
 * left behind. Pairs with prepack so source is untouched after publish completes.
 *
 * If no backup exists, prepack didn't rewrite anything (no file: deps) — exit
 * cleanly without complaining.
 */
import { existsSync, copyFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const pkgPath = resolve(cwd, "package.json");
const backupPath = resolve(cwd, ".package.json.bak");

if (!existsSync(backupPath)) {
  // Nothing to restore — prepack saw no file: deps to rewrite.
  process.exit(0);
}

copyFileSync(backupPath, pkgPath);
unlinkSync(backupPath);
console.log(`[restore-package-json] Restored ${pkgPath} from backup.`);
