/**
 * Lightweight in-memory filesystem mock for testing.
 *
 * Usage with jest.unstable_mockModule:
 *   const mockFs = createMockFs({ "/project/package.json": '{"name":"test"}' });
 *   jest.unstable_mockModule("node:fs", () => mockFs.module);
 */

import * as path from "node:path";

export interface MockFs {
  /** The mock module to pass to jest.unstable_mockModule */
  module: Record<string, unknown>;
  /** Files written during test execution (path → content) */
  writtenFiles: Map<string, string>;
  /** Files deleted during test execution */
  deletedPaths: Set<string>;
  /** Current state of the in-memory filesystem */
  files: Map<string, string>;
  /** Reset to initial state */
  reset: () => void;
}

export function createMockFs(initialFiles: Record<string, string>): MockFs {
  let files = new Map(Object.entries(initialFiles));
  const writtenFiles = new Map<string, string>();
  const deletedPaths = new Set<string>();

  function reset() {
    files.clear();
    for (const [k, v] of Object.entries(initialFiles)) {
      files.set(k, v);
    }
    writtenFiles.clear();
    deletedPaths.clear();
  }

  function normalizePath(p: string): string {
    return path.resolve(p);
  }

  function isDirectory(p: string): boolean {
    const norm = normalizePath(p);
    // A path is a directory if any file path starts with it + "/"
    for (const key of files.keys()) {
      if (key.startsWith(norm + "/")) return true;
    }
    return false;
  }

  function existsSync(p: string): boolean {
    const norm = normalizePath(p);
    return files.has(norm) || isDirectory(norm);
  }

  function readFileSync(p: string, encoding?: string): string {
    const norm = normalizePath(p);
    const content = files.get(norm);
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    return content;
  }

  function writeFileSync(p: string, content: string): void {
    const norm = normalizePath(p);
    files.set(norm, content);
    writtenFiles.set(norm, content);
  }

  function mkdirSync(p: string, _options?: { recursive?: boolean }): void {
    // No-op in mock — directories are implicit
  }

  function rmSync(p: string, options?: { recursive?: boolean; force?: boolean }): void {
    const norm = normalizePath(p);
    if (files.has(norm)) {
      files.delete(norm);
      deletedPaths.add(norm);
      return;
    }
    if (options?.recursive) {
      const prefix = norm + "/";
      for (const key of [...files.keys()]) {
        if (key.startsWith(prefix) || key === norm) {
          files.delete(key);
          deletedPaths.add(key);
        }
      }
      return;
    }
    if (!options?.force) {
      const err = new Error(`ENOENT: no such file or directory '${p}'`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
  }

  function unlinkSync(p: string): void {
    const norm = normalizePath(p);
    if (!files.has(norm)) {
      const err = new Error(`ENOENT: no such file or directory '${p}'`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    files.delete(norm);
    deletedPaths.add(norm);
  }

  function rmdirSync(p: string): void {
    const norm = normalizePath(p);
    // Check if directory is empty
    const prefix = norm + "/";
    for (const key of files.keys()) {
      if (key.startsWith(prefix)) {
        throw new Error(`ENOTEMPTY: directory not empty '${p}'`);
      }
    }
    deletedPaths.add(norm);
  }

  function readdirSync(p: string, options?: { withFileTypes?: boolean }): unknown[] {
    const norm = normalizePath(p);
    const prefix = norm + "/";
    const entries = new Map<string, boolean>(); // name → isDirectory

    for (const key of files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const firstSegment = rest.split("/")[0];
      const isDir = rest.includes("/");
      // If we've already seen this name as a directory, keep it as directory
      if (entries.has(firstSegment) && entries.get(firstSegment)) continue;
      entries.set(firstSegment, isDir);
    }

    if (options?.withFileTypes) {
      return [...entries.entries()].map(([name, isDir]) => ({
        name,
        isFile: () => !isDir,
        isDirectory: () => isDir,
      }));
    }

    return [...entries.keys()];
  }

  function statSync(p: string): { isDirectory: () => boolean; isFile: () => boolean } {
    const norm = normalizePath(p);
    if (files.has(norm)) {
      return { isDirectory: () => false, isFile: () => true };
    }
    if (isDirectory(norm)) {
      return { isDirectory: () => true, isFile: () => false };
    }
    const err = new Error(`ENOENT: no such file or directory '${p}'`) as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  }

  function copyFileSync(src: string, dest: string): void {
    const content = readFileSync(src);
    writeFileSync(dest, content);
  }

  const mod = {
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
    rmSync,
    unlinkSync,
    rmdirSync,
    readdirSync,
    statSync,
    copyFileSync,
    default: {
      existsSync,
      readFileSync,
      writeFileSync,
      mkdirSync,
      rmSync,
      unlinkSync,
      rmdirSync,
      readdirSync,
      statSync,
      copyFileSync,
    },
  };

  return { module: mod, writtenFiles, deletedPaths, files, reset };
}
