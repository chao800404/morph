import { CloudflareSandboxViteThemeBuildRunner } from "./cloudflare-sandbox-vite-theme-build-runner";
import { LocalViteThemeBuildRunner } from "./local-vite-theme-build-runner";

export { LocalViteThemeBuildRunner, CloudflareSandboxViteThemeBuildRunner };

/**
 * Alias for backward compatibility / local test execution.
 */
export const SandboxViteThemeBuildRunner = LocalViteThemeBuildRunner;
export type SandboxViteThemeBuildRunner = LocalViteThemeBuildRunner;
