import { execSync } from "node:child_process";
import type { ApiGroup } from "./analyze-api.js";

export interface SuggestedMode {
  name: string;
  displayName: string;
  description: string;
  collections: string[];
}

function toKebabCase(tag: string): string {
  return tag
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

export function groupsToCollectionNames(groups: ApiGroup[]): string[] {
  return groups.map((g) => toKebabCase(g.tag));
}

export async function suggestModesWithLlm(
  groups: ApiGroup[],
  apiName: string
): Promise<SuggestedMode[] | null> {
  const collections = groups.map((g) => ({
    name: toKebabCase(g.tag),
    operations: g.operations.length,
    slices: Object.entries(g.sliceCounts)
      .map(([s, c]) => `${c} ${s}`)
      .join(", "),
  }));

  const prompt = `You are helping configure an Umbraco MCP server. Given these API collections discovered from "${apiName}", suggest meaningful mode groupings.

Collections:
${collections.map((c) => `- ${c.name} (${c.operations} ops: ${c.slices})`).join("\n")}

A "mode" groups related collections together so users can enable a coherent set of tools. For example, a "form-authoring" mode might include form, form-template, field-type, and folder collections.

Rules:
- Group related collections into 2-5 modes (fewer is better)
- Every collection must appear in at least one mode
- Always include one "all" mode containing every collection
- Mode names should be kebab-case
- Keep descriptions concise (under 80 chars)

Respond with ONLY a JSON array, no markdown fences, no explanation:
[{"name":"mode-name","displayName":"Mode Name","description":"Short description","collections":["col-a","col-b"]}]`;

  try {
    const result = execSync(`claude -p "${prompt.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
      timeout: 60_000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Extract JSON array from response (Claude might wrap it in markdown fences)
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    const modes = JSON.parse(jsonMatch[0]) as SuggestedMode[];

    // Validate structure
    if (!Array.isArray(modes) || modes.length === 0) return null;

    const validCollections = new Set(collections.map((c) => c.name));
    for (const mode of modes) {
      if (!mode.name || !mode.collections || !Array.isArray(mode.collections)) {
        return null;
      }
      // Filter out any hallucinated collection names
      mode.collections = mode.collections.filter((c) => validCollections.has(c));
      if (mode.collections.length === 0) return null;
    }

    return modes;
  } catch {
    return null;
  }
}

/** Simple fallback: one mode with all collections */
export function suggestFallbackModes(
  groups: ApiGroup[],
  apiName: string
): SuggestedMode[] {
  const allCollections = groupsToCollectionNames(groups);

  const aggregateName =
    toKebabCase(
      apiName
        .replace(/\bAPI\b/gi, "")
        .replace(/\bUmbraco\b/gi, "")
        .trim() || "all"
    ) + "-all";

  return [
    {
      name: aggregateName,
      displayName: `All ${apiName.replace(/\bAPI\b/gi, "").replace(/\bUmbraco\b/gi, "").trim() || "API"} Tools`,
      description: `All ${groups.length} collections combined`,
      collections: allCollections,
    },
  ];
}
