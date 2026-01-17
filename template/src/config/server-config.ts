/**
 * Server Configuration
 *
 * This module demonstrates how to extend the base Umbraco MCP config
 * with custom configuration fields specific to your MCP server.
 *
 * Custom fields support:
 * - string: Simple string values
 * - boolean: True/false flags
 * - csv: Comma-separated values parsed into arrays
 * - csv-path: Comma-separated paths, resolved to absolute paths
 */

import {
  getServerConfig,
  type ConfigFieldDefinition,
  type UmbracoServerConfig,
} from "@umbraco-cms/mcp-server-sdk";

// ============================================================================
// Custom Config Interface
// ============================================================================

/**
 * Custom configuration specific to this MCP server.
 * Define your own fields here - they will be parsed from CLI args or env vars.
 */
export interface MyServerCustomConfig {
  /** Disable MCP server chaining (useful for testing or isolated deployments) */
  disableMcpChaining?: boolean;
  /** Enable experimental features */
  experimentalFeatures?: boolean;
  /** Custom API endpoints to enable */
  customEndpoints?: string[];
  /** External service API key */
  externalApiKey?: string;
  /** Maximum items per page for list operations */
  maxPageSize?: string;
}

// ============================================================================
// Custom Field Definitions
// ============================================================================

/**
 * Define additional config fields for this server.
 * Each field automatically gets:
 * - A CLI argument (--my-experimental-features)
 * - An environment variable (MY_EXPERIMENTAL_FEATURES)
 * - Automatic parsing based on type
 */
const customFields: ConfigFieldDefinition[] = [
  {
    name: "disableMcpChaining",
    envVar: "DISABLE_MCP_CHAINING",
    cliFlag: "disable-mcp-chaining",
    type: "boolean",
  },
  {
    name: "experimentalFeatures",
    envVar: "MY_EXPERIMENTAL_FEATURES",
    cliFlag: "my-experimental-features",
    type: "boolean",
  },
  {
    name: "customEndpoints",
    envVar: "MY_CUSTOM_ENDPOINTS",
    cliFlag: "my-custom-endpoints",
    type: "csv",
  },
  {
    name: "externalApiKey",
    envVar: "MY_EXTERNAL_API_KEY",
    cliFlag: "my-external-api-key",
    type: "string",
  },
  {
    name: "maxPageSize",
    envVar: "MY_MAX_PAGE_SIZE",
    cliFlag: "my-max-page-size",
    type: "string",
  },
];

// ============================================================================
// Config Loading
// ============================================================================

export interface ServerConfig {
  /** Base Umbraco MCP configuration */
  umbraco: UmbracoServerConfig;
  /** Custom configuration for this server */
  custom: MyServerCustomConfig;
}

let cachedConfig: ServerConfig | null = null;

/**
 * Load server configuration from CLI arguments and environment variables.
 *
 * @param isStdioMode - Whether the server is running in stdio mode (suppresses logging)
 * @returns Combined base and custom configuration
 *
 * @example
 * ```typescript
 * const { umbraco, custom } = loadServerConfig(true);
 *
 * // Access base Umbraco config
 * console.log(umbraco.auth.baseUrl);
 * console.log(umbraco.readonly);
 *
 * // Access custom config
 * if (custom.experimentalFeatures) {
 *   enableExperimentalFeatures();
 * }
 * ```
 */
export function loadServerConfig(isStdioMode: boolean): ServerConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const { config, custom } = getServerConfig(isStdioMode, {
    additionalFields: customFields,
  });

  cachedConfig = {
    umbraco: config,
    custom: custom as MyServerCustomConfig,
  };

  return cachedConfig;
}

/**
 * Clear cached config (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get the custom field definitions (useful for testing/documentation)
 */
export function getCustomFieldDefinitions(): ConfigFieldDefinition[] {
  return [...customFields];
}
