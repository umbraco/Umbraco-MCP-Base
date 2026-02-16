import * as path from "node:path";
import prompts from "prompts";
import type { ProjectFeatures } from "./detect-features.js";
import type { Package } from "./list-packages.js";
import { listPackages } from "./list-packages.js";

export type UmbracoSetupChoice = "create" | "existing" | "skip";

export interface FeatureChoices {
  removeMocks: boolean;
  removeChaining: boolean;
  removeExamples: boolean;
  removeEvals: boolean;
}

export interface InstanceLocationChoice {
  path: string;
  label: string;
}

const onCancel = () => {
  process.exit(0);
};

export async function promptUmbracoSetup(): Promise<UmbracoSetupChoice> {
  const { choice } = await prompts(
    {
      type: "select",
      name: "choice",
      message: "How would you like to connect to an Umbraco instance?",
      choices: [
        {
          title: "Create new instance (Recommended)",
          description:
            "Use PSW CLI to create an Umbraco instance with your package",
          value: "create",
        },
        {
          title: "Use existing instance",
          description:
            "Point to an existing Umbraco instance with Swagger",
          value: "existing",
        },
        {
          title: "Skip for now",
          description: "Configure the API connection later",
          value: "skip",
        },
      ],
    },
    { onCancel }
  );

  return choice;
}

export async function promptFeatureChoices(
  features: ProjectFeatures
): Promise<FeatureChoices> {
  const choices: FeatureChoices = {
    removeMocks: false,
    removeChaining: false,
    removeExamples: false,
    removeEvals: false,
  };

  if (features.hasMocks) {
    const { action } = await prompts(
      {
        type: "select",
        name: "action",
        message:
          "Mock infrastructure (MSW mocks for testing without a real Umbraco instance)?",
        choices: [
          {
            title: "Keep (Recommended)",
            description: "Keep MSW mocks for unit testing",
            value: "keep",
          },
          {
            title: "Remove",
            description:
              "Remove mock infrastructure — you'll need a real instance for testing",
            value: "remove",
          },
        ],
      },
      { onCancel }
    );
    choices.removeMocks = action === "remove";
  }

  if (features.hasChaining) {
    const { action } = await prompts(
      {
        type: "select",
        name: "action",
        message:
          "MCP chaining (proxy tools from other MCP servers like @umbraco-cms/mcp-dev)?",
        choices: [
          {
            title: "Keep (Recommended)",
            description:
              "Chain to @umbraco-cms/mcp-dev for core CMS tools",
            value: "keep",
          },
          {
            title: "Remove",
            description:
              "This server will not proxy other MCP servers",
            value: "remove",
          },
        ],
      },
      { onCancel }
    );
    choices.removeChaining = action === "remove";
  }

  if (features.hasExamples) {
    const { action } = await prompts(
      {
        type: "select",
        name: "action",
        message:
          "Example tool collections (demonstrate patterns for building your own tools)?",
        choices: [
          {
            title: "Remove (Recommended)",
            description: "Start with a clean tools directory",
            value: "remove",
          },
          {
            title: "Keep",
            description: "Keep examples as reference while building",
            value: "keep",
          },
        ],
      },
      { onCancel }
    );
    choices.removeExamples = action === "remove";
  }

  if (features.hasEvals) {
    const { action } = await prompts(
      {
        type: "select",
        name: "action",
        message:
          "LLM evaluation tests (use Claude to verify tool effectiveness)?",
        choices: [
          {
            title: "Keep",
            description: "Test tool effectiveness with Claude",
            value: "keep",
          },
          {
            title: "Remove",
            description: "Only keep unit tests",
            value: "remove",
          },
        ],
      },
      { onCancel }
    );
    choices.removeEvals = action === "remove";
  }

  return choices;
}

export async function promptPackageSelection(): Promise<string> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { search } = await prompts(
      {
        type: "text",
        name: "search",
        message: "Search for a NuGet package:",
        validate: (value) =>
          value.trim().length > 0 ? true : "Enter a search term",
      },
      { onCancel }
    );

    let packages: Package[];
    try {
      packages = await listPackages({ searchText: search.trim() });
    } catch {
      console.log("  Could not reach Umbraco Marketplace. Try again.");
      continue;
    }

    if (packages.length === 0) {
      console.log(`  No packages found for "${search.trim()}". Try again.`);
      continue;
    }

    const { packageId } = await prompts(
      {
        type: "select",
        name: "packageId",
        message: `Found ${packages.length} package(s):`,
        choices: [
          ...packages.map((pkg) => ({
            title: pkg.packageId,
            description: `v${pkg.version}`,
            value: pkg.packageId,
          })),
          {
            title: "Search again",
            description: "Try a different search term",
            value: "__search_again__",
          },
        ],
      },
      { onCancel }
    );

    if (packageId !== "__search_again__") {
      return packageId;
    }
  }
}

export function getInstanceLocation(
  projectDir: string
): InstanceLocationChoice {
  const resolved = path.join(projectDir, "demo-site");
  return { path: resolved, label: "demo-site" };
}

export async function promptSwaggerUrl(): Promise<string> {
  const { url } = await prompts(
    {
      type: "text",
      name: "url",
      message: "Enter your Swagger JSON URL:",
      initial:
        "https://localhost:44331/umbraco/swagger/management/swagger.json",
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

  return url;
}

export type DatabaseChoice = "sqlite" | "localdb" | "sqlserver" | "sqlazure";

export interface DatabaseConfig {
  type: DatabaseChoice;
  connectionString?: string;
}

export async function promptDatabase(): Promise<DatabaseConfig> {
  const { choice } = await prompts(
    {
      type: "select",
      name: "choice",
      message: "Database for this instance:",
      choices: [
        {
          title: "SQLite (Recommended)",
          description: "Embedded database, no setup required",
          value: "sqlite",
        },
        {
          title: "LocalDB",
          description: "SQL Server LocalDB (Windows only)",
          value: "localdb",
        },
        {
          title: "SQL Server",
          description: "Full SQL Server (requires connection string)",
          value: "sqlserver",
        },
        {
          title: "SQL Azure",
          description: "Azure SQL Database (requires connection string)",
          value: "sqlazure",
        },
      ],
    },
    { onCancel }
  );

  if (choice === "sqlserver" || choice === "sqlazure") {
    const { connectionString } = await prompts(
      {
        type: "text",
        name: "connectionString",
        message: "Connection string:",
        validate: (value) =>
          value.trim().length > 0 ? true : "Connection string is required",
      },
      { onCancel }
    );

    return { type: choice, connectionString };
  }

  return { type: choice };
}

export async function promptInstallPsw(): Promise<boolean> {
  const { install } = await prompts(
    {
      type: "confirm",
      name: "install",
      message:
        "PSW CLI is not installed. Install it now? (dotnet tool install --global PackageScriptWriter.Cli)",
      initial: true,
    },
    { onCancel }
  );

  return install;
}
