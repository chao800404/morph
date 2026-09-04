import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Tests run against their own config, not `vite.config.ts`.
 *
 * The app config loads the Cloudflare and TanStack Start plugins, which expect
 * a worker environment and a route tree. A unit test needs neither, and pulling
 * them in makes the run slow and fragile.
 */
export default defineConfig({
  plugins: [
    viteTsConfigPaths({ projects: ["./tsconfig.json"] }),
    viteReact(),
  ],
  resolve: {
    alias: {
      "cloudflare:workers": new URL(
        "./src/lib/test-utils/cloudflare-workers-stub.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    /**
     * Vitest defaults to 5s, and the slowest passing tests in this suite land
     * at 4.8-5.2s when the whole run competes for the machine. Sitting that
     * close to the limit made the run intermittently red with a different
     * case each time — every one of which passed in isolation — which costs
     * more than a slow failure does: a suite that is randomly red stops being
     * evidence of anything.
     *
     * This is headroom, not patience for hangs. It does not slow a passing
     * test down; it only changes how long a stuck one waits before failing.
     */
    testTimeout: 20_000,
    // Setup work has the same problem: several suites build an in-memory
    // database per test.
    hookTimeout: 20_000,
  },
});
