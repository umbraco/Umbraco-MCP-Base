/**
 * Tool Slice Registry
 *
 * Defines all valid slice names for categorizing tools by operation type.
 * Extends the base slices from the toolkit with domain-specific slices.
 *
 * Slices are assigned explicitly on each tool via the `slices` property.
 * This is the SINGLE SOURCE OF TRUTH for slice names in this project.
 */

import { baseSliceNames } from "@umbraco-cms/mcp-server-sdk";

/**
 * Tool slice names for this project.
 * Extends base CRUD slices with domain-specific operations.
 */
export const toolSliceNames = [
  // Base slices from toolkit (create, read, update, delete, list)
  ...baseSliceNames,

  // Navigation
  'tree',
  'folders',

  // Query
  'search',
  'references',

  // Workflow
  'publish',
  'recycle-bin',
  'move',
  'copy',
  'sort',
  'validate',
  'rename',

  // Information
  'configuration',
  'audit',
  'urls',
  'domains',
  'permissions',
  'user-status',
  'current-user',

  // Entity Management
  'notifications',
  'public-access',
  'scaffolding',
  'blueprints',

  // System
  'server-info',
  'diagnostics',
  'templates',
] as const;

/**
 * Valid slice name type for compile-time safety.
 */
export type ToolSliceName = typeof toolSliceNames[number];

/**
 * All valid slice names including 'other' catch-all.
 * Tools with empty slices array are categorized as 'other'.
 */
export const allSliceNames: readonly string[] = [...toolSliceNames, 'other'];

/**
 * Extended slice name type including 'other'.
 */
export type ExtendedSliceName = ToolSliceName | 'other';
