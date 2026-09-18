import viteReact from "@vitejs/plugin-react";
import os from "node:os";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Ceiling on how many test files run at once.
 *
 * The default is one worker per core minus one, and for this suite that
 * oversubscribes the machine: every worker builds its own jsdom and renders the
 * editor, so they compete for memory and CPU rather than for the CPUs alone.
 * Measured on an 8-core machine, alternating the two settings inside one
 * session because full-suite totals on this machine vary by a factor of three
 * between sessions and cross-session numbers proved nothing. The heaviest file,
 * `editor-style-inspector`, across two pairs:
 *
 *   default (7 workers)  46.1s   42.5s      suite total 135.6s   165.4s
 *   4 workers             30.4s    6.2s     suite total 206.6s   172.5s
 *
 * What reproduces is the per-file cost: every pair, in both orders, the heavy
 * jsdom files cost substantially less under the cap. What does not reproduce is
 * a total-time win — the suite total is a wash, and an earlier version of this
 * comment claimed otherwise from cross-session runs. The point of the cap is
 * that a file which costs 7s alone stops costing 46s in a run, because that gap
 * is where it goes red on work unrelated to what it asserts.
 *
 * It reduces the failures; it does not remove them. A capped run still failed
 * once here, on `local-vite-theme-build-runner`, whose 30s budget is an
 * assertion inside the test rather than a vitest timeout — so contention there
 * arrives looking like a product failure. That budget is now stated by that
 * file's own tests (correctness runs get a budget no build can reach; the guard
 * has its own test with a budget no machine can meet), so that particular
 * misattribution is gone rather than merely rarer.
 *
 * Expressed as `min(4, parallelism - 1)` rather than a flat 4 so that it can
 * only ever *reduce* concurrency: a machine with fewer cores keeps the behavior
 * it has today, and no machine gets more workers than it would have had. Checked
 * against the core counts — 1 -> 1, 4 -> 3 (unchanged), 8 -> 4, 16 -> 4 — so CI
 * on a 4-core runner is unaffected by this setting.
 *
 * `availableParallelism()` rather than `cpus().length` because Vitest resolves
 * its own default from the former and the two can disagree inside a
 * cgroup-limited container, where `cpus()` reports the host's cores and the
 * quota is smaller. Reading the number Vitest reads is what keeps the comparison
 * against the default exact; on this machine both are 8, so it changes nothing
 * here.
 */
const MAX_PARALLELISM = os.availableParallelism?.() ?? os.cpus().length;
const MAX_TEST_WORKERS = Math.max(1, Math.min(4, MAX_PARALLELISM - 1));

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
    maxWorkers: MAX_TEST_WORKERS,
    testTimeout: 20_000,
    // Setup work has the same problem: several suites build an in-memory
    // database per test.
    hookTimeout: 20_000,
  },
});
