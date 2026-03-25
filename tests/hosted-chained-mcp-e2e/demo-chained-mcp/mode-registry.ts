import type { ToolModeDefinition } from "@umbraco-cms/mcp-server-sdk";

export const toolModes: ToolModeDefinition[] = [
  {
    name: "alerts",
    displayName: "Alerts & Notifications",
    description: "Notification management tools",
    collections: ["notification"],
  },
  {
    name: "reporting",
    displayName: "Reporting",
    description: "Analytics and reporting tools",
    collections: ["analytics", "umbraco"],
  },
];

export const allModes: ToolModeDefinition[] = [...toolModes];
export const allModeNames: readonly string[] = toolModes.map((m) => m.name);
