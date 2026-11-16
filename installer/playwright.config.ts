import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:1431",
    channel: "chrome",
    headless: true,
    viewport: { width: 820, height: 620 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1431",
    reuseExistingServer: true,
  },
  reporter: "list",
});
