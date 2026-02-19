import * as fs from "node:fs";
import * as path from "node:path";
import pc from "picocolors";
import { detectFeatures } from "../init/detect-features.js";
import { configureOpenApi } from "../init/configure-openapi.js";
import { checkHealth } from "./health-check.js";
import { checkApiUser, printApiUserWarning } from "./check-api-user.js";
import { discoverSwaggerEndpoints } from "./discover-swagger.js";
import { generateClient } from "./generate-client.js";
import { analyzeApi } from "./analyze-api.js";
import { extractPermissions } from "./extract-permissions.js";
import { suggestModesWithLlm, suggestFallbackModes, groupsToCollectionNames } from "./suggest-modes.js";
import { updateModeRegistry, updateSliceRegistry } from "./update-registries.js";
import {
  promptBaseUrl,
  promptApiSelection,
  promptConfirmOrval,
  promptConfirmGenerate,
  promptGroupSelection,
  promptUpdateModeRegistry,
  promptUpdateSliceRegistry,
} from "./prompts.js";

export async function runDiscover(dir?: string): Promise<void> {
  const projectDir = path.resolve(dir || process.cwd());

  console.log(pc.bold(pc.cyan("\nDiscover Umbraco API\n")));

  // Step 1: Validate project
  const detection = detectFeatures(projectDir);

  if (!detection.valid) {
    console.log(
      pc.red("This directory is not a valid Umbraco MCP server project.\n")
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

  console.log(
    pc.dim(`Project: ${detection.projectName} (${detection.projectDir})`)
  );

  // Step 2: Get base URL (auto-detect from instance, .env, or orval config)
  const detected = detectBaseUrl(projectDir);
  if (detected.source) {
    console.log(pc.dim(`Detected URL from ${detected.source}: ${detected.url}`));
  }
  const baseUrl = await promptBaseUrl(detected.url);

  // Step 3: Health check
  // Allow self-signed certs for localhost
  const isLocalhost =
    baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
  if (isLocalhost) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  console.log(pc.dim(`\nChecking ${baseUrl}...`));
  const health = await checkHealth(baseUrl);

  if (!health.healthy) {
    console.log(pc.red(`\nCould not reach Umbraco instance.`));
    console.log(pc.red(`  ${health.error}`));
    console.log(
      pc.dim("\nMake sure the Umbraco instance is running and try again.")
    );
    process.exit(1);
  }

  console.log(pc.green("  Instance is running"));

  // Check API user exists, create if needed
  console.log(pc.dim("Checking API user..."));
  const apiUser = await checkApiUser(baseUrl);

  if (apiUser.authenticated && apiUser.created) {
    console.log(pc.green("  API user created and authenticated"));
  } else if (apiUser.authenticated) {
    console.log(pc.green("  API user authenticated"));
  } else {
    if (apiUser.error) {
      console.log(pc.dim(`  ${apiUser.error}`));
    }
    printApiUserWarning();
  }

  // Update .env with base URL
  const envUpdated = updateEnvBaseUrl(projectDir, baseUrl);
  if (envUpdated) {
    console.log(pc.green(`  Updated .env → UMBRACO_BASE_URL=${baseUrl}`));
  }

  // Step 4: Discover swagger endpoints
  console.log(pc.dim("Discovering APIs..."));
  const endpoints = await discoverSwaggerEndpoints(baseUrl);

  if (endpoints.length === 0) {
    console.log(
      pc.red("\nNo Swagger endpoints found at this instance.")
    );
    console.log(
      pc.dim("Make sure your package is installed and exposes a Swagger endpoint.")
    );
    process.exit(1);
  }

  console.log(
    pc.green(
      `  Found ${endpoints.length} API${endpoints.length > 1 ? "s" : ""}: ${endpoints.map((e) => e.name).join(", ")}`
    )
  );

  // Step 5: Select API
  console.log();
  const selected = await promptApiSelection(endpoints);

  // Step 6: Configure orval
  const shouldConfigureOrval = await promptConfirmOrval();

  if (shouldConfigureOrval) {
    const updated = configureOpenApi(projectDir, selected.url, selected.name);
    if (updated) {
      console.log(pc.green(`  Updated orval.config.ts → ${selected.url}`));
    } else {
      console.log(pc.yellow("  orval.config.ts was not updated"));
    }
  }

  // Step 7: Generate client
  const shouldGenerate = await promptConfirmGenerate();

  if (shouldGenerate) {
    console.log(pc.dim("\nGenerating API client...\n"));
    const genResult = generateClient(projectDir);

    if (!genResult.success) {
      console.log(
        pc.yellow(`\nClient generation failed: ${genResult.error}`)
      );
      console.log(pc.dim("You can run 'npm run generate' manually later."));
    } else {
      console.log(pc.green("\n  Client generated successfully"));
    }
  }

  // Step 8: Analyze API
  console.log(pc.dim("\nAnalyzing API..."));

  const analysis = await analyzeApi(selected.url);

  // Step 9: Extract permissions
  const specResponse = await fetch(selected.url, {
    signal: AbortSignal.timeout(15_000),
  });
  const spec = await specResponse.json();
  const permissions = extractPermissions(spec);

  // Step 10: Print discovery report
  console.log();
  console.log(
    pc.bold(pc.green(`Discovery Complete: ${analysis.title}`))
  );
  console.log();
  console.log(`  API: ${pc.cyan(selected.url)}`);
  console.log(
    `  Groups: ${pc.bold(String(analysis.groups.length))} | Operations: ${pc.bold(String(analysis.totalOperations))}`
  );
  console.log();

  for (const group of analysis.groups) {
    const sliceSummary = Object.entries(group.sliceCounts)
      .map(([slice, count]) => `${count} ${slice}`)
      .join(", ");
    console.log(
      `  ${pc.bold(group.tag.padEnd(20))} ${String(group.operations.length).padStart(3)} ops  (${sliceSummary})`
    );
  }

  console.log();
  console.log(
    `  Slices: ${analysis.slicesUsed.join(", ")}`
  );

  if (permissions.authSchemeType) {
    console.log();
    console.log(
      `  Security: ${permissions.authSchemeType}${permissions.authSchemeName ? ` (${permissions.authSchemeName})` : ""}`
    );
    if (permissions.scopes.length > 0) {
      console.log(`  Scopes: ${permissions.scopes.join(", ")}`);
    }
    console.log(
      `  Authenticated: ${permissions.authenticatedCount}/${permissions.totalOperations} operations`
    );
  }

  console.log();

  // Step 11: Select groups to include as collections
  const selectedGroups = await promptGroupSelection(analysis.groups);

  if (selectedGroups.length === 0) {
    console.log(pc.dim("  No groups selected. Skipping mode suggestions."));
    console.log();
    return;
  }

  console.log(
    pc.dim(`  Selected ${selectedGroups.length} of ${analysis.groups.length} groups`)
  );

  // Step 12: Suggest modes using Claude
  console.log(pc.dim("  Asking Claude for mode suggestions..."));
  let modes = await suggestModesWithLlm(selectedGroups, analysis.title);

  if (modes) {
    console.log(pc.green("  Claude suggested modes:"));
  } else {
    console.log(pc.dim("  Claude not available, using fallback"));
    modes = suggestFallbackModes(selectedGroups, analysis.title);
  }

  console.log();
  console.log(pc.bold("  Suggested Modes:"));
  for (const mode of modes) {
    console.log(
      `  ${pc.cyan(mode.name.padEnd(24))} → [${mode.collections.join(", ")}]`
    );
    if (mode.description) {
      console.log(`  ${pc.dim(" ".repeat(24) + "  " + mode.description)}`);
    }
  }

  console.log();

  // Step 13: Prompt to update registries
  if (modes.length > 0) {
    const shouldUpdateModes = await promptUpdateModeRegistry();
    if (shouldUpdateModes) {
      const added = updateModeRegistry(projectDir, modes);
      if (added > 0) {
        console.log(
          pc.green(`  Added ${added} mode${added > 1 ? "s" : ""} to mode-registry.ts`)
        );
      } else {
        console.log(pc.dim("  No new modes to add"));
      }
    }
  }

  const newSlices = analysis.slicesUsed.filter(
    (s) => !["create", "read", "update", "delete", "list"].includes(s)
  );

  if (newSlices.length > 0) {
    const shouldUpdateSlices = await promptUpdateSliceRegistry();
    if (shouldUpdateSlices) {
      const added = updateSliceRegistry(projectDir, newSlices);
      if (added > 0) {
        console.log(
          pc.green(`  Added ${added} slice${added > 1 ? "s" : ""} to slice-registry.ts`)
        );
      } else {
        console.log(pc.dim("  No new slices to add"));
      }
    }
  }

  // Step 14: Write discovery manifest
  const manifest = {
    apiName: analysis.title,
    swaggerUrl: selected.url,
    baseUrl,
    collections: groupsToCollectionNames(selectedGroups),
  };

  const manifestPath = path.join(projectDir, ".discover.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(pc.green(`  Wrote ${pc.bold(".discover.json")} — discovery manifest for tool generation`));

  console.log();
  console.log(pc.dim("Next steps:"));
  console.log(pc.dim("  1. Open the project in Claude Code"));
  console.log(pc.dim("  2. Install the Umbraco MCP skills plugin in Claude Code:"));
  console.log(pc.dim("       /plugin marketplace add umbraco/umbraco-mcp-server-sdk"));
  console.log(pc.dim("       /plugin install umbraco-mcp-skills@umbraco-mcp-server-sdk-plugins"));
  console.log(pc.dim("  3. Run /build-tools to generate tool collections from .discover.json"));
  console.log(pc.dim("  4. Run /build-tools-tests to generate integration tests for the collections"));
  console.log();
}

interface DetectedUrl {
  url?: string;
  source?: string;
}

export function detectBaseUrl(projectDir: string): DetectedUrl {
  // 1. Check launchSettings.json from local Umbraco instance
  const launchUrl = readLaunchSettingsUrl(projectDir);
  if (launchUrl) {
    return { url: launchUrl, source: "launchSettings.json" };
  }

  // 2. Check .env file
  const envUrl = readEnvBaseUrl(projectDir);
  if (envUrl) {
    return { url: envUrl, source: ".env" };
  }

  // 3. Check orval.config.ts for an existing remote URL
  const orvalUrl = readOrvalBaseUrl(projectDir);
  if (orvalUrl) {
    return { url: orvalUrl, source: "orval.config.ts" };
  }

  return {};
}

function readEnvBaseUrl(projectDir: string): string | undefined {
  const envPath = path.join(projectDir, ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    const match = content.match(/^UMBRACO_BASE_URL\s*=\s*(.+)$/m);
    if (match) {
      return match[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

export function readLaunchSettingsUrl(projectDir: string): string | undefined {
  // Instance lives directly in demo-site/
  const launchPath = path.join(projectDir, "demo-site", "Properties", "launchSettings.json");
  if (!fs.existsSync(launchPath)) return undefined;

  try {
    const content = JSON.parse(fs.readFileSync(launchPath, "utf-8"));
    const profiles = content.profiles || {};

    for (const profile of Object.values(profiles) as Array<{ applicationUrl?: string }>) {
      if (!profile.applicationUrl) continue;

      // applicationUrl can be "https://localhost:44391;http://localhost:5000"
      // Prefer HTTPS
      const urls = profile.applicationUrl.split(";").map((u: string) => u.trim());
      const httpsUrl = urls.find((u: string) => u.startsWith("https://"));
      if (httpsUrl) return httpsUrl.replace(/\/+$/, "");

      const httpUrl = urls.find((u: string) => u.startsWith("http://"));
      if (httpUrl) return httpUrl.replace(/\/+$/, "");
    }
  } catch {
    // Ignore parse errors
  }

  return undefined;
}

function readOrvalBaseUrl(projectDir: string): string | undefined {
  const orvalPath = path.join(projectDir, "orval.config.ts");
  if (!fs.existsSync(orvalPath)) return undefined;

  const content = fs.readFileSync(orvalPath, "utf-8");

  // Match a remote URL target (not the default local yaml)
  const match = content.match(
    /target:\s*["'](https?:\/\/[^"']+\/umbraco\/swagger\/[^"']+)["']/
  );
  if (match) {
    try {
      const url = new URL(match[1]);
      return `${url.protocol}//${url.host}`;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Update a single env variable in the .env file.
 * Creates .env from .env.example if it doesn't exist yet.
 */
export function updateEnvVar(projectDir: string, key: string, value: string): boolean {
  const envPath = path.join(projectDir, ".env");
  const envExamplePath = path.join(projectDir, ".env.example");
  const pattern = new RegExp(`^${key}\\s*=\\s*.+$`, "m");

  // Ensure .env exists (seed from .env.example if needed)
  if (!fs.existsSync(envPath)) {
    if (fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
    } else {
      fs.writeFileSync(envPath, "");
    }
  }

  let content = fs.readFileSync(envPath, "utf-8");

  if (content.match(pattern)) {
    const original = content;
    content = content.replace(pattern, `${key}=${value}`);
    if (content !== original) {
      fs.writeFileSync(envPath, content);
      return true;
    }
    return false;
  }

  // Append if not present
  const newline = content.endsWith("\n") ? "" : "\n";
  fs.writeFileSync(envPath, content + `${newline}${key}=${value}\n`);
  return true;
}

export function updateEnvBaseUrl(projectDir: string, baseUrl: string): boolean {
  return updateEnvVar(projectDir, "UMBRACO_BASE_URL", baseUrl);
}
