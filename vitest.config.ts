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
  },
});
