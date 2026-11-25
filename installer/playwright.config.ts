import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:1431",
    channel:
      process.env.PLAYWRIGHT_CHANNEL ??
      (process.platform === "win32" ? "msedge" : undefined),
    headless: true,
    viewport: { width: 820, height: 620 },
  },
  webServer: {
    command:
      process.platform === "win32"
        ? "bun run build && bun x vite preview --host 127.0.0.1 --port 1431 --strictPort"
        : "bun run dev",
    url: "http://127.0.0.1:1431",
    reuseExistingServer: true,
  },
  reporter: "list",
});
