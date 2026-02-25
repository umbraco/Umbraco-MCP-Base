import prompts from "prompts";
import type { SwaggerEndpoint } from "./discover-swagger.js";
import type { ApiGroup } from "./analyze-api.js";

const onCancel = () => {
  process.exit(0);
};

export async function promptBaseUrl(defaultUrl?: string): Promise<string> {
  const { url } = await prompts(
    {
      type: "text",
      name: "url",
      message: "Umbraco base URL:",
      initial: defaultUrl || "https://localhost:44331",
      validate: (value) => {
        try {
          const parsed = new URL(value);
          if (
            parsed.protocol !== "http:" &&
            parsed.protocol !== "https:"
          ) {
            return "URL must start with http:// or https://";
          }
          return true;
        } catch {
          return "Please enter a valid URL";
        }
      },
    },
    { onCancel }
  );

  return url.replace(/\/+$/, "");
}

export async function promptApiSelection(
  endpoints: SwaggerEndpoint[]
): Promise<SwaggerEndpoint> {
  if (endpoints.length === 1) {
    return endpoints[0];
  }

  const { selected } = await prompts(
    {
      type: "select",
      name: "selected",
      message: "Select an API to discover:",
      choices: endpoints.map((ep) => ({
        title: ep.name,
        description: ep.url,
        value: ep,
      })),
    },
    { onCancel }
  );

  return selected;
}

export async function promptConfirmOrval(): Promise<boolean> {
  const { confirmed } = await prompts(
    {
      type: "confirm",
      name: "confirmed",
      message: "Update orval.config.ts with this API endpoint?",
      initial: true,
    },
    { onCancel }
  );

  return confirmed;
}

export async function promptConfirmGenerate(): Promise<boolean> {
  const { confirmed } = await prompts(
    {
      type: "confirm",
      name: "confirmed",
      message: "Generate API client now? (npm run generate)",
      initial: true,
    },
    { onCancel }
  );

  return confirmed;
}

export async function promptGroupSelection(
  groups: ApiGroup[]
): Promise<ApiGroup[]> {
  if (groups.length === 0) return [];

  const { selected } = await prompts(
    {
      type: "multiselect",
      name: "selected",
      message: "Select API groups to include as tool collections:",
      choices: groups.map((g) => {
        const sliceSummary = Object.entries(g.sliceCounts)
          .map(([s, c]) => `${c} ${s}`)
          .join(", ");
        return {
          title: g.tag,
          description: `${g.operations.length} ops (${sliceSummary})`,
          value: g.tag,
          selected: true,
        };
      }),
      instructions: false,
      hint: "- Space to toggle, Enter to confirm",
    },
    { onCancel }
  );

  const selectedSet = new Set(selected as string[]);
  return groups.filter((g) => selectedSet.has(g.tag));
}

export async function promptUpdateModeRegistry(): Promise<boolean> {
  const { confirmed } = await prompts(
    {
      type: "confirm",
      name: "confirmed",
      message: "Update mode-registry.ts with suggested modes?",
      initial: false,
    },
    { onCancel }
  );

  return confirmed;
}

export async function promptUpdateSliceRegistry(): Promise<boolean> {
  const { confirmed } = await prompts(
    {
      type: "confirm",
      name: "confirmed",
      message: "Update slice-registry.ts with new slices?",
      initial: false,
    },
    { onCancel }
  );

  return confirmed;
}
