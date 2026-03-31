/**
 * Context Generator
 *
 * Generates a structured CONTEXT.md file from registered tool collections.
 * This file can be fed to LLMs as reference documentation about available tools.
 */

import { ToolDefinition } from "../types/tool-definition.js";
import { ToolCollectionExport } from "../types/tool-collection.js";
import { CollectionConfiguration } from "../types/collection-configuration.js";
import { toolToJsonSchema } from "./introspection.js";
import { shouldIncludeTool } from "../tool-filtering/tool-filter.js";

/**
 * Options for context generation.
 */
export interface GenerateContextOptions {
  /** Server name (defaults to "Umbraco MCP Server") */
  serverName?: string;
  /** Server version */
  serverVersion?: string;
  /** Optional user object to pass to collection tools() for authorization-aware listing */
  user?: unknown;
  /** Optional filter configuration — when provided, only matching tools are included */
  filterConfig?: CollectionConfiguration;
}

/**
 * Generate a structured CONTEXT.md from tool collections.
 *
 * @param collections - The tool collections to document
 * @param options - Generation options
 * @returns Markdown string
 */
export function generateContextFile(
  collections: ToolCollectionExport<any>[],
  options?: GenerateContextOptions
): string {
  const serverName = options?.serverName ?? "Umbraco MCP Server";
  const serverVersion = options?.serverVersion ?? "unknown";

  const lines: string[] = [
    `# ${serverName} Context`,
    "",
    `> Auto-generated context file. Version: ${serverVersion}`,
    "",
    "## Collections",
    "",
  ];

  for (const collection of collections) {
    const meta = collection.metadata;

    let tools: ReturnType<typeof collection.tools>;
    try {
      tools = collection.tools(options?.user);
    } catch {
      tools = [];
    }

    // Apply filtering if provided
    if (options?.filterConfig) {
      tools = tools.filter((tool) =>
        shouldIncludeTool(tool, { collectionName: meta.name, config: options.filterConfig! }),
      );
    }

    // Skip collections with no tools after filtering
    if (tools.length === 0) continue;

    lines.push(`### ${meta.displayName ?? meta.name}`);
    lines.push("");
    if (meta.description) {
      lines.push(meta.description);
      lines.push("");
    }

    for (const tool of tools) {
      lines.push(`#### \`${tool.name}\``);
      lines.push("");
      lines.push(tool.description);
      lines.push("");

      // Parameters
      const jsonSchema = toolToJsonSchema(tool);
      const properties = jsonSchema.properties as Record<string, unknown> | undefined;
      if (properties && Object.keys(properties).length > 0) {
        lines.push("**Parameters:**");
        lines.push("");
        for (const [key, schema] of Object.entries(properties)) {
          const s = schema as Record<string, unknown>;
          const type = s.type ?? "unknown";
          const desc = s.description ? ` — ${s.description}` : "";
          const required = (jsonSchema.required as string[] | undefined)?.includes(key);
          lines.push(`- \`${key}\` (${type}${required ? ", required" : ""})${desc}`);
        }
        lines.push("");
      }

      // Annotations
      const ann = tool.annotations;
      if (ann) {
        const hints: string[] = [];
        if (ann.readOnlyHint) hints.push("read-only");
        if (ann.destructiveHint) hints.push("destructive");
        if (ann.idempotentHint) hints.push("idempotent");
        if (hints.length > 0) {
          lines.push(`**Hints:** ${hints.join(", ")}`);
          lines.push("");
        }
      }

      // Slices
      if (tool.slices.length > 0) {
        lines.push(`**Slices:** ${tool.slices.join(", ")}`);
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## Workflows");
  lines.push("");
  lines.push("_Add common workflows and usage patterns here._");
  lines.push("");
  lines.push("## Invariants");
  lines.push("");
  lines.push("_Add domain invariants and constraints here._");
  lines.push("");

  return lines.join("\n");
}
