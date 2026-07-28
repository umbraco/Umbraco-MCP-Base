import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Remove API tools and code generation for container mode.
 *
 * Strips the Orval-generated API client, example tools, and server-info tool
 * while keeping chaining infrastructure, mocks, and the config system intact.
 */
export function removeApiTools(projectDir: string): number {
  let changes = 0;

  // Remove orval config
  const orvalConfig = path.join(projectDir, "orval.config.ts");
  if (fs.existsSync(orvalConfig)) {
    fs.unlinkSync(orvalConfig);
    changes++;
  }

  // Remove generated API client directory
  const generatedDir = path.join(
    projectDir,
    "src",
    "umbraco-api",
    "api",
    "generated",
  );
  if (fs.existsSync(generatedDir)) {
    fs.rmSync(generatedDir, { recursive: true, force: true });
    changes++;
  }

  // Remove orval example directory
  const orvalExampleDir = path.join(
    projectDir,
    "src",
    "umbraco-api",
    "orval",
  );
  if (fs.existsSync(orvalExampleDir)) {
    fs.rmSync(orvalExampleDir, { recursive: true, force: true });
    changes++;
  }

  // Remove server-info tool (it calls the Umbraco API directly)
  const serverToolDir = path.join(
    projectDir,
    "src",
    "umbraco-api",
    "tools",
    "umbraco-server",
  );
  if (fs.existsSync(serverToolDir)) {
    fs.rmSync(serverToolDir, { recursive: true, force: true });
    changes++;
  }

  // Update src/index.ts — remove API-specific imports and configureApiClient
  const indexTsPath = path.join(projectDir, "src", "index.ts");
  if (fs.existsSync(indexTsPath)) {
    let content = fs.readFileSync(indexTsPath, "utf-8");
    const original = content;

    // Remove Orval-generated API import
    content = content.replace(
      /^.*import.*from ["']\.\/umbraco-api\/api\/generated\/.*["'];?\s*\n/gm,
      "",
    );

    // Remove configureApiClient import from SDK
    content = content.replace(/\s*configureApiClient,/g, "");

    // Remove configureApiClient() call
    content = content.replace(
      /^.*configureApiClient\(.*\);?\s*\n/gm,
      "",
    );

    // Remove initializeUmbracoFetch import and call (container doesn't make direct API calls)
    content = content.replace(/\s*initializeUmbracoFetch,/g, "");
    content = content.replace(
      /\/\/ Initialize the SDK's fetch client.*\n(.*\n)*?.*initializeUmbracoFetch\(.*\);\s*\n\}\s*\n/m,
      "",
    );

    // Remove the baseUrl/clientId/clientSecret variables (only used by initializeUmbracoFetch)
    content = content.replace(
      /^const baseUrl = process\.env\.UMBRACO_BASE_URL.*\n/m,
      "",
    );
    content = content.replace(
      /^const clientId = process\.env\.UMBRACO_CLIENT_ID.*\n/m,
      "",
    );
    content = content.replace(
      /^const clientSecret = process\.env\.UMBRACO_CLIENT_SECRET.*\n/m,
      "",
    );
    content = content.replace(
      /^if \(clientId\) \{\n\s*initializeUmbracoFetch.*\n\}\n/m,
      "",
    );

    // Remove the version check block. It calls the Umbraco Management API via
    // the fetch client removed above and is gated on `clientId`, so leaving it
    // behind would reference deleted variables and fail to compile.
    // `getVersionCheckMessage()` and the `versionCheckMessage` const are kept
    // deliberately: they stay valid (always null here) so the McpServer
    // construction needs no rewriting, and still work if a container-mode
    // project later wires up its own check.
    content = content.replace(/\s*checkUmbracoVersion,/g, "");
    content = content.replace(/\s*configureVersionCheckHook,/g, "");
    content = content.replace(/\s*UmbracoManagementClient,/g, "");
    content = content.replace(/\s*CAPTURE_RAW_HTTP_RESPONSE,/g, "");
    content = content.replace(/\s*type HttpResponse,/g, "");
    // The spec-derived target major is only consumed by the version-check block
    // removed below, so drop the import too rather than leaving it unused.
    // (Container mode also deletes orval.config.ts, so nothing regenerates it.)
    content = content.replace(/\s*UMBRACO_TARGET_MAJOR,/g, "");
    content = content.replace(
      /\/\/ ={20,}\n\/\/ Version Check\n\/\/ ={20,}\n[\s\S]*?\n\}\n\n(?=const versionCheckMessage)/m,
      "",
    );

    if (content !== original) {
      fs.writeFileSync(indexTsPath, content);
      changes++;
    }
  }

  // Update src/collections.ts — remove direct tool collection imports
  const collectionsPath = path.join(projectDir, "src", "collections.ts");
  if (fs.existsSync(collectionsPath)) {
    let content = fs.readFileSync(collectionsPath, "utf-8");
    const original = content;

    // Remove all tool collection imports
    content = content.replace(
      /^import .* from ["']\.\/umbraco-api\/tools\/.*["'];?\s*\n/gm,
      "",
    );

    // Empty the collections array
    content = content.replace(
      /export const collections = \[[\s\S]*?\];/,
      "export const collections: never[] = [];",
    );

    if (content !== original) {
      fs.writeFileSync(collectionsPath, content);
      changes++;
    }
  }

  // Update src/worker.ts — remove generated API import and clientFactory
  const workerPath = path.join(projectDir, "src", "worker.ts");
  if (fs.existsSync(workerPath)) {
    let content = fs.readFileSync(workerPath, "utf-8");
    const original = content;

    // Remove Orval-generated API import
    content = content.replace(
      /^.*import.*from ["']\.\/umbraco-api\/api\/generated\/.*["'];?\s*\n/gm,
      "",
    );

    // Remove clientFactory line that references the generated API
    content = content.replace(
      /\s*clientFactory:.*getExampleUmbracoAddOnAPI.*,?\n/g,
      "\n",
    );

    if (content !== original) {
      fs.writeFileSync(workerPath, content);
      changes++;
    }
  }

  // Remove "generate" script from package.json
  const pkgPath = path.join(projectDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    let changed = false;

    if (pkg.scripts?.generate) {
      delete pkg.scripts.generate;
      changed = true;
    }

    // Remove orval dependency
    if (pkg.devDependencies?.orval) {
      delete pkg.devDependencies.orval;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
      changes++;
    }
  }

  return changes;
}
