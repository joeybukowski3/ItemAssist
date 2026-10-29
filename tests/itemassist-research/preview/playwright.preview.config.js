const path = require("path");
const { defineConfig, devices } = require("@playwright/test");
const { resolvePreviewTarget, LOCAL_PORT } = require("./preview-target.js");

// Hosted-Preview run: PREVIEW_URL=https://<deployment>.vercel.app  (optionally VERCEL_AUTOMATION_BYPASS_SECRET for a protected Preview).
// Self-test with no deployment: PREVIEW_LOCAL=1, which serves the repository from the local static server instead.
// Every research and classic API call is mocked in the browser, so no backend, Redis or provider is needed or contacted.
const target = resolvePreviewTarget();
const STATIC_SERVER = path.resolve(__dirname, "../../request-intake/e2e/static-server.mjs");

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: "preview-*.spec.js",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: target.baseURL,
    serviceWorkers: "block",
    // A trace records request headers, which would include the bypass secret. Never record one.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure"
  },
  ...(target.local ? {
    webServer: { command: `node "${STATIC_SERVER}"`, port: LOCAL_PORT, reuseExistingServer: false, env: { STATIC_SERVER_PORT: String(LOCAL_PORT) } }
  } : {}),
  projects: [
    { name: "preview-mobile-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
    { name: "preview-tablet-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
    { name: "preview-desktop-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }
  ]
});
