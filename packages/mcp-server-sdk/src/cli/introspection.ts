/**
 * CLI Introspection
 *
 * Runtime-queryable tool documentation for humans and developers.
 * These functions run before the MCP server starts and are purely
 * for command-line use (--list-tools, --describe-tool).
 */

import { z, ZodRawShape } from "zod";
import { ToolDefinition } from "../types/tool-definition.js";

/**
 * Summary of a single tool for table display.
 */
export interface ToolSummary {
  name: string;
  collection: string;
  description: string;
  slices: string[];
  readOnly: boolean;
  destructive: boolean;
}

/**
 * Convert a tool's Zod input shape to JSON Schema (draft 2020-12), the same
 * dialect `tools/list` advertises. Unrepresentable types (e.g. z.date()) become
 * `{}` rather than throwing, since the CLI must never crash on a schema.
 */
export function toolToJsonSchema(tool: ToolDefinition<any, any>): Record<string, unknown> {
  const schema = tool.inputSchema;
  if (!schema) {
    return { type: "object", properties: {} };
  }

  return z.toJSONSchema(z.object(schema as ZodRawShape), {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}

/**
 * Convert a tool definition into a structured summary for table display.
 */
export function toolToSummary(tool: ToolDefinition<any, any>, collectionName: string): ToolSummary {
  return {
    name: tool.name,
    collection: collectionName,
    description: tool.description.length > 80
      ? tool.description.substring(0, 77) + "..."
      : tool.description,
    slices: tool.slices,
    readOnly: tool.annotations?.readOnlyHint ?? false,
    destructive: tool.annotations?.destructiveHint ?? false,
  };
}

/**
 * Format an array of tool summaries as an aligned text table for terminal output.
 */
export function formatToolTable(summaries: ToolSummary[]): string {
  if (summaries.length === 0) {
    return "No tools registered.";
  }

  const headers = ["Name", "Collection", "Slices", "RO", "Destr", "Description"];

  const rows = summaries.map((s) => [
    s.name,
    s.collection,
    s.slices.length > 0 ? s.slices.join(",") : "other",
    s.readOnly ? "Y" : "N",
    s.destructive ? "Y" : "N",
    s.description,
  ]);

  // Calculate column widths
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );

  // Cap description column at 60 chars
  colWidths[5] = Math.min(colWidths[5], 60);

  const separator = colWidths.map((w) => "-".repeat(w)).join("-+-");
  const formatRow = (row: string[]) =>
    row.map((cell, i) => {
      const width = colWidths[i];
      const truncated = cell.length > width ? cell.substring(0, width - 3) + "..." : cell;
      return truncated.padEnd(width);
    }).join(" | ");

  const lines = [
    formatRow(headers),
    separator,
    ...rows.map(formatRow),
  ];

  return lines.join("\n");
}
