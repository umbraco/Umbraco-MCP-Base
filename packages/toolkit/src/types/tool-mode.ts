/**
 * Tool Mode Types
 *
 * Types for defining preset modes that group collections together.
 */

/**
 * Definition for a tool mode that groups collections.
 */
export interface ToolModeDefinition {
  /** Mode key (e.g., 'content', 'media') */
  name: string;
  /** Human readable name */
  displayName: string;
  /** Mode description */
  description: string;
  /** Collection names this mode includes */
  collections: string[];
}
