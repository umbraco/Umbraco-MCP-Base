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
    // Cloud (and Cloudflare in general) reject Playwright traffic by sniffing
    // the User-Agent and Client Hints headers. Spoof both so the login
    // endpoint accepts the request.
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "sec-ch-ua":
        '"Chromium";v="145", "Not:A-Brand";v="99", "Google Chrome";v="145"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    },
    launchOptions: {
      args: [
        "--ignore-certificate-errors",
        // Hide `navigator.webdriver` from automation detection.
        "--disable-blink-features=AutomationControlled",
      ],
    },
  },
  projects: [
    {
      name: "e2e",
      testMatch: "**/*.test.ts",
    },
  ],
});
