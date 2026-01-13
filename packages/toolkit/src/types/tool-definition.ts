/**
 * Tool Definition Types
 *
 * Core type definitions for MCP tools.
 */

import { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodRawShape, ZodType } from "zod";

/**
 * MCP tool annotations provide metadata about tool behavior.
 * These are advisory hints that help clients understand tool characteristics.
 */
export interface ToolAnnotations {
  /** Human-readable title for the tool (optional, defaults to name) */
  title?: string;
  /** Indicates if the tool does not modify its environment (defaults to false if not specified) */
  readOnlyHint?: boolean;
  /** Suggests whether the tool may perform destructive updates */
  destructiveHint?: boolean;
  /** Shows if calling the tool multiple times with the same arguments has the same effect */
  idempotentHint?: boolean;
  /** Specifies if the tool interacts with external systems (always true for API-based tools) */
  openWorldHint: boolean;
}

/**
 * Generic user model interface for tool enablement checks.
 * Implement this interface to provide user context to tool enabled checks.
 */
export interface UserModel {
  /** Unique identifier for the user */
  id?: string;
  /** User's display name */
  name?: string;
  /** User's email address */
  email?: string;
  /** User's groups or roles */
  groups?: Array<{ id?: string; name?: string }>;
  /** Additional user properties */
  [key: string]: unknown;
}

/**
 * Base tool slice names - minimal set for common operations.
 * Extend these in your project with domain-specific slices.
 *
 * @example
 * ```typescript
 * // In your project's slice-registry.ts
 * import { baseSliceNames } from "@umbraco-cms/mcp-toolkit";
 *
 * export const toolSliceNames = [
 *   ...baseSliceNames,
 *   'publish', 'recycle-bin', 'move', 'copy',  // Add your slices
 * ] as const;
 * ```
 */
export const baseSliceNames = [
  'create', 'read', 'update', 'delete', 'list',
] as const;

/**
 * Base slice name type.
 */
export type BaseSliceName = typeof baseSliceNames[number];

/**
 * All base slice names including 'other' catch-all.
 */
export const allBaseSliceNames: readonly string[] = [...baseSliceNames, 'other'];

/**
 * Core tool definition interface.
 *
 * @typeParam InputArgs - Zod schema shape for input parameters
 * @typeParam OutputArgs - Zod schema for output validation
 * @typeParam TUser - User model type for enabled checks
 */
export interface ToolDefinition<
  InputArgs extends undefined | ZodRawShape = undefined,
  OutputArgs extends undefined | ZodRawShape | ZodType = undefined,
  TUser = UserModel
> {
  /** Unique tool name */
  name: string;
  /** Tool description for LLM understanding */
  description: string;
  /** Input parameter schema (Zod shape) */
  inputSchema?: InputArgs;
  /** @deprecated Use inputSchema instead - kept for backwards compatibility */
  schema?: InputArgs;
  /** Optional output schema for structured responses (supports objects, arrays, primitives) */
  outputSchema?: OutputArgs;
  /** Tool handler function */
  handler: ToolCallback<InputArgs>;
  /** Optional function to dynamically enable/disable the tool based on user context */
  enabled?: (user: TUser) => boolean;
  /** Explicit slice assignment for categorization (empty array = always included) */
  slices: string[];
  /** Optional annotations for tool behavior hints */
  annotations?: Partial<ToolAnnotations>;
  /** @deprecated Use annotations.readOnlyHint instead - kept for backwards compatibility */
  isReadOnly?: boolean;
}
