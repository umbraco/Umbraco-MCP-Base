import { config as loadEnv } from "dotenv";
import { resolve } from "path";
import { configureToolResultMode } from "../helpers/tool-result.js";
import { configureDryRunMode } from "../helpers/dry-run.js";

export interface UmbracoAuthConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export interface UmbracoServerConfig {
  auth: UmbracoAuthConfig;
  toolModes?: string[];
  includeToolCollections?: string[];
  excludeToolCollections?: string[];
  includeSlices?: string[];
  excludeSlices?: string[];
  includeTools?: string[];
  excludeTools?: string[];
  allowedMediaPaths?: string[];
  readonly?: boolean;
  disableOutputCompatibilityMode?: boolean;
  dryRun?: boolean;
  configSources: {
    clientId: "cli" | "env";
    clientSecret: "cli" | "env";
    baseUrl: "cli" | "env";
    toolModes?: "cli" | "env" | "none";
    includeToolCollections?: "cli" | "env" | "none";
    excludeToolCollections?: "cli" | "env" | "none";
    includeSlices?: "cli" | "env" | "none";
    excludeSlices?: "cli" | "env" | "none";
    includeTools?: "cli" | "env" | "none";
    excludeTools?: "cli" | "env" | "none";
    allowedMediaPaths?: "cli" | "env" | "none";
    readonly?: "cli" | "env" | "none";
    disableOutputCompatibilityMode?: "cli" | "env" | "none";
    dryRun?: "cli" | "env" | "none";
    envFile: "cli" | "default";
  };
}

// ============================================================================
// Configuration Field Definitions - Table-Driven Approach
// ============================================================================

export type ConfigFieldType = "string" | "boolean" | "csv" | "csv-path";

export interface ConfigFieldDefinition {
  name: string;
  envVar: string;
  /** CLI flag name. Omit for env-only fields (e.g. secrets that must not appear in command lines). */
  cliFlag?: string;
  type: ConfigFieldType;
  required?: boolean;
  isAuth?: boolean;
  isSecret?: boolean;
}

const CONFIG_FIELDS: ConfigFieldDefinition[] = [
  // Auth fields (required) — no cliFlag for credentials to prevent secret leakage in terminal/logs
  { name: "clientId", envVar: "UMBRACO_CLIENT_ID", type: "string", required: true, isAuth: true },
  { name: "clientSecret", envVar: "UMBRACO_CLIENT_SECRET", type: "string", required: true, isAuth: true, isSecret: true },
  { name: "baseUrl", envVar: "UMBRACO_BASE_URL", cliFlag: "umbraco-base-url", type: "string", required: true, isAuth: true },
  // Optional fields
  { name: "toolModes", envVar: "UMBRACO_TOOL_MODES", cliFlag: "umbraco-tool-modes", type: "csv" },
  { name: "includeToolCollections", envVar: "UMBRACO_INCLUDE_TOOL_COLLECTIONS", cliFlag: "umbraco-include-tool-collections", type: "csv" },
  { name: "excludeToolCollections", envVar: "UMBRACO_EXCLUDE_TOOL_COLLECTIONS", cliFlag: "umbraco-exclude-tool-collections", type: "csv" },
  { name: "includeSlices", envVar: "UMBRACO_INCLUDE_SLICES", cliFlag: "umbraco-include-slices", type: "csv" },
  { name: "excludeSlices", envVar: "UMBRACO_EXCLUDE_SLICES", cliFlag: "umbraco-exclude-slices", type: "csv" },
  { name: "includeTools", envVar: "UMBRACO_INCLUDE_TOOLS", cliFlag: "umbraco-include-tools", type: "csv" },
  { name: "excludeTools", envVar: "UMBRACO_EXCLUDE_TOOLS", cliFlag: "umbraco-exclude-tools", type: "csv" },
  { name: "allowedMediaPaths", envVar: "UMBRACO_ALLOWED_MEDIA_PATHS", cliFlag: "umbraco-allowed-media-paths", type: "csv-path" },
  { name: "readonly", envVar: "UMBRACO_READONLY", cliFlag: "umbraco-readonly", type: "boolean" },
  { name: "disableOutputCompatibilityMode", envVar: "DISABLE_OUTPUT_COMPATIBILITY_MODE", cliFlag: "disable-output-compatibility-mode", type: "boolean" },
  { name: "dryRun", envVar: "UMBRACO_DRY_RUN", cliFlag: "umbraco-dry-run", type: "boolean" },
];

// ============================================================================
// Helper Functions
// ============================================================================

function maskSecret(secret: string): string {
  if (!secret || secret.length <= 4) return "****";
  return `****${secret.slice(-4)}`;
}

function parseValue(value: string | boolean | undefined, type: ConfigFieldType, fromCli: boolean): string | string[] | boolean | undefined {
  if (value === undefined) return undefined;

  switch (type) {
    case "string":
      return String(value);
    case "boolean":
      // Original behavior: only set to true if explicitly true, otherwise undefined
      // CLI: yargs returns boolean directly, trust it if truthy
      // ENV: only "true" (case-insensitive) sets the value
      if (fromCli) {
        return value ? true : undefined;
      }
      return String(value).toLowerCase() === "true" ? true : undefined;
    case "csv":
      return String(value).split(",").map(v => v.trim()).filter(Boolean);
    case "csv-path":
      return String(value).split(",").map(p => resolve(p.trim())).filter(Boolean);
    default:
      return String(value);
  }
}

interface ResolveResult {
  value: string | string[] | boolean | undefined;
  source: "cli" | "env" | "none";
}

function resolveConfigField(
  argv: CliArgs,
  field: ConfigFieldDefinition
): ResolveResult {
  const cliKey = field.cliFlag as keyof CliArgs | undefined;
  const cliValue = cliKey ? argv[cliKey] : undefined;
  const envValue = process.env[field.envVar];

  if (cliValue !== undefined) {
    const value = parseValue(cliValue, field.type, true);
    // For boolean fields, undefined means "not set" - fall through to env
    if (value !== undefined) {
      return { value, source: "cli" };
    }
  }

  if (envValue !== undefined) {
    const value = parseValue(envValue, field.type, false);
    if (value !== undefined) {
      return { value, source: "env" };
    }
  }

  return { value: undefined, source: "none" };
}

function formatValueForLog(value: unknown, field: ConfigFieldDefinition): string {
  if (field.isSecret && typeof value === "string") {
    return maskSecret(value);
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

function logConfigField(
  value: unknown,
  source: "cli" | "env" | "none",
  field: ConfigFieldDefinition
): void {
  // Skip fields with no value set (except auth fields which are always logged)
  if (value === undefined && !field.isAuth) return;
  if (value === undefined) return;

  const displayValue = formatValueForLog(value, field);
  console.log(`- ${field.envVar}: ${displayValue} (source: ${source})`);
}

// ============================================================================
// CLI Arguments Interface
// ============================================================================

interface CliArgs {
  "umbraco-base-url"?: string;
  "umbraco-tool-modes"?: string;
  "umbraco-include-tool-collections"?: string;
  "umbraco-exclude-tool-collections"?: string;
  "umbraco-include-slices"?: string;
  "umbraco-exclude-slices"?: string;
  "umbraco-include-tools"?: string;
  "umbraco-exclude-tools"?: string;
  "umbraco-allowed-media-paths"?: string;
  "umbraco-readonly"?: boolean;
  "disable-output-compatibility-mode"?: boolean;
  "umbraco-dry-run"?: boolean;
  "list-tools"?: boolean;
  "describe-tool"?: string;
  "generate-context"?: boolean;
  "debug-config"?: boolean;
  "call"?: string;
  "call-args"?: string;
  env?: string;
}

// ============================================================================
// Yargs CLI Parsing (lazy-loaded)
// ============================================================================

/**
 * Parse CLI arguments using yargs. Lazy-loaded to avoid bundling yargs
 * into Cloudflare Worker builds where its ESM shim crashes due to
 * import.meta.url being undefined in the Worker runtime.
 */
let parseCliArgs: ((allFields: ConfigFieldDefinition[]) => CliArgs) | undefined;

async function getCliArgs(allFields: ConfigFieldDefinition[]): Promise<CliArgs> {
  if (!parseCliArgs) {
    // Lazy-import yargs — this module is only needed in stdio/CLI mode,
    // never in Workers. The dynamic import ensures yargs's ESM shim
    // (which calls createRequire(import.meta.url) at module level) is
    // never evaluated in Worker builds where import.meta.url is undefined.
    // Use variable indirection to prevent esbuild/wrangler from statically
    // analyzing and bundling yargs (which crashes in Worker runtime)
    const yargsPath = "yargs";
    const helpersPath = "yargs/helpers";
    const yargsModule = await import(/* @vite-ignore */ yargsPath) as any;
    const helpersModule = await import(/* @vite-ignore */ helpersPath) as any;
    // yargs ESM exports: default is the factory function in yargs@17,
    // but in yargs@18 the default export may be nested differently
    const yargs = typeof yargsModule.default === "function"
      ? yargsModule.default
      : typeof yargsModule === "function"
        ? yargsModule
        : yargsModule.default?.default ?? yargsModule.default;
    const hideBin = helpersModule.hideBin ?? helpersModule.default?.hideBin;

    parseCliArgs = (fields: ConfigFieldDefinition[]) => {
      const yargsOptions: Record<string, { type: "string" | "boolean"; description: string; default?: boolean }> = {
        env: {
          type: "string",
          description: "Path to custom .env file to load environment variables from",
        },
        "list-tools": {
          type: "boolean",
          description: "Print table of all registered tools and exit",
          default: false,
        },
        "describe-tool": {
          type: "string",
          description: "Print full JSON Schema + metadata for a specific tool and exit",
        },
        "generate-context": {
          type: "boolean",
          description: "Generate CONTEXT.md to stdout and exit",
          default: false,
        },
        "debug-config": {
          type: "boolean",
          description: "Print resolved configuration (env vars, CLI flags, sources) and exit",
          default: false,
        },
        "call": {
          type: "string",
          description: "Call a tool by name, print the result as JSON, and exit",
        },
        "call-args": {
          type: "string",
          description: "JSON arguments for --call (default: {})",
        },
      };

      for (const field of fields) {
        if (!field.cliFlag) continue; // env-only fields (e.g. secrets)
        const yargsType = field.type === "boolean" ? "boolean" : "string";
        yargsOptions[field.cliFlag] = {
          type: yargsType,
          description: `${field.envVar} - ${field.type}${field.required ? " (required)" : ""}`,
          ...(field.type === "boolean" ? { default: false } : {}),
        };
      }

      return yargs(hideBin(process.argv))
        .options(yargsOptions)
        .help()
        .version(process.env.NPM_PACKAGE_VERSION ?? "unknown")
        .parseSync() as CliArgs;
    };
  }

  return parseCliArgs(allFields);
}

// ============================================================================
// Main Configuration Function
// ============================================================================

export interface GetServerConfigOptions {
  /** Additional config fields defined by the consuming package */
  additionalFields?: ConfigFieldDefinition[];
}

export interface GetServerConfigResult {
  /** Base Umbraco MCP configuration */
  config: UmbracoServerConfig;
  /** Custom config values from additionalFields - cast to your own interface */
  custom: Record<string, string | string[] | boolean | undefined>;
  /** CLI introspection flags (development-time only) */
  cliFlags: {
    listTools: boolean;
    describeTool?: string;
    generateContext: boolean;
    debugConfig: boolean;
    callTool?: string;
    callToolArgs?: string;
  };
}

export async function getServerConfig(
  isStdioMode: boolean,
  options: GetServerConfigOptions = {}
): Promise<GetServerConfigResult> {
  const { additionalFields = [] } = options;
  const allFields = [...CONFIG_FIELDS, ...additionalFields];

  // Parse command line arguments via lazy-loaded yargs
  const argv = await getCliArgs(allFields);

  // Load environment variables ASAP from custom path or default
  let envFilePath: string;
  let envFileSource: "cli" | "default";

  if (argv["env"]) {
    envFilePath = resolve(argv["env"]);
    envFileSource = "cli";
  } else {
    envFilePath = resolve(process.cwd(), ".env");
    envFileSource = "default";
  }

  // Override anything auto-loaded from .env if a custom file is provided.
  loadEnv({ path: envFilePath, override: true });

  // Initialize config structures
  const auth: UmbracoAuthConfig = {
    clientId: "",
    clientSecret: "",
    baseUrl: "",
  };

  const configSources: UmbracoServerConfig["configSources"] = {
    clientId: "env",
    clientSecret: "env",
    baseUrl: "env",
    toolModes: "none",
    includeToolCollections: "none",
    excludeToolCollections: "none",
    includeSlices: "none",
    excludeSlices: "none",
    includeTools: "none",
    excludeTools: "none",
    allowedMediaPaths: "none",
    readonly: "none",
    disableOutputCompatibilityMode: "none",
    dryRun: "none",
    envFile: envFileSource,
  };

  const config: Partial<Omit<UmbracoServerConfig, "auth" | "configSources">> = {};
  const custom: Record<string, string | string[] | boolean | undefined> = {};

  // Resolve all config fields using table-driven approach
  const resolvedValues: Record<string, ResolveResult> = {};

  // Process base CONFIG_FIELDS
  for (const field of CONFIG_FIELDS) {
    const result = resolveConfigField(argv, field);
    resolvedValues[field.name] = result;

    if (result.value !== undefined) {
      if (field.isAuth) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (auth as any)[field.name] = result.value;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (config as any)[field.name] = result.value;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (configSources as any)[field.name] = result.source;
    }
  }

  // Process additional fields into custom object
  for (const field of additionalFields) {
    const result = resolveConfigField(argv, field);
    resolvedValues[field.name] = result;
    custom[field.name] = result.value;
  }

  // Check if an introspection-only CLI flag is set (no server needed)
  const isIntrospectionOnly = !!(argv["list-tools"]) || !!(argv["describe-tool"]) || !!(argv["generate-context"]) || !!(argv["debug-config"]);

  // Validate required fields (both base and additional) — skip for introspection commands
  if (!isIntrospectionOnly) {
    for (const field of allFields.filter(f => f.required)) {
      const result = resolvedValues[field.name];
      if (!result?.value) {
        const hint = field.cliFlag
          ? `(via CLI argument --${field.cliFlag} or .env file)`
          : `(via environment variable or .env file)`;
        console.error(`${field.envVar} is required ${hint}`);
        process.exit(1);
      }
    }
  }

  // Log configuration sources
  if (!isStdioMode) {
    console.log("\nUmbraco MCP Configuration:");
    console.log(`- ENV_FILE: ${envFilePath} (source: ${configSources.envFile})`);

    for (const field of allFields) {
      const result = resolvedValues[field.name];
      logConfigField(result.value, result.source, field);
    }

    console.log(); // Empty line for better readability
  }

  // Auto-configure tool result mode from resolved config
  configureToolResultMode(config.disableOutputCompatibilityMode === true);

  // Auto-configure dry-run mode from resolved config
  configureDryRunMode(config.dryRun === true);

  return {
    config: {
      ...config,
      auth,
      configSources,
    },
    custom,
    cliFlags: {
      listTools: !!(argv["list-tools"]),
      describeTool: argv["describe-tool"],
      generateContext: !!(argv["generate-context"]),
      debugConfig: !!(argv["debug-config"]),
      callTool: argv["call"],
      callToolArgs: argv["call-args"],
    },
  };
}
