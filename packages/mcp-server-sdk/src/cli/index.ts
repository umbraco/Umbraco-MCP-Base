/**
 * CLI Utilities
 *
 * Command-line introspection and context generation for MCP servers.
 * These run before the MCP server starts and are for developer use.
 */

export {
  toolToJsonSchema,
  toolToSummary,
  formatToolTable,
  type ToolSummary,
} from "./introspection.js";

export {
  generateContextFile,
  type GenerateContextOptions,
} from "./context-generator.js";
