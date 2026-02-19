import { defineConfig } from "orval";
import { orvalImportFixer } from "@umbraco-cms/mcp-server-sdk";

/**
 * Orval Configuration
 *
 * This generates TypeScript API clients from OpenAPI specs.
 *
 * The template includes a sample OpenAPI spec (src/umbraco-api/api/openapi.yaml) that
 * demonstrates the patterns. Replace it with your add-on's spec.
 *
 * Example OpenAPI spec sources:
 * - Local file: "./src/umbraco-api/api/openapi.yaml"
 * - Local Umbraco: "http://localhost:44391/umbraco/swagger/management/swagger.json"
 * - Remote URL: "https://api.example.com/swagger.json"
 */
export default defineConfig({
  // Main API client generation
  exampleApi: {
    input: {
      // Use the included example OpenAPI spec
      // Replace with your add-on's spec path or URL
      target: "./src/umbraco-api/api/openapi.yaml",
      validation: false,
    },
    output: {
      target: "./src/umbraco-api/api/generated/exampleApi.ts",
      client: "axios",
      mode: "single",
      clean: false,
      override: {
        mutator: {
          path: "./src/umbraco-api/api/client.ts",
          name: "customInstance",
        },
      },
    },
    hooks: {
      afterAllFilesWrite: orvalImportFixer,
    },
  },

  // Zod schema generation for validation
  exampleApiZod: {
    input: {
      target: "./src/umbraco-api/api/openapi.yaml",
      validation: false,
    },
    output: {
      target: "./src/umbraco-api/api/generated/exampleApi.zod.ts",
      client: "zod",
      mode: "single",
      clean: false,
    },
  },
});
