import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    ignoreHTTPSErrors: true,
    launchOptions: {
      slowMo: process.env.SLOW_MO ? Number(process.env.SLOW_MO) : 0,
    },
  },
  projects: [
    {
      name: "chained-e2e",
      testMatch: "**/*.test.ts",
    },
  ],
});
