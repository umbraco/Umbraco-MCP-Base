/**
 * Example Orval Configuration for the Umbraco Management API
 *
 * Orval generates TypeScript API clients from OpenAPI specifications.
 * This example shows a full orval 8 setup for Umbraco's Management API,
 * including the workarounds Umbraco's spec needs.
 *
 * Setup:
 * 1. Install Orval: npm install -D orval
 * 2. Rename this file to umb-management-api.ts (remove .example)
 * 3. Point orval.config.ts at this config
 * 4. Set SPEC_URL below (or the UMBRACO_OPENAPI_SPEC env var) for your instance
 * 5. Run: npm run generate
 *
 * The SDK provides:
 * - UmbracoManagementClient: pre-configured Orval mutator with OAuth auth
 * - orvalImportFixer: hook to fix ESM imports in generated code
 *
 * SDK helpers used here:
 * - relaxUntypedArrays: input transformer for Umbraco's untyped-array schemas
 * - postProcessZodFiles: keeps the generated zod surface stable across orval 7 -> 8
 */

import { defineConfig, type HookFunction } from "orval";
import {
  orvalImportFixer,
  relaxUntypedArrays,
  postProcessZodFiles,
} from "@umbraco-cms/mcp-server-sdk";

/**
 * OpenAPI spec URL for your Umbraco instance. The path differs by Umbraco version:
 *   Umbraco 18+: /umbraco/openapi/management.json   (Microsoft.AspNetCore.OpenApi)
 *   Umbraco 17:  /umbraco/swagger/management/swagger.json   (Swashbuckle)
 * Set the UMBRACO_OPENAPI_SPEC env var to point at either, or edit the default.
 */
const SPEC_URL =
  process.env.UMBRACO_OPENAPI_SPEC ??
  "http://localhost:44391/umbraco/openapi/management.json";

export const UmbManagementApiOrvalConfig = defineConfig({
  "umbraco-management-api": {
    input: {
      target: SPEC_URL,
      unsafeDisableValidation: true,
      override: {
        transformer: relaxUntypedArrays,
      },
      // Optional: filter out specific endpoints
      // filters: {
      //   mode: "exclude",
      //   tags: ["Temporary File"],
      // },
    },
    output: {
      mode: "split",
      clean: true,
      target: "./src/umbraco-api/api/umbracoManagementAPI",
      schemas: "./src/umbraco-api/api/schemas",
      client: "axios",
      override: {
        mutator: {
          // Use the SDK's pre-configured mutator
          path: "@umbraco-cms/mcp-server-sdk",
          name: "UmbracoManagementClient",
        },
      },
    },
    hooks: {
      // Fix ESM imports in generated files
      afterAllFilesWrite: orvalImportFixer as HookFunction,
    },
  },

  // Generate Zod schemas for runtime validation
  "umbraco-management-api-zod": {
    input: {
      target: SPEC_URL,
      unsafeDisableValidation: true,
      override: {
        transformer: relaxUntypedArrays,
      },
    },
    output: {
      mode: "split",
      client: "zod",
      target: "./src/umbraco-api/api/",
      fileExtension: ".zod.ts",
      override: {
        zod: {
          dateTimeOptions: {
            local: true,
            offset: true,
          },
          coerce: {
            query: ["number", "boolean"],
          },
          generate: {
            param: true,
            query: true,
            header: true,
            body: true,
            response: true,
          },
        },
      },
    },
    hooks: {
      // Keep the generated zod surface stable across the orval 7 -> 8 upgrade.
      afterAllFilesWrite: postProcessZodFiles as HookFunction,
    },
  },
});
