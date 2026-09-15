import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./tests", testMatch: "**/browser.spec.mjs", outputDir: "/tmp/leoblog-playwright-results", webServer: { command: "node tests/prepare-browser-dist.mjs", port: 4173, timeout: 120000 }, use: { baseURL: "http://127.0.0.1:4173" } });
