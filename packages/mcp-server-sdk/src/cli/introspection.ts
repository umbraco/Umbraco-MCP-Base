/**
 * CLI Introspection
 *
 * Runtime-queryable tool documentation for humans and developers.
 * These functions run before the MCP server starts and are purely
 * for command-line use (--list-tools, --describe-tool).
 */

import { ZodRawShape, ZodType, ZodObject, ZodString, ZodNumber, ZodBoolean, ZodOptional, ZodDefault, ZodEnum, ZodArray, ZodUUID, ZodNullable, ZodLiteral } from "zod";
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
 * Convert a Zod schema shape to a simplified JSON Schema representation.
 * This is a best-effort conversion for display purposes.
 */
export function toolToJsonSchema(tool: ToolDefinition<any, any>): Record<string, unknown> {
  const schema = tool.inputSchema;
  if (!schema) {
    return { type: "object", properties: {} };
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, zodField] of Object.entries(schema as ZodRawShape)) {
    const { schema: propSchema, isRequired } = zodFieldToJsonSchema(zodField as ZodType);
    properties[key] = propSchema;
    if (isRequired) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function zodFieldToJsonSchema(field: ZodType): { schema: Record<string, unknown>; isRequired: boolean } {
  let isRequired = true;
  let current: ZodType = field;

  // Unwrap optional/default/nullable wrappers
  if (current instanceof ZodOptional) {
    isRequired = false;
    current = (current as any)._def.innerType;
  }
  if (current instanceof ZodDefault) {
    isRequired = false;
    current = (current as any)._def.innerType;
  }
  if (current instanceof ZodNullable) {
    current = (current as any)._def.innerType;
  }

  const desc = (current as any).description;

  let schema: Record<string, unknown>;

  if (current instanceof ZodString) {
    schema = { type: "string" };
  } else if (current instanceof ZodUUID) {
    schema = { type: "string", format: "uuid" };
  } else if (current instanceof ZodNumber) {
    schema = { type: "number" };
  } else if (current instanceof ZodBoolean) {
    schema = { type: "boolean" };
  } else if (current instanceof ZodEnum) {
    schema = { type: "string", enum: (current as any)._def.values };
  } else if (current instanceof ZodLiteral) {
    const value = (current as any)._def.value;
    schema = { type: typeof value, const: value };
  } else if (current instanceof ZodArray) {
    const itemSchema = zodFieldToJsonSchema((current as any)._def.type);
    schema = { type: "array", items: itemSchema.schema };
  } else if (current instanceof ZodObject) {
    const nested = toolToJsonSchema({ inputSchema: (current as any).shape } as any);
    schema = nested;
  } else {
    schema = { type: "unknown" };
  }

  if (desc) {
    schema.description = desc;
  }

  return { schema, isRequired };
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
