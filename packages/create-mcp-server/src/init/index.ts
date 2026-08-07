import * as path from "node:path";
import pc from "picocolors";
import { detectFeatures } from "./detect-features.js";
import { configureOpenApi } from "./configure-openapi.js";
import { removeMocks } from "./remove-mocks.js";
import { removeExamples } from "./remove-examples.js";
import { removeChaining } from "./remove-chaining.js";
import { removeEvals } from "./remove-evals.js";
import { removeApiTools } from "./remove-api-tools.js";
import { setupInstance } from "./setup-instance.js";
import { detectPsw, installPsw, PSW_VERSION } from "./psw-cli.js";
import { readLaunchSettingsUrl, updateEnvBaseUrl, updateEnvVar } from "../discover/index.js";
import { checkHealth } from "../discover/health-check.js";
import { checkApiUser } from "../discover/check-api-user.js";
import { discoverSwaggerEndpoints } from "../discover/discover-swagger.js";
import { promptApiSelection, promptOpenApiUrl } from "../discover/prompts.js";
import { validateOpenApiUrl, toDirectSwaggerEndpoint } from "../discover/direct-spec-url.js";
import {
  promptUmbracoSetup,
  promptToolMode,
  promptFeatureChoices,
  promptPackageSelection,
  promptUmbracoVersion,
  getInstanceLocation,
  promptExistingInstance,
  promptConnectionString,
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
        "\nRun 'npx @umbraco-cms/create-umbraco-mcp-server <name>' to create a new project first."
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

  // Step 3: If creating, ensure PSW CLI is available and up to date
  if (umbracoChoice === "create") {
    const psw = detectPsw();
    const needsInstall = !psw.installed || psw.version !== PSW_VERSION;
    if (needsInstall) {
      if (psw.installed) {
        console.log(pc.dim(`  PSW CLI ${psw.version} found, updating to ${PSW_VERSION}...`));
      }
      const shouldInstall = psw.installed || await promptInstallPsw();
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

  // Step 4: Gather instance details
  let packageName: string | undefined;
  let instanceLocation: { path: string; label: string } | undefined;
  let existingInstance:
    | { baseUrl: string; adminEmail: string; adminPassword: string }
    | undefined;
  let selectedSwaggerUrl: string | undefined;
  let connectionString: string | undefined;
  let directOpenApiUrl: string | undefined;

  let umbracoVersion: string | undefined;

  if (umbracoChoice === "create") {
    connectionString = await promptConnectionString();
    packageName = await promptPackageSelection();
    umbracoVersion = await promptUmbracoVersion();
    instanceLocation = getInstanceLocation(projectDir);
  } else if (umbracoChoice === "existing") {
    existingInstance = await promptExistingInstance();
  } else if (umbracoChoice === "url") {
    directOpenApiUrl = await promptOpenApiUrl();
  }

  // Step 5: Tool mode — API tools or container?
  const toolMode = await promptToolMode();
  const isContainerMode = toolMode === "container";

  // Step 6: Feature questions (container mode skips chaining — always kept)
  console.log();
  const featureChoices = isContainerMode
    ? { removeMocks: false, removeChaining: false, removeExamples: true, removeEvals: false }
    : await promptFeatureChoices(features);

  console.log(); // blank line before actions

  // Step 7: Execute - build instance
  let instanceCreated = false;
  if (umbracoChoice === "create" && packageName && instanceLocation) {
    console.log(
      pc.dim(`\nCreating Umbraco instance with ${packageName}...\n`)
    );
    try {
      const result = await setupInstance({
        packageName,
        instanceDir: instanceLocation.path,
        projectDir,
        connectionString,
        umbracoVersion,
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

  // Step 8: Existing-instance setup (skip for container mode)
  if (existingInstance && !isContainerMode) {
    const { baseUrl, adminEmail, adminPassword } = existingInstance;

    const isLocalhost =
      baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
    if (isLocalhost) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    console.log(pc.dim(`\nChecking ${baseUrl}...`));
    const health = await checkHealth(baseUrl);
    if (!health.healthy) {
      console.log(
        pc.red(`  Could not reach Umbraco instance: ${health.error ?? "unknown"}`),
      );
      console.log(pc.dim("  Start the instance and re-run init."));
    } else {
      console.log(pc.green("  Instance is running"));

      const apiUser = await checkApiUser(baseUrl, { adminEmail, adminPassword });
      if (apiUser.authenticated && apiUser.created) {
        console.log(pc.green("  API user created and authenticated"));
      } else if (apiUser.authenticated) {
        console.log(pc.green("  API user authenticated"));
      } else {
        console.log(pc.yellow(`  ${apiUser.error ?? "Could not create API user"}`));
      }

      console.log(pc.dim("  Discovering APIs..."));
      const endpoints = await discoverSwaggerEndpoints(baseUrl);
      if (endpoints.length === 0) {
        console.log(pc.yellow("  No Swagger endpoints found at this instance"));
      } else {
        const selected =
          endpoints.length === 1 ? endpoints[0] : await promptApiSelection(endpoints);
        selectedSwaggerUrl = selected.url;
        const updated = configureOpenApi(projectDir, selected.url, selected.name);
        if (updated) {
          console.log(pc.green(`  orval.config.ts → ${selected.url}`));
        }

        updateEnvBaseUrl(projectDir, baseUrl);
        updateEnvVar(projectDir, "UMBRACO_CLIENT_ID", "umbraco-back-office-mcp");
        updateEnvVar(projectDir, "UMBRACO_CLIENT_SECRET", "1234567890");
        console.log(pc.green(`  .env → UMBRACO_BASE_URL=${baseUrl}`));
        console.log(pc.green("  .env → UMBRACO_CLIENT_ID=umbraco-back-office-mcp"));
        console.log(pc.green("  .env → UMBRACO_CLIENT_SECRET=1234567890"));
      }
    }
  }

  // Step 8b: Direct OpenAPI spec URL — bypasses health check, API-user setup,
  // and discovery entirely (there may be no reachable Umbraco instance behind it).
  if (directOpenApiUrl && !isContainerMode) {
    console.log(pc.dim(`\nValidating ${directOpenApiUrl}...`));
    const validation = await validateOpenApiUrl(directOpenApiUrl);

    if (validation.parseable) {
      console.log(pc.green(`  Found ${validation.title ?? "OpenAPI"} spec`));
    } else {
      console.log(
        pc.yellow(
          `  Could not verify the spec (${validation.error ?? "unknown error"}) — continuing anyway. The URL may be behind authentication.`
        )
      );
    }

    const endpoint = toDirectSwaggerEndpoint(directOpenApiUrl, validation.title);
    const updated = configureOpenApi(projectDir, directOpenApiUrl, endpoint.name);
    if (updated) {
      selectedSwaggerUrl = directOpenApiUrl;
      console.log(pc.green(`  orval.config.ts → ${directOpenApiUrl}`));
    }

    console.log(
      pc.dim(
        "  No Umbraco base URL is known for this spec — set UMBRACO_BASE_URL, UMBRACO_CLIENT_ID and UMBRACO_CLIENT_SECRET in .env manually if the API requires authentication."
      )
    );
  }

  // Step 9: Apply feature removals
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

  // Container mode: remove API tools (orval, generated client, server-info tool)
  if (isContainerMode) {
    removeApiTools(projectDir);
    console.log(pc.green("  [x] Removed API tools and code generation (container mode)"));
  }

  // Step 10: Summary
  console.log(pc.bold(pc.green("\nConfiguration complete:")));

  if (isContainerMode) {
    console.log(pc.green("  [x] Container mode — wrapping other MCP servers"));
  }

  if (instanceCreated) {
    console.log(pc.green("  [x] Umbraco instance created in demo-site/"));
  }

  if (selectedSwaggerUrl && !isContainerMode) {
    console.log(pc.green(`  [x] OpenAPI target: ${selectedSwaggerUrl}`));
  } else if (!instanceCreated && !isContainerMode) {
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
  if (isContainerMode) {
    console.log(pc.dim(`  ${step++}. Configure child MCP servers in src/config/mcp-servers.ts`));
    if (instanceCreated) {
      console.log(pc.dim(`  ${step++}. Start the Umbraco instance: npm run start:umbraco`));
    }
    console.log(pc.dim(`  ${step++}. npm run build && node dist/index.js`));
  } else if (instanceCreated) {
    console.log(pc.dim(`  ${step++}. Start the Umbraco instance: npm run start:umbraco`));
    console.log(pc.dim(`  ${step++}. (in a separate terminal) npx @umbraco-cms/create-umbraco-mcp-server discover`));
  } else if (selectedSwaggerUrl) {
    console.log(pc.dim(`  ${step++}. npm run generate`));
  }
  console.log();
}
