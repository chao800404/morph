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
    /**
     * Pinned, because without it the suite reads the machine's own preference.
     * The theme provider follows `prefers-color-scheme`, and Playwright
     * inherits the OS setting when none is given — so the same commit scanned
     * a dark editor on one developer's laptop and a light one on CI, and a
     * contrast failure that only exists in light mode looked like a flake for
     * two runs. Light is the stricter of the two here; the accessibility spec
     * scans the other deliberately.
     */
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    /**
     * Which transport served the preview, checked before anything uses it.
     *
     * A precondition rather than a test: the editor specs cannot tell one
     * transport from another, so a run that quietly fell back to the container
     * would pass every one of them and prove nothing about the sidecar it was
     * set up to exercise. As `editor`'s dependency, a wrong transport stops the
     * suite instead of adding a red line to a wall of green.
     */
    {
      name: "preview-transport",
      testMatch: /preview-transport\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 950 },
        storageState: "e2e/.auth/user.json",
      },
    },
    {
      name: "editor",
      dependencies: ["setup", "preview-transport"],
      // Its own project runs it as this one's precondition; without this it
      // would also run here, after the specs it exists to gate.
      testIgnore: /preview-transport\.spec\.ts/,
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
