#!/usr/bin/env npx tsx
/**
 * Count MCP tools in an Umbraco MCP Server SDK project.
 *
 * This script counts all TypeScript tool files that define actual MCP tools
 * (containing ToolDefinition and withStandardDecorators) and provides a
 * breakdown by collection. When a .discover.json manifest exists, it also
 * performs gap analysis showing which collections have tools, tests, and evals.
 */

import * as fs from 'fs';
import * as path from 'path';
import glob from 'glob';
import {
  type DiscoverManifest,
  loadDiscoverManifest,
  discoverApiFiles,
  extractApiEndpoints,
  mapToolsToEndpoints,
  buildCollectionTokens,
  matchEndpointToCollection,
} from '../../_shared/endpoint-analysis.js';

interface ToolInfo {
  name: string;
  filePath: string;
}

interface CollectionCount {
  name: string;
  count: number;
  tools: ToolInfo[];
}

interface GapEntry {
  collection: string;
  toolCount: number;
  endpointsCovered: number;
  endpointsTotal: number;
  hasTests: boolean;
  hasEvals: boolean;
  status: string;
}

/**
 * Extract the tool name from a file's content.
 * Looks for name: "tool-name" on its own line (not inside comments).
 */
function extractToolName(content: string, filePath: string): string | null {
  // Match name: "xxx" on its own line, not inside JSDoc comments (which have * prefix)
  const toolMatch = content.match(/^\s+name:\s*["']([^"']+)["']/m);
  if (toolMatch) {
    return toolMatch[1];
  }

  // Fallback to filename without extension
  return path.basename(filePath, '.ts');
}

/**
 * Count tools in each collection directory.
 */
function countTools(toolsDirPath: string): { collections: CollectionCount[]; total: number; allTools: ToolInfo[] } {
  const toolsDir = path.resolve(toolsDirPath);
  let total = 0;
  const collections: CollectionCount[] = [];
  const allTools: ToolInfo[] = [];

  // Get all subdirectories
  const entries = fs.readdirSync(toolsDir, { withFileTypes: true });
  const directories = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  for (const dirName of directories) {
    const collectionDir = path.join(toolsDir, dirName);

    // Find all TypeScript files in this collection
    const tsFiles: string[] = glob.sync('**/*.ts', {
      cwd: collectionDir,
      absolute: true,
      ignore: ['**/index.ts', '**/__tests__/**']
    });

    // Only count files that define actual MCP tools (ToolDefinition + withStandardDecorators)
    const tools: ToolInfo[] = [];
    for (const tsFile of tsFiles) {
      const content = fs.readFileSync(tsFile, 'utf-8');
      if (content.includes('withStandardDecorators') && content.includes('ToolDefinition')) {
        const toolName = extractToolName(content, tsFile);
        if (toolName) {
          const relativePath = path.relative(toolsDir, tsFile);
          tools.push({ name: toolName, filePath: relativePath });
        }
      }
    }

    // Sort tools alphabetically by name
    tools.sort((a, b) => a.name.localeCompare(b.name));

    collections.push({ name: dirName, count: tools.length, tools });
    allTools.push(...tools);
    total += tools.length;
  }

  return { collections, total, allTools };
}

/**
 * Analyze gaps between expected collections and actual implementation.
 */
function analyzeGaps(
  projectRoot: string,
  manifest: DiscoverManifest,
  collections: CollectionCount[],
  toolsDir: string,
  evalsDir: string,
  apiGeneratedDir: string
): GapEntry[] {
  const collectionMap = new Map(collections.map(c => [c.name, c]));

  // Discover all API endpoints and map tool coverage
  const apiFiles = discoverApiFiles(projectRoot, apiGeneratedDir);
  const { endpoints: allEndpoints } = extractApiEndpoints(apiFiles);
  const toolToEndpointMap = mapToolsToEndpoints(toolsDir);
  const implementedEndpoints = new Set(Object.keys(toolToEndpointMap));

  // Build collection tokens for matching endpoints to collections
  const collectionTokens = buildCollectionTokens(manifest.collections);

  // Count endpoints per collection (total and covered)
  const endpointTotals = new Map<string, number>();
  const endpointCovered = new Map<string, number>();

  for (const collectionName of manifest.collections) {
    endpointTotals.set(collectionName, 0);
    endpointCovered.set(collectionName, 0);
  }

  for (const endpoint of allEndpoints) {
    const matched = matchEndpointToCollection(endpoint, collectionTokens);
    if (matched) {
      endpointTotals.set(matched, (endpointTotals.get(matched) ?? 0) + 1);
      if (implementedEndpoints.has(endpoint)) {
        endpointCovered.set(matched, (endpointCovered.get(matched) ?? 0) + 1);
      }
    }
  }

  return manifest.collections.map(collectionName => {
    const collection = collectionMap.get(collectionName);
    const toolCount = collection?.count ?? 0;

    // Check for integration tests
    const testGlob = path.join(toolsDir, collectionName, '__tests__', '*.test.ts');
    const testFiles: string[] = glob.sync(testGlob);
    const hasTests = testFiles.length > 0;

    // Check for eval tests
    const evalGlob = path.join(evalsDir, `*${collectionName}*.test.ts`);
    const evalFiles: string[] = glob.sync(evalGlob);
    const hasEvals = evalFiles.length > 0;

    // Determine status
    let status: string;
    if (toolCount === 0) {
      status = 'Not started';
    } else if (!hasTests && !hasEvals) {
      status = 'Missing tests & evals';
    } else if (!hasTests) {
      status = 'Missing tests';
    } else if (!hasEvals) {
      status = 'Missing evals';
    } else {
      status = 'Complete';
    }

    return {
      collection: collectionName,
      toolCount,
      endpointsCovered: endpointCovered.get(collectionName) ?? 0,
      endpointsTotal: endpointTotals.get(collectionName) ?? 0,
      hasTests,
      hasEvals,
      status
    };
  });
}

/**
 * Format gap analysis as console output.
 */
function formatGapConsoleOutput(gaps: GapEntry[], undeclaredCollections: CollectionCount[]): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('Gap Analysis (.discover.json):');
  lines.push('='.repeat(80));

  // Header
  const colW = 20;
  const header = `${'Collection'.padEnd(colW)} | Tools | Endpoints | Tests | Evals | Status`;
  lines.push(header);
  lines.push('-'.repeat(80));

  for (const gap of gaps) {
    const col = gap.collection.padEnd(colW);
    const tools = gap.toolCount.toString().padStart(5);
    const endpoints = `${gap.endpointsCovered}/${gap.endpointsTotal}`.padStart(9);
    const tests = (gap.hasTests ? 'yes' : 'no').padStart(5);
    const evals = (gap.hasEvals ? 'yes' : 'no').padStart(5);
    lines.push(`${col} | ${tools} | ${endpoints} | ${tests} | ${evals} | ${gap.status}`);
  }

  lines.push('='.repeat(80));

  const complete = gaps.filter(g => g.status === 'Complete').length;
  const totalCovered = gaps.reduce((sum, g) => sum + g.endpointsCovered, 0);
  const totalEndpoints = gaps.reduce((sum, g) => sum + g.endpointsTotal, 0);
  const pct = totalEndpoints > 0 ? Math.round(totalCovered / totalEndpoints * 100) : 0;
  lines.push(`${complete}/${gaps.length} collections complete | ${totalCovered}/${totalEndpoints} endpoints covered (${pct}%)`);

  if (undeclaredCollections.length > 0) {
    lines.push('');
    lines.push('Missing from .discover.json:');
    for (const col of undeclaredCollections) {
      lines.push(`  - ${col.name} (${col.count} tools)`);
    }
  }

  return lines.join('\n');
}

/**
 * Format gap analysis as markdown.
 */
function formatGapMarkdown(gaps: GapEntry[], undeclaredCollections: CollectionCount[]): string {
  const lines: string[] = [];
  lines.push('## Gap Analysis');
  lines.push('');
  lines.push('Comparison against `.discover.json` manifest:');
  lines.push('');
  lines.push('| Collection | Tools | Endpoints | Tests | Evals | Status |');
  lines.push('|------------|-------|-----------|-------|-------|--------|');

  for (const gap of gaps) {
    const endpoints = `${gap.endpointsCovered}/${gap.endpointsTotal}`;
    const tests = gap.hasTests ? 'yes' : 'no';
    const evals = gap.hasEvals ? 'yes' : 'no';
    lines.push(`| ${gap.collection} | ${gap.toolCount} | ${endpoints} | ${tests} | ${evals} | ${gap.status} |`);
  }

  lines.push('');
  const complete = gaps.filter(g => g.status === 'Complete').length;
  const totalCovered = gaps.reduce((sum, g) => sum + g.endpointsCovered, 0);
  const totalEndpoints = gaps.reduce((sum, g) => sum + g.endpointsTotal, 0);
  const pct = totalEndpoints > 0 ? Math.round(totalCovered / totalEndpoints * 100) : 0;
  lines.push(`**Progress**: ${complete}/${gaps.length} collections complete | ${totalCovered}/${totalEndpoints} endpoints covered (${pct}%)`);

  if (undeclaredCollections.length > 0) {
    lines.push('');
    lines.push('### Missing from .discover.json');
    lines.push('');
    lines.push('These tool directories exist but are not listed in `.discover.json`:');
    lines.push('');
    for (const col of undeclaredCollections) {
      lines.push(`- **${col.name}** (${col.count} tools)`);
    }
  }

  return lines.join('\n');
}

/**
 * Format results as console output.
 */
function formatConsoleOutput(collections: CollectionCount[], total: number, showTools: boolean = false): string {
  const lines: string[] = [];
  lines.push('MCP Tools by Collection:');
  lines.push('='.repeat(60));

  for (const { name, count, tools } of collections) {
    const padding = '.'.repeat(Math.max(1, 50 - name.length));
    lines.push(`${name}${padding}${count.toString().padStart(4)}`);

    if (showTools && tools.length > 0) {
      for (const tool of tools) {
        lines.push(`    - ${tool.name}`);
      }
    }
  }

  lines.push('='.repeat(60));
  const padding = '.'.repeat(Math.max(1, 50 - 'Total tools'.length));
  lines.push(`Total tools${padding}${total.toString().padStart(4)}`);

  return lines.join('\n');
}

/**
 * Format results as markdown.
 */
function formatMarkdownOutput(collections: CollectionCount[], total: number, gapMarkdown?: string): string {
  const lines: string[] = [];
  const now = new Date().toISOString().split('T')[0];

  lines.push('# API Endpoints Analysis');
  lines.push('');
  lines.push(`**Last Updated**: ${now}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Collection | Tool Count |');
  lines.push('|------------|------------|');

  for (const { name, count } of collections) {
    lines.push(`| ${name} | ${count} |`);
  }

  lines.push('');
  lines.push(`**Total MCP Tools**: ${total}`);
  lines.push('');

  // Add detailed tool listing by collection
  lines.push('## Tools by Collection');
  lines.push('');

  for (const { name, count, tools } of collections) {
    if (count > 0) {
      lines.push(`### ${name} (${count})`);
      lines.push('');
      for (const tool of tools) {
        lines.push(`- \`${tool.name}\``);
      }
      lines.push('');
    }
  }

  // Add gap analysis if available
  if (gapMarkdown) {
    lines.push(gapMarkdown);
    lines.push('');
  }

  lines.push('## Notes');
  lines.push('');
  lines.push('- This count includes only files that contain `ToolDefinition` and `withStandardDecorators`');
  lines.push('- Excludes `index.ts` files and test files (`__tests__` directories)');
  lines.push('- Helper files, constants, and utilities are not counted');

  return lines.join('\n');
}

/**
 * Save results to markdown file.
 */
function saveToFile(content: string, outputPath: string): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`\n✅ Analysis saved to: ${outputPath}`);
}

/**
 * Main function
 */
async function main() {
  // Get configuration from environment
  const projectRoot = path.resolve(process.env.PROJECT_ROOT || '.');
  const toolsDir = process.env.TOOLS_DIR || 'src/umbraco-api/tools';
  const evalsDir = process.env.EVALS_DIR || 'tests/evals';
  const apiGeneratedDir = process.env.API_GENERATED_DIR || 'src/umbraco-api/api/generated';
  const outputFile = process.env.OUTPUT_FILE;
  const showTools = process.env.SHOW_TOOLS === 'true';

  const resolvedToolsDir = path.resolve(projectRoot, toolsDir);
  const resolvedEvalsDir = path.resolve(projectRoot, evalsDir);

  const { collections, total } = countTools(resolvedToolsDir);

  // Print tool counts to console
  const consoleOutput = formatConsoleOutput(collections, total, showTools);
  console.log(consoleOutput);

  // Gap analysis - runs automatically when .discover.json exists
  let gapMarkdown: string | undefined;
  const manifest = loadDiscoverManifest(projectRoot);
  if (manifest) {
    const gaps = analyzeGaps(projectRoot, manifest, collections, resolvedToolsDir, resolvedEvalsDir, apiGeneratedDir);
    const manifestSet = new Set(manifest.collections);
    const undeclaredCollections = collections.filter(c => !manifestSet.has(c.name));
    const gapConsole = formatGapConsoleOutput(gaps, undeclaredCollections);
    console.log(gapConsole);
    gapMarkdown = formatGapMarkdown(gaps, undeclaredCollections);
  }

  // Save to markdown file if OUTPUT_FILE is specified
  if (outputFile) {
    const markdownOutput = formatMarkdownOutput(collections, total, gapMarkdown);
    saveToFile(markdownOutput, outputFile);
  }
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
