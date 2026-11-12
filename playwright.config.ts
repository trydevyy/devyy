import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:1420",
    channel: "chrome",
    headless: true,
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:1420",
          localStorage: [{ name: "devyy.setupCompleted", value: "true" }],
        },
      ],
    },
    viewport: { width: 1440, height: 940 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: true,
  },
  reporter: "list",
});
