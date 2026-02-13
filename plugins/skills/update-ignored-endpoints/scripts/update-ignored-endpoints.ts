#!/usr/bin/env npx tsx
/**
 * Update the IGNORED_ENDPOINTS.md file with current endpoint coverage analysis.
 *
 * This script:
 * 1. Discovers all generated API client files in the project
 * 2. Extracts all API endpoint names from those files
 * 3. Identifies which endpoints have corresponding MCP tools implemented
 * 4. Updates the IGNORED_ENDPOINTS.md file with the current list of unimplemented endpoints
 * 5. Preserves the rationale sections from the existing documentation
 */

import * as fs from 'fs';
import * as path from 'path';
import glob from 'glob';
import {
  type DiscoverManifest,
  type ToolToEndpointMap,
  loadDiscoverManifest,
  discoverApiFiles,
  extractApiEndpoints,
  mapToolsToEndpoints,
  buildCollectionTokens,
  matchEndpointToCollection,
} from '../../_shared/endpoint-analysis.js';

interface CategorizedEndpoints {
  [category: string]: string[];
}

interface CategorizedResult {
  /** Endpoints matched to collections in .discover.json */
  declared: CategorizedEndpoints;
  /** Endpoints matched to tool directories NOT in .discover.json */
  undeclared: CategorizedEndpoints;
  /** Endpoints that didn't match any collection */
  uncategorized: string[];
}

/**
 * Title-case a hyphenated collection name.
 * e.g. "document-type" -> "Document Type", "form" -> "Form"
 */
function titleCase(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Categorize ignored endpoints by matching against collection names.
 *
 * Two-pass matching:
 * 1. Match against .discover.json collections (declared)
 * 2. Match remaining against tool directories not in .discover.json (undeclared)
 * 3. Whatever's left is uncategorized
 */
function categorizeIgnoredEndpoints(
  allEndpoints: string[],
  toolToEndpointMap: ToolToEndpointMap,
  manifest: DiscoverManifest | null,
  undeclaredCollections: string[]
): CategorizedResult {
  const implementedEndpoints = new Set(Object.keys(toolToEndpointMap));
  const ignoredEndpoints = allEndpoints.filter(e => !implementedEndpoints.has(e));

  if (!manifest) {
    return { declared: {}, undeclared: {}, uncategorized: ignoredEndpoints.sort() };
  }

  const declaredTokens = buildCollectionTokens(manifest.collections);
  const undeclaredTokens = buildCollectionTokens(undeclaredCollections);

  const declared: CategorizedEndpoints = {};
  const undeclared: CategorizedEndpoints = {};
  const uncategorized: string[] = [];

  for (const endpoint of ignoredEndpoints) {
    // First pass: declared collections
    const declaredMatch = matchEndpointToCollection(endpoint, declaredTokens);
    if (declaredMatch) {
      const category = titleCase(declaredMatch);
      if (!declared[category]) declared[category] = [];
      declared[category].push(endpoint);
      continue;
    }

    // Second pass: undeclared tool directories
    const undeclaredMatch = matchEndpointToCollection(endpoint, undeclaredTokens);
    if (undeclaredMatch) {
      const category = titleCase(undeclaredMatch);
      if (!undeclared[category]) undeclared[category] = [];
      undeclared[category].push(endpoint);
      continue;
    }

    uncategorized.push(endpoint);
  }

  // Sort within each group
  for (const cat in declared) declared[cat].sort();
  for (const cat in undeclared) undeclared[cat].sort();
  uncategorized.sort();

  return { declared, undeclared, uncategorized };
}

/**
 * Read existing rationale sections from the documentation.
 */
function readExistingRationales(ignoredEndpointsFile: string): string {
  if (!fs.existsSync(ignoredEndpointsFile)) {
    return '';
  }

  const content = fs.readFileSync(ignoredEndpointsFile, 'utf-8');

  // Extract rationale section
  const rationaleMatch = content.match(/## Rationale\n\n([\s\S]*)$/);
  if (rationaleMatch) {
    return rationaleMatch[0];
  }
  return '';
}

/**
 * Convert endpoint name to human-readable description.
 */
function humanizeEndpointName(endpoint: string): string {
  // Remove get/post/put/delete/create/update/search/patch prefix
  let name = endpoint.replace(/^(get|post|put|delete|create|update|search|patch)/, '');

  // Add spaces before capitals
  name = name.replace(/([A-Z])/g, ' $1').trim();

  // Determine operation type
  let operation: string;
  if (endpoint.startsWith('get')) {
    operation = 'Get';
  } else if (endpoint.startsWith('post')) {
    operation = 'Create/Execute';
  } else if (endpoint.startsWith('put')) {
    operation = 'Update';
  } else if (endpoint.startsWith('delete')) {
    operation = 'Delete';
  } else if (endpoint.startsWith('create')) {
    operation = 'Create';
  } else if (endpoint.startsWith('update')) {
    operation = 'Update';
  } else if (endpoint.startsWith('search')) {
    operation = 'Search';
  } else if (endpoint.startsWith('patch')) {
    operation = 'Patch';
  } else {
    operation = 'Operation';
  }

  return `${operation} ${name.toLowerCase()}`;
}

/**
 * Render a list of categorized endpoints as markdown sections.
 */
function renderEndpointCategories(lines: string[], categories: CategorizedEndpoints): void {
  const sorted = Object.keys(categories).sort();
  for (const category of sorted) {
    const endpoints = categories[category];
    lines.push(`### ${category} (${endpoints.length} endpoints)`);
    for (const endpoint of endpoints) {
      lines.push(`- \`${endpoint}\` - ${humanizeEndpointName(endpoint)}`);
    }
    lines.push('');
  }
}

/**
 * Generate the updated IGNORED_ENDPOINTS.md content.
 */
function generateUpdatedDoc(
  result: CategorizedResult,
  totalIgnored: number,
  existingRationale: string
): string {
  const lines: string[] = [
    '# Ignored Endpoints',
    '',
    'These endpoints are intentionally not implemented in the MCP server, typically because they:',
    '- Are related to import/export functionality that may not be suitable for MCP operations',
    '- Have security implications',
    '- Are deprecated or have better alternatives',
    '- Are not applicable in the MCP context',
    ''
  ];

  // Declared collections (from .discover.json)
  const declaredCategories = Object.keys(result.declared);
  if (declaredCategories.length > 0) {
    lines.push('## Ignored by Collection');
    lines.push('');
    renderEndpointCategories(lines, result.declared);
  }

  // Undeclared collections (tool directories not in .discover.json)
  const undeclaredCategories = Object.keys(result.undeclared);
  if (undeclaredCategories.length > 0) {
    lines.push('## Not in .discover.json');
    lines.push('');
    lines.push('These endpoints match tool directories not listed in `.discover.json`:');
    lines.push('');
    renderEndpointCategories(lines, result.undeclared);
  }

  // Uncategorized (no match at all), grouped by inferred resource name
  if (result.uncategorized.length > 0) {
    lines.push('## Uncategorized');
    lines.push('');
    lines.push('These endpoints do not match any known collection:');
    lines.push('');

    // Group by first word after verb prefix
    const groups: CategorizedEndpoints = {};
    for (const endpoint of result.uncategorized) {
      const withoutVerb = endpoint.replace(/^(get|post|put|delete|create|update|search|patch)/, '');
      const match = withoutVerb.match(/^([A-Z][a-z]*)/);
      const group = match ? match[1] : 'Other';
      if (!groups[group]) groups[group] = [];
      groups[group].push(endpoint);
    }

    renderEndpointCategories(lines, groups);
  }

  lines.push(`## Total Ignored: ${totalIgnored} endpoints`);
  lines.push('');

  // Preserve existing rationale if present
  if (existingRationale) {
    lines.push(existingRationale);
  }

  return lines.join('\n');
}

/**
 * Main function
 */
async function main() {
  // Paths
  const projectRoot = path.resolve(process.env.PROJECT_ROOT || '.');
  const apiGeneratedDir = process.env.API_GENERATED_DIR || 'src/umbraco-api/api/generated';
  const toolsDir = path.resolve(projectRoot, process.env.TOOLS_DIR || 'src/umbraco-api/tools');
  const ignoredEndpointsFile = path.resolve(projectRoot, process.env.OUTPUT_FILE || 'docs/analysis/IGNORED_ENDPOINTS.md');

  // Discover API client files
  console.log(`Discovering API client files in: ${path.resolve(projectRoot, apiGeneratedDir)}`);
  const apiFiles = discoverApiFiles(projectRoot, apiGeneratedDir);

  if (apiFiles.length === 0) {
    console.error('No API client files found. Run `npm run generate` first.');
    process.exit(1);
  }

  // Extract endpoints from all files
  const { endpoints: allEndpoints, fileInfos } = extractApiEndpoints(apiFiles);

  console.log(`\nFound ${apiFiles.length} API client file${apiFiles.length === 1 ? '' : 's'}:`);
  for (const info of fileInfos) {
    console.log(`  - ${info.fileName} (${info.endpointCount} endpoints)`);
  }
  console.log(`Total: ${allEndpoints.length} unique API endpoints`);

  console.log(`\nAnalyzing implemented tools from: ${toolsDir}`);
  const toolToEndpointMap = mapToolsToEndpoints(toolsDir);
  console.log(`Found ${Object.keys(toolToEndpointMap).length} implemented endpoints`);

  console.log('\nLoading .discover.json manifest...');
  const manifest = loadDiscoverManifest(projectRoot);
  if (manifest) {
    console.log(`Found manifest with ${manifest.collections.length} collections: ${manifest.collections.join(', ')}`);
  } else {
    console.log('No .discover.json found, endpoints will be uncategorized');
  }

  // Find tool directories not in .discover.json
  let undeclaredCollections: string[] = [];
  if (manifest && fs.existsSync(toolsDir)) {
    const manifestSet = new Set(manifest.collections);
    const toolDirEntries = fs.readdirSync(toolsDir, { withFileTypes: true });
    undeclaredCollections = toolDirEntries
      .filter(e => e.isDirectory() && !manifestSet.has(e.name))
      .map(e => e.name);
    if (undeclaredCollections.length > 0) {
      console.log(`Found ${undeclaredCollections.length} tool directories not in .discover.json: ${undeclaredCollections.join(', ')}`);
    }
  }

  console.log('\nCategorizing ignored endpoints...');
  const result = categorizeIgnoredEndpoints(allEndpoints, toolToEndpointMap, manifest, undeclaredCollections);
  const totalIgnored =
    Object.values(result.declared).reduce((sum, arr) => sum + arr.length, 0) +
    Object.values(result.undeclared).reduce((sum, arr) => sum + arr.length, 0) +
    result.uncategorized.length;
  const categoryCount =
    Object.keys(result.declared).length +
    Object.keys(result.undeclared).length +
    (result.uncategorized.length > 0 ? 1 : 0);
  console.log(`Found ${totalIgnored} ignored endpoints across ${categoryCount} categories`);

  console.log('\nReading existing rationales...');
  const existingRationale = readExistingRationales(ignoredEndpointsFile);

  console.log(`\nGenerating updated documentation...`);
  const updatedContent = generateUpdatedDoc(result, totalIgnored, existingRationale);

  console.log(`Writing to: ${ignoredEndpointsFile}`);
  fs.mkdirSync(path.dirname(ignoredEndpointsFile), { recursive: true });
  fs.writeFileSync(ignoredEndpointsFile, updatedContent);

  // Count actual tool files (with ToolDefinition + withStandardDecorators)
  const toolFiles = glob.sync('**/*.ts', {
    cwd: toolsDir,
    absolute: true,
    ignore: ['**/index.ts', '**/__tests__/**']
  });

  let actualToolCount = 0;
  for (const tsFile of toolFiles) {
    const content = fs.readFileSync(tsFile, 'utf-8');
    if (content.includes('withStandardDecorators') && content.includes('ToolDefinition')) {
      actualToolCount++;
    }
  }

  console.log('\n✅ IGNORED_ENDPOINTS.md has been updated successfully!');
  console.log(`\nSummary:`);
  console.log(`  Total API endpoints: ${allEndpoints.length}`);
  console.log(`  Implemented (unique endpoints): ${Object.keys(toolToEndpointMap).length}`);
  console.log(`  Ignored: ${totalIgnored}`);
  console.log(`  Coverage: ${(Object.keys(toolToEndpointMap).length / allEndpoints.length * 100).toFixed(1)}%`);
  console.log(`\nNote: ${actualToolCount} MCP tools implement ${Object.keys(toolToEndpointMap).length} unique API endpoints`);
  console.log(`      Some tools use multiple endpoints, and some endpoints are used by multiple tools.`);
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
