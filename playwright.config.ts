import { defineConfig, devices } from "@playwright/test";

// Credentials live in an untracked `.env.e2e`, never in this repository and
// never on a command line, where they would end up in shell history.
try {
  process.loadEnvFile(".env.e2e");
} catch {
  // Absent is the normal case: every test then skips itself.
}

/**
 * Browser-layer tests, deliberately separate from the unit suite.
 *
 * `pnpm test` runs in jsdom, which has no layout, no real pointer and no
 * cross-frame messaging — the three things the editor's hardest defects live
 * in. These run against a real browser and a real dev server instead, so they
 * are slower by an order of magnitude and are not part of `pnpm test`.
 */
/**
 * Extra engines to run, as a comma separated list: `E2E_BROWSERS=firefox,webkit`.
 *
 * Chromium always runs. The others are opt-in because they each need system
 * libraries this host may not have — WebKit in particular wants the whole
 * GTK and GStreamer stack.
 */
const CROSS_BROWSER = (process.env.E2E_BROWSERS ?? "")
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

export default defineConfig({
  testDir: "./e2e",
  // A browser test that races itself is worse than no test: failures stop
  // meaning anything. One worker, no retries, generous per-action timeouts.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "line" : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "editor",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 950 },
        storageState: "e2e/.auth/user.json",
      },
    },
    // Off by default: each engine needs its own system libraries, and a suite
    // that fails because a browser is missing teaches nobody anything. Turn
    // them on per engine once the host can run them.
    ...(CROSS_BROWSER.includes("firefox")
      ? [
          {
            name: "editor-firefox",
            dependencies: ["setup"],
            use: {
              ...devices["Desktop Firefox"],
              viewport: { width: 1600, height: 950 },
              storageState: "e2e/.auth/user.json",
            },
          },
        ]
      : []),
    ...(CROSS_BROWSER.includes("webkit")
      ? [
          {
            name: "editor-webkit",
            dependencies: ["setup"],
            use: {
              ...devices["Desktop Safari"],
              viewport: { width: 1600, height: 950 },
              storageState: "e2e/.auth/user.json",
            },
          },
        ]
      : []),
  ],
  webServer: {
    command: "pnpm run dev",
    url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    // Never starts a second dev server on top of the one being worked in:
    // two Vite processes sharing `node_modules/.vite` corrupt each other.
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
