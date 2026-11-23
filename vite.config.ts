import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import react from "@vitejs/plugin-react";
let revision = "local";
try {
  revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {}
export default defineConfig({
  define: {
    __DEVYY_BUILD__: JSON.stringify({
      builtAt: String(Math.floor(Date.now() / 1000)),
      revision,
    }),
  },
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2022",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /\/node_modules\/(react|react-dom)\// },
            { name: "editor", test: /\/node_modules\/@codemirror\// },
          ],
        },
      },
    },
  },
});
