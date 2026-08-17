import { env } from "cloudflare:workers";
import { CloudflareR2ThemeBuildArtifactStore } from "@/lib/storefront/compiler/cloudflare-r2-theme-build-artifact-store";
import { CloudflareSandboxViteThemeBuildRunner } from "@/lib/storefront/compiler/cloudflare-sandbox-vite-theme-build-runner";
import type { ThemeBuildArtifactStore } from "@/lib/storefront/compiler/theme-build-artifact-store.types";
import { materializeThemeBuildInput } from "@/lib/storefront/compiler/theme-build-materializer";
import type { ThemeBuildRunner } from "@/lib/storefront/compiler/theme-build-runner.types";
import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import { themeRevisionStore } from "@/lib/storefront/storage/theme-storage.server";
import type { ThemeRevisionStore } from "@/lib/storefront/storage/theme-storage.types";
import { ThemeBuildService } from "./theme-build.service";

/**
 * Server composition root for ThemeBuildService.
 *
 * Storage implementation selection is centralized behind the generic server
 * storage composition module so future source revision backends can be swapped
 * without changing BuildService callers.
 */
export function createServerThemeBuildService(options?: {
  runner?: ThemeBuildRunner;
  artifactStore?: ThemeBuildArtifactStore;
  revisionStore?: ThemeRevisionStore;
}): ThemeBuildService {
  let runner = options?.runner;
  let artifactStore = options?.artifactStore;

  if (
    runner === undefined &&
    artifactStore === undefined &&
    (env as any)?.Sandbox &&
    (env as any)?.R2_BUCKET
  ) {
    runner = new CloudflareSandboxViteThemeBuildRunner({
      sandboxBinding: (env as any).Sandbox,
    });
    artifactStore = new CloudflareR2ThemeBuildArtifactStore({
      r2Bucket: (env as any).R2_BUCKET,
    });
  }

  return new ThemeBuildService(
    storefrontThemeBuildDal,
    runner,
    materializeThemeBuildInput,
    artifactStore,
    options?.revisionStore ?? themeRevisionStore,
  );
}
