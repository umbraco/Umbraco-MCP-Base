import { defineConfig } from "orval";

/**
 * Orval Configuration
 *
 * This generates TypeScript API clients from OpenAPI specs.
 *
 * The template includes a sample OpenAPI spec (src/api/openapi.yaml) that
 * demonstrates the patterns. Replace it with your add-on's spec.
 *
 * Example OpenAPI spec sources:
 * - Local file: "./src/api/openapi.yaml"
 * - Local Umbraco: "http://localhost:44391/umbraco/swagger/management/swagger.json"
 * - Remote URL: "https://api.example.com/swagger.json"
 */
export default defineConfig({
  // Main API client generation
  exampleApi: {
    input: {
      // Use the included example OpenAPI spec
      // Replace with your add-on's spec path or URL
      target: "./src/api/openapi.yaml",
      validation: false,
    },
    output: {
      target: "./src/api/generated/exampleApi.ts",
      client: "axios",
      mode: "single",
      clean: false,
      override: {
        mutator: {
          path: "./src/api/client.ts",
          name: "customInstance",
        },
      },
    },
  },

  // Zod schema generation for validation
  exampleApiZod: {
    input: {
      target: "./src/api/openapi.yaml",
      validation: false,
    },
    output: {
      target: "./src/api/generated/exampleApi.zod.ts",
      client: "zod",
      mode: "single",
      clean: false,
    },
  },
});
