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
/**
 * Base modes - fundamental domain groupings for testing.
 */
export const baseModes: ToolModeDefinition[] = [
  {
    name: 'content',
    displayName: 'Content Management',
    description: 'Document creation, editing, and versioning',
    collections: ['document', 'document-version', 'document-blueprint', 'tag']
  },
  {
    name: 'content-modeling',
    displayName: 'Content Modeling',
    description: 'Document types, data types, and media types',
    collections: ['document-type', 'data-type', 'media-type']
  },
  {
    name: 'front-end',
    displayName: 'Front-end Development',
    description: 'Templates, partials, stylesheets, and scripts',
    collections: ['template', 'partial-view', 'stylesheet', 'script', 'static-file']
  },
  {
    name: 'media',
    displayName: 'Media Management',
    description: 'Media library and file operations',
    collections: ['media', 'imaging', 'temporary-file']
  },
  {
    name: 'search',
    displayName: 'Search',
    description: 'Indexing and search operations',
    collections: ['indexer', 'searcher']
  },
  {
    name: 'users',
    displayName: 'User Management',
    description: 'Users and user groups',
    collections: ['user', 'user-group', 'user-data']
  },
  {
    name: 'members',
    displayName: 'Member Management',
    description: 'Members, member types, and member groups',
    collections: ['member', 'member-type', 'member-group']
  },
  {
    name: 'health',
    displayName: 'Health & Monitoring',
    description: 'Health checks and log viewing',
    collections: ['health', 'log-viewer']
  },
  {
    name: 'translation',
    displayName: 'Translation',
    description: 'Cultures, languages, and dictionary items',
    collections: ['culture', 'language', 'dictionary']
  },
  {
    name: 'system',
    displayName: 'System',
    description: 'Server info and system configuration',
    collections: ['server', 'manifest', 'models-builder']
  },
  {
    name: 'integrations',
    displayName: 'Integrations',
    description: 'Webhooks, redirects, and relations',
    collections: ['webhook', 'redirect', 'relation', 'relation-type']
  },
];

/**
 * All mode definitions.
 */
export const allModes: ToolModeDefinition[] = [...baseModes];

/**
 * All valid mode names for configuration validation.
 */
export const allModeNames: readonly string[] = baseModes.map(m => m.name);

/**
 * Valid mode name type.
 */
export type ToolModeName = typeof allModeNames[number];
