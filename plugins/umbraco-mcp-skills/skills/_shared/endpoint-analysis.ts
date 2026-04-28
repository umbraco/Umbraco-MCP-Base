/**
 * Shared endpoint discovery and mapping functions for MCP tool analysis scripts.
 *
 * Provides utilities to:
 * - Load .discover.json manifests
 * - Discover generated API client files
 * - Extract API endpoint names from generated code
 * - Map MCP tools to their corresponding API endpoints
 * - Match endpoints to collections by name
 */

import * as fs from 'fs';
import * as path from 'path';
import glob from 'glob';

export interface DiscoverManifest {
  apiName: string;
  swaggerUrl: string;
  baseUrl: string;
  collections: string[];
}

export interface ApiFileInfo {
  fileName: string;
  filePath: string;
  endpointCount: number;
}

export interface ToolToEndpointMap {
  [endpoint: string]: string;
}

export interface CollectionToken {
  name: string;
  token: string;
}

/**
 * Load .discover.json manifest if it exists.
 */
export function loadDiscoverManifest(projectRoot: string): DiscoverManifest | null {
  const manifestPath = path.join(projectRoot, '.discover.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content) as DiscoverManifest;
  } catch {
    console.warn('Warning: Could not parse .discover.json');
    return null;
  }
}

/**
 * Discover all generated API client files in the project.
 */
export function discoverApiFiles(projectRoot: string, apiGeneratedDir: string): string[] {
  const resolvedDir = path.resolve(projectRoot, apiGeneratedDir);
  const files = glob.sync('*.ts', {
    cwd: resolvedDir,
    absolute: true,
    ignore: ['*.zod.ts', 'exampleApi.ts']
  });
  return files.sort();
}

/**
 * Extract all API endpoint function names from a single API client file.
 */
export function extractApiEndpointsFromFile(apiFilePath: string): string[] {
  const content = fs.readFileSync(apiFilePath, 'utf-8');
  const endpoints: string[] = [];

  // Find all Result type exports which correspond to API endpoints
  // Pattern: export type GetXxxResult = ... (covers Get, Post, Put, Delete, Create, Update, Search, Patch)
  const pattern = /export type ((?:Get|Post|Put|Delete|Create|Update|Search|Patch)[A-Z][a-zA-Z0-9]*)Result/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    // Convert from PascalCase to the actual endpoint name
    // GetUserById -> getUserById
    const endpoint = match[1][0].toLowerCase() + match[1].slice(1);
    endpoints.push(endpoint);
  }

  return endpoints;
}

/**
 * Extract all API endpoints from multiple API client files, deduplicating by name.
 */
export function extractApiEndpoints(apiFilePaths: string[]): { endpoints: string[]; fileInfos: ApiFileInfo[] } {
  const allEndpoints = new Set<string>();
  const fileInfos: ApiFileInfo[] = [];

  for (const filePath of apiFilePaths) {
    const endpoints = extractApiEndpointsFromFile(filePath);
    const fileName = path.basename(filePath);
    fileInfos.push({ fileName, filePath, endpointCount: endpoints.length });

    for (const endpoint of endpoints) {
      allEndpoints.add(endpoint);
    }
  }

  return {
    endpoints: Array.from(allEndpoints).sort(),
    fileInfos
  };
}

/**
 * Map MCP tools to their corresponding API endpoints.
 */
export function mapToolsToEndpoints(toolsDir: string): ToolToEndpointMap {
  const mapping: ToolToEndpointMap = {};

  // Find all TypeScript files in the tools directory
  const tsFiles = glob.sync('**/*.ts', {
    cwd: toolsDir,
    absolute: true,
    ignore: ['**/index.ts', '**/__tests__/**']
  });

  for (const tsFile of tsFiles) {
    const content = fs.readFileSync(tsFile, 'utf-8');

    // Look for API client method calls
    // Pattern: client.getXxx, client.postXxx, client.createXxx, etc.
    const apiCallPattern = /client\.((?:get|post|put|delete|create|update|search|patch)[A-Z][a-zA-Z0-9]*)/g;
    let match: RegExpExecArray | null;

    while ((match = apiCallPattern.exec(content)) !== null) {
      const endpoint = match[1];
      mapping[endpoint] = path.basename(tsFile, '.ts');
    }
  }

  return mapping;
}

/**
 * Build collection tokens sorted longest-first for matching.
 * Each token is the collection name with hyphens removed, lowercased.
 */
export function buildCollectionTokens(collections: string[]): CollectionToken[] {
  const sorted = [...collections].sort((a, b) => b.length - a.length);
  return sorted.map(name => ({
    name,
    token: name.replace(/-/g, '').toLowerCase()
  }));
}

/**
 * Split a camelCase identifier into lowercase segments.
 * e.g. "getFormById" → ["get", "form", "by", "id"]
 *      "getPerformAction" → ["get", "perform", "action"]
 */
function splitCamelCase(str: string): string[] {
  return str
    .replace(/([a-z0-9])([A-Z])/g, '$1\0$2')
    .toLowerCase()
    .split('\0');
}

/**
 * Match an endpoint name to a collection using camelCase-aware matching.
 * Checks if a contiguous sequence of camelCase segments forms the collection token.
 * This prevents false positives like "perform" matching "form".
 *
 * @param endpoint - Original camelCase endpoint name (e.g. "getFormById")
 * @param collectionTokens - Sorted longest-first from buildCollectionTokens()
 * @returns The collection name or null if no match.
 */
export function matchEndpointToCollection(
  endpoint: string,
  collectionTokens: CollectionToken[]
): string | null {
  const segments = splitCamelCase(endpoint);

  for (const { name, token } of collectionTokens) {
    for (let i = 0; i < segments.length; i++) {
      let joined = '';
      for (let j = i; j < segments.length; j++) {
        joined += segments[j];
        if (joined === token) {
          return name;
        }
        if (joined.length >= token.length) {
          break;
        }
      }
    }
  }
  return null;
}
