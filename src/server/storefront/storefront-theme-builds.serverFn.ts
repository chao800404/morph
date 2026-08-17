import { failure, ok } from "@/lib/db/server-result";
import { createServerThemeBuildService } from "@/lib/storefront/service/theme-build-service.factory";
import {
  createStorefrontThemeBuildInputSchema,
  getStorefrontThemeBuildInputSchema,
  listStorefrontThemeBuildsInputSchema,
} from "@/lib/validations/storefront-theme-build";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const createPreviewBuild = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    createStorefrontThemeBuildInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const service = createServerThemeBuildService();
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
      const service = createServerThemeBuildService();
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
        "BUILD_GET_FAILED",
        "Failed to get theme build",
      );
    }
  });

export const listThemeBuilds = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    listStorefrontThemeBuildsInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const service = createServerThemeBuildService();
      const builds = await service.listThemeBuilds({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        limit: data.limit,
        offset: data.offset,
      });
      return ok("Theme builds retrieved", builds);
    } catch (error) {
      return failure(
        "List theme builds error",
        error,
        "BUILD_LIST_FAILED",
        "Failed to list theme builds",
      );
    }
  });
