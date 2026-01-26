/**
 * Example Orval Configuration for Umbraco Management API
 *
 * Orval generates TypeScript API clients from OpenAPI specifications.
 * This example shows how to configure it for Umbraco's Management API.
 *
 * Setup:
 * 1. Install Orval: npm install -D orval
 * 2. Rename this file to umb-management-api.ts (remove .example)
 * 3. Update the target URL to your Umbraco instance
 * 4. Run: npx orval --config src/orval/umb-management-api.ts
 *
 * The SDK provides:
 * - UmbracoManagementClient: Pre-configured Orval mutator with OAuth auth
 * - orvalImportFixer: Hook to fix ESM imports in generated code
 */

import { defineConfig } from "orval";
import { orvalImportFixer } from "@umbraco-cms/mcp-server-sdk";

export const UmbManagementApiOrvalConfig = defineConfig({
  "umbraco-management-api": {
    input: {
      // Update this URL to your Umbraco instance
      target: "http://localhost:44391/umbraco/swagger/management/swagger.json",
      validation: false,
      // Optional: filter out specific endpoints
      // filters: {
      //   mode: "exclude",
      //   tags: ["Temporary File"],
      // },
    },
    output: {
      mode: "split",
      clean: true,
      target: "./src/api/umbracoManagementAPI",
      schemas: "./src/api/schemas",
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
      afterAllFilesWrite: orvalImportFixer,
    },
  },

  // Optional: Generate Zod schemas for runtime validation
  // "umbraco-management-api-zod": {
  //   input: {
  //     target: "http://localhost:44391/umbraco/swagger/management/swagger.json",
  //     validation: false,
  //   },
  //   output: {
  //     mode: "split",
  //     client: "zod",
  //     target: "./src/api/",
  //     fileExtension: ".zod.ts",
  //     override: {
  //       zod: {
  //         generate: {
  //           param: true,
  //           query: true,
  //           body: true,
  //           response: true,
  //         },
  //       },
  //     },
  //   },
  // },
});
