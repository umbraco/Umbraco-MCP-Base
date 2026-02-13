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
 * Categorize ignored endpoints by matching against collection names from .discover.json.
 * Falls back to a single "Uncategorized" group when no manifest exists.
 */
function categorizeIgnoredEndpoints(
  allEndpoints: string[],
  toolToEndpointMap: ToolToEndpointMap,
  manifest: DiscoverManifest | null
): CategorizedEndpoints {
  const implementedEndpoints = new Set(Object.keys(toolToEndpointMap));
  const ignoredEndpoints = allEndpoints.filter(e => !implementedEndpoints.has(e));

  const categories: CategorizedEndpoints = {};

  if (!manifest) {
    // No manifest — put everything in one group
    categories['Uncategorized'] = ignoredEndpoints.sort();
    return categories;
  }

  const collectionTokens = buildCollectionTokens(manifest.collections);

  for (const endpoint of ignoredEndpoints) {
    const matched = matchEndpointToCollection(endpoint, collectionTokens);
    let category = matched ? titleCase(matched) : 'Other';

    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(endpoint);
  }

  // Sort endpoints within each category
  for (const category in categories) {
    categories[category].sort();
  }

  return categories;
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
 * Generate the updated IGNORED_ENDPOINTS.md content.
 */
function generateUpdatedDoc(
  categories: CategorizedEndpoints,
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
    '',
    '## Ignored by Category',
    ''
  ];

  // Sort categories alphabetically
  const sortedCategories = Object.keys(categories).sort();

  for (const category of sortedCategories) {
    const endpoints = categories[category];
    lines.push(`### ${category} (${endpoints.length} endpoints)`);
    for (const endpoint of endpoints) {
      lines.push(`- \`${endpoint}\` - ${humanizeEndpointName(endpoint)}`);
    }
    lines.push('');
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

  console.log('\nCategorizing ignored endpoints...');
  const categories = categorizeIgnoredEndpoints(allEndpoints, toolToEndpointMap, manifest);
  const totalIgnored = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`Found ${totalIgnored} ignored endpoints across ${Object.keys(categories).length} categories`);

  console.log('\nReading existing rationales...');
  const existingRationale = readExistingRationales(ignoredEndpointsFile);

  console.log(`\nGenerating updated documentation...`);
  const updatedContent = generateUpdatedDoc(categories, totalIgnored, existingRationale);

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
