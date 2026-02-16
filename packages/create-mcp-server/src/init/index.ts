import * as path from "node:path";
import pc from "picocolors";
import { detectFeatures } from "./detect-features.js";
import { configureOpenApi } from "./configure-openapi.js";
import { removeMocks } from "./remove-mocks.js";
import { removeExamples } from "./remove-examples.js";
import { removeChaining } from "./remove-chaining.js";
import { removeEvals } from "./remove-evals.js";
import { setupInstance } from "./setup-instance.js";
import { detectPsw, installPsw } from "./psw-cli.js";
import { readLaunchSettingsUrl, updateEnvBaseUrl, updateEnvVar } from "../discover/index.js";
import type { DatabaseConfig } from "./prompts.js";
import {
  promptUmbracoSetup,
  promptFeatureChoices,
  promptPackageSelection,
  getInstanceLocation,
  promptSwaggerUrl,
  promptDatabase,
  promptInstallPsw,
} from "./prompts.js";

export async function runInit(dir?: string): Promise<void> {
  const projectDir = path.resolve(dir || process.cwd());

  console.log(pc.bold(pc.cyan("\nConfigure Umbraco MCP Server\n")));

  // Step 1: Detect project features
  const detection = detectFeatures(projectDir);

  if (!detection.valid) {
    console.log(
      pc.red(
        "This directory is not a valid Umbraco MCP server project.\n"
      )
    );
    if (detection.missing) {
      console.log(pc.dim("Missing: " + detection.missing.join(", ")));
    }
    console.log(
      pc.dim(
        "\nRun 'npx create-umbraco-mcp-server <name>' to create a new project first."
      )
    );
    process.exit(1);
  }

  const features = detection.features!;

  console.log(
    pc.dim(`Project: ${detection.projectName} (${detection.projectDir})`)
  );
  console.log(
    pc.dim(
      `Detected: ${[
        features.hasMocks && "mocks",
        features.hasChaining && "chaining",
        features.hasExamples && "examples",
        features.hasEvals && "evals",
      ]
        .filter(Boolean)
        .join(", ")}\n`
    )
  );

  // Step 2: Umbraco instance setup
  let umbracoChoice = await promptUmbracoSetup();

  // Step 3: If creating, ensure PSW CLI is available
  if (umbracoChoice === "create") {
    const psw = detectPsw();
    if (!psw.installed) {
      const shouldInstall = await promptInstallPsw();
      if (shouldInstall) {
        try {
          installPsw();
        } catch (error) {
          console.log(
            pc.yellow(
              `\nPSW CLI installation failed: ${error instanceof Error ? error.message : error}`
            )
          );
          console.log(pc.dim("Skipping instance creation.\n"));
          umbracoChoice = "skip";
        }
      } else {
        console.log(pc.dim("\nSkipping instance creation.\n"));
        umbracoChoice = "skip";
      }
    }
  }

  // Step 4: If creating/existing, gather instance details
  let packageName: string | undefined;
  let instanceLocation: { path: string; label: string } | undefined;
  let swaggerUrl: string | undefined;
  let databaseConfig: DatabaseConfig | undefined;

  if (umbracoChoice === "create") {
    packageName = await promptPackageSelection();
    instanceLocation = getInstanceLocation(projectDir);
    databaseConfig = await promptDatabase();
  } else if (umbracoChoice === "existing") {
    swaggerUrl = await promptSwaggerUrl();
  }

  // Step 5: Feature questions
  console.log();
  const featureChoices = await promptFeatureChoices(features);

  console.log(); // blank line before actions

  // Step 6: Execute - build instance
  let instanceCreated = false;
  if (umbracoChoice === "create" && packageName && instanceLocation) {
    console.log(
      pc.dim(`\nCreating Umbraco instance with ${packageName}...\n`)
    );
    try {
      const result = await setupInstance({
        packageName,
        instanceDir: instanceLocation.path,
        database: databaseConfig,
      });

      instanceCreated = true;
      console.log(
        pc.green(
          `\nUmbraco instance created with ${pc.bold(packageName)}.`
        )
      );
      console.log(pc.dim(`  Location: ${instanceLocation.label}`));
      console.log(
        pc.dim(`  Admin: ${result.adminEmail} / ${result.adminPassword}`)
      );

      // Populate .env with known values from the instance setup
      const launchUrl = readLaunchSettingsUrl(projectDir);
      if (launchUrl) {
        updateEnvBaseUrl(projectDir, launchUrl);
        console.log(pc.green(`  .env → UMBRACO_BASE_URL=${launchUrl}`));
      }
      updateEnvVar(projectDir, "UMBRACO_CLIENT_ID", "umbraco-back-office-mcp");
      updateEnvVar(projectDir, "UMBRACO_CLIENT_SECRET", "1234567890");
      console.log(pc.green("  .env → UMBRACO_CLIENT_ID=umbraco-back-office-mcp"));
      console.log(pc.green("  .env → UMBRACO_CLIENT_SECRET=1234567890"));
    } catch (error) {
      console.log(
        pc.yellow(
          `\nInstance setup failed: ${error instanceof Error ? error.message : error}`
        )
      );
    }
  }

  // Step 7: Apply OpenAPI configuration
  if (swaggerUrl) {
    const updated = configureOpenApi(projectDir, swaggerUrl);
    if (updated) {
      console.log(pc.green(`  OpenAPI target: ${swaggerUrl}`));
    }
  }

  // Step 8: Apply feature removals
  if (featureChoices.removeMocks) {
    removeMocks(projectDir);
  }
  if (featureChoices.removeChaining) {
    removeChaining(projectDir);
  }
  if (featureChoices.removeExamples) {
    removeExamples(projectDir);
  }
  if (featureChoices.removeEvals) {
    removeEvals(projectDir);
  }

  // Step 9: Summary
  console.log(pc.bold(pc.green("\nConfiguration complete:")));

  if (instanceCreated) {
    console.log(pc.green("  [x] Umbraco instance created in demo-site/"));
  }

  if (swaggerUrl) {
    console.log(pc.green(`  [x] OpenAPI target: ${swaggerUrl}`));
  } else if (!instanceCreated) {
    console.log(pc.dim("  [ ] OpenAPI target: not configured"));
  }

  if (features.hasMocks) {
    console.log(
      featureChoices.removeMocks
        ? pc.green("  [x] Removed mock infrastructure")
        : pc.dim("  [x] Kept mock infrastructure")
    );
  }
  if (features.hasChaining) {
    console.log(
      featureChoices.removeChaining
        ? pc.green("  [x] Removed MCP chaining")
        : pc.dim("  [x] Kept MCP chaining")
    );
  }
  if (features.hasExamples) {
    console.log(
      featureChoices.removeExamples
        ? pc.green("  [x] Removed example tools")
        : pc.dim("  [x] Kept example tools")
    );
  }
  if (features.hasEvals) {
    console.log(
      featureChoices.removeEvals
        ? pc.green("  [x] Removed eval tests")
        : pc.dim("  [x] Kept eval tests")
    );
  }

  console.log(pc.dim("\nNext steps:"));
  let step = 1;
  if (instanceCreated) {
    console.log(pc.dim(`  ${step++}. Start the Umbraco instance: npm run start:umbraco`));
    console.log(pc.dim(`  ${step++}. (in a separate terminal) npx create-umbraco-mcp-server discover`));
  } else if (swaggerUrl) {
    console.log(pc.dim(`  ${step++}. npm run generate`));
  }
  console.log();
}
