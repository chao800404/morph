import { env } from "cloudflare:workers";
import { failure, ok } from "@/lib/db/server-result";
import { CloudflareR2ThemeBuildArtifactStore } from "@/lib/storefront/compiler/cloudflare-r2-theme-build-artifact-store";
import { CloudflareSandboxViteThemeBuildRunner } from "@/lib/storefront/compiler/cloudflare-sandbox-vite-theme-build-runner";
import type { ThemeBuildArtifactStore } from "@/lib/storefront/compiler/theme-build-artifact-store.types";
import { materializeThemeBuildInput } from "@/lib/storefront/compiler/theme-build-materializer";
import type { ThemeBuildRunner } from "@/lib/storefront/compiler/theme-build-runner.types";
import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import { ThemeBuildService } from "@/lib/storefront/service/theme-build.service";
import {
  createStorefrontThemeBuildInputSchema,
  getStorefrontThemeBuildInputSchema,
  listStorefrontThemeBuildsInputSchema,
} from "@/lib/validations/storefront-theme-build";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export function getServerThemeBuildService(options?: {
  runner?: ThemeBuildRunner;
  artifactStore?: ThemeBuildArtifactStore;
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
  );
}




export const createPreviewBuild = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    createStorefrontThemeBuildInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const service = getServerThemeBuildService();
      const build = await service.requestPreviewBuild({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        sourceRevisionId: data.sourceRevisionId,
        createdBy: context.session?.user?.id,
      });
      return ok("Theme build created", build);
    } catch (error) {
      return failure(
        "Create theme build error",
        error,
        "BUILD_CREATE_FAILED",
        "Failed to create theme build",
      );
    }
  });


export const getThemeBuild = createServerFn({ method: "POST" })
  .validator((data: unknown) => getStorefrontThemeBuildInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const service = getServerThemeBuildService();
      const build = await service.getThemeBuild({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        buildId: data.buildId,
      });
      if (!build) {
        return failure(
          "Get theme build error",
          new Error("Theme build not found"),
          "NOT_FOUND",
          "Theme build not found",
        );
      }
      return ok("Theme build retrieved", build);
    } catch (error) {
      return failure(
        "Get theme build error",
        error,
        "GET_FAILED",
        "Failed to get theme build",
      );
    }
  });

export const listThemeBuilds = createServerFn({ method: "POST" })
  .validator((data: unknown) => listStorefrontThemeBuildsInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const service = getServerThemeBuildService();
      const builds = await service.listThemeBuilds({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        limit: data.limit,
        offset: data.offset,
      });
      return ok("Theme builds listed", builds);
    } catch (error) {
      return failure(
        "List theme builds error",
        error,
        "LIST_FAILED",
        "Failed to list theme builds",
      );
    }
  });

