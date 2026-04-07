import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: {
      args: ["--ignore-certificate-errors"],
    },
  },
  projects: [
    {
      name: "e2e",
      testMatch: "**/*.test.ts",
    },
  ],
});
