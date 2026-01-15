/**
 * Tool Mode Registry
 *
 * Defines tool modes that group tools by domain/functionality.
 * Modes map to collections, allowing users to enable groups of related tools.
 *
 * This is the SINGLE SOURCE OF TRUTH for mode definitions in this project.
 */

import type { ToolModeDefinition } from "@umbraco-cms/mcp-toolkit";

/**
 * Tool mode definitions for this project.
 *
 * Each mode groups related tool collections together.
 * Users can enable modes in their config to include all tools in those collections.
 *
 * @example
 * ```typescript
 * // In server config
 * {
 *   toolModes: ['content', 'media']  // Enables all tools in content and media collections
 * }
 * ```
 */
export const toolModes: ToolModeDefinition[] = [
  {
    name: 'example',
    displayName: 'Example Tools',
    description: 'Example CRUD operations for demonstration',
    collections: ['example']
  },
  {
    name: 'example-2',
    displayName: 'Example-2 Tools',
    description: 'Second example collection for testing',
    collections: ['example-2']
  },
  {
    name: 'all-examples',
    displayName: 'All Example Tools',
    description: 'Both example collections combined',
    collections: ['example', 'example-2']
  },
  // Add your modes here as you build out your MCP server
  // {
  //   name: 'content',
  //   displayName: 'Content Management',
  //   description: 'Document creation, editing, and versioning',
  //   collections: ['document', 'document-version', 'document-blueprint']
  // },
  // {
  //   name: 'media',
  //   displayName: 'Media Management',
  //   description: 'Media library and file operations',
  //   collections: ['media', 'imaging', 'temporary-file']
  // },
];

/**
 * All mode definitions (alias for toolModes).
 */
export const allModes: ToolModeDefinition[] = [...toolModes];

/**
 * All valid mode names for configuration validation.
 */
export const allModeNames: readonly string[] = toolModes.map(m => m.name);

/**
 * Valid mode name type.
 */
export type ToolModeName = typeof allModeNames[number];
