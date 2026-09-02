import { env } from "cloudflare:workers";
import { failure, ok } from "@/lib/db/server-result";
import {
  generatePreviewCapabilityToken,
  resolveThemePreviewSecret,
} from "@/lib/storefront/service/theme-build-preview-token";

import { createServerThemeBuildService } from "@/lib/storefront/service/theme-build-service.factory";
import { storefrontThemeDependencyDal } from "@/lib/storefront/dal/storefront-theme-dependency.dal";
import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import {
  createThemeBuildQueueMessage,
  type ThemeBuildQueue,
} from "@/lib/storefront/service/theme-build-queue";
import {
  getThemeDependencyCatalog,
  themePackageRoot,
  validateThemeDependencySelection,
} from "@/lib/storefront/compiler/theme-dependency-policy";
import {
  createStorefrontThemeBuildInputSchema,
  getStorefrontThemeBuildInputSchema,
  listStorefrontThemeBuildsInputSchema,
  listStorefrontThemeDependenciesInputSchema,
  requestStorefrontThemeDependencyInputSchema,
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
      const { cmsConfig } = await import("@/cms.config");
      const service = createServerThemeBuildService();
      const queue = (env as unknown as { THEME_BUILD_QUEUE?: ThemeBuildQueue })
        .THEME_BUILD_QUEUE;
      const dependencyErrors = validateThemeDependencySelection(
        data.dependencies,
        cmsConfig.theme?.dependencies,
      );
      if (dependencyErrors.length > 0) {
        return failure(
          "Create theme build error",
          new Error(dependencyErrors.join(" ")),
          "DEPENDENCY_NOT_APPROVED",
          "The requested theme dependency is not approved by the platform",
        );
      }
      const build = await service.requestPreviewBuild({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        sourceRevisionId: data.sourceRevisionId,
        createdBy: context.session?.user?.id,
        dependencies: data.dependencies,
        deferExecution: Boolean(queue),
      });

      if (queue && build.status === "queued") {
        try {
          await queue.send(
            createThemeBuildQueueMessage({
              storefrontId: build.storefrontId,
              themeId: build.themeId,
              buildId: build.id,
            }),
          );
        } catch (queueError) {
          const message =
            queueError instanceof Error
              ? queueError.message
              : String(queueError);
          await storefrontThemeBuildDal.markBuildFailed(
            build.storefrontId,
            build.themeId,
            build.id,
            { errorMessage: `Queue enqueue failed: ${message}` },
          );
          throw queueError;
        }
      }

      let previewToken: string | undefined;
      if (build.status === "succeeded") {
        const secret = resolveThemePreviewSecret(undefined, env);
        previewToken = await generatePreviewCapabilityToken(
          {
            buildId: build.id,
            storefrontId: build.storefrontId,
            themeId: build.themeId,
          },
          secret,
        );
      }

      return ok("Theme build created", { ...build, previewToken });
    } catch (error) {
      return failure(
        "Create theme build error",
        error,
        "BUILD_CREATE_FAILED",
        "Failed to create theme build",
      );
    }
  });

/**
 * Returns the platform-approved catalog and the tenant's current request
 * state.  Package versions come only from cms.config; the browser cannot
 * submit an arbitrary npm version.
 */
export const listThemeDependencies = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    listStorefrontThemeDependenciesInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const { cmsConfig } = await import("@/cms.config");
      const dependencies = await storefrontThemeDependencyDal.list(
        data.storefrontId,
        data.themeId,
      );
      return ok("Theme dependency catalog retrieved", {
        catalog: getThemeDependencyCatalog(cmsConfig.theme?.dependencies),
        dependencies,
      });
    } catch (error) {
      return failure(
        "List theme dependencies error",
        error,
        "DEPENDENCY_LIST_FAILED",
        "Failed to list theme dependencies",
      );
    }
  });

/** Enable one approved package and queue a build that proves it is usable. */
export const requestThemeDependency = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    requestStorefrontThemeDependencyInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const { cmsConfig } = await import("@/cms.config");
      const approved = cmsConfig.theme?.dependencies ?? {};
      const packageName = themePackageRoot(data.packageName);
      const catalogItem = getThemeDependencyCatalog(approved).find(
        (item) => item.root === packageName,
      );
      if (!catalogItem) {
        return failure(
          "Request theme dependency error",
          new Error(`Package ${data.packageName} is not approved`),
          "DEPENDENCY_NOT_APPROVED",
          "This package is not approved in cms.config.ts",
        );
      }

      const existingRows = await storefrontThemeDependencyDal.list(
        data.storefrontId,
        data.themeId,
      );
      const selected = Object.fromEntries(
        existingRows
          .filter((row) => row.status !== "rejected")
          .map((row) => [row.packageName, row.packageVersion]),
      );
      selected[packageName] = catalogItem.version;
      const dependencyErrors = validateThemeDependencySelection(
        selected,
        approved,
      );
      if (dependencyErrors.length > 0) {
        return failure(
          "Request theme dependency error",
          new Error(dependencyErrors.join(" ")),
          "DEPENDENCY_NOT_APPROVED",
          "The requested theme dependency is not approved by the platform",
        );
      }

      const dependency = await storefrontThemeDependencyDal.upsertRequested({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        packageName,
        packageVersion: catalogItem.version,
        requestedBy: context.session?.user?.id,
      });

      const queue = (env as unknown as { THEME_BUILD_QUEUE?: ThemeBuildQueue })
        .THEME_BUILD_QUEUE;
      const service = createServerThemeBuildService();
      const build = await service.requestPreviewBuild({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        sourceRevisionId: data.sourceRevisionId,
        createdBy: context.session?.user?.id,
        dependencies: selected,
        deferExecution: Boolean(queue),
      });
      await storefrontThemeDependencyDal.markBuilding({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        packageName,
        buildId: build.id,
      });

      if (queue && build.status === "queued") {
        try {
          await queue.send(
            createThemeBuildQueueMessage({
              storefrontId: build.storefrontId,
              themeId: build.themeId,
              buildId: build.id,
            }),
          );
        } catch (queueError) {
          const message =
            queueError instanceof Error
              ? queueError.message
              : String(queueError);
          await storefrontThemeDependencyDal.markBuildResult(
            build.id,
            "failed",
            `Queue enqueue failed: ${message}`,
          );
          await storefrontThemeBuildDal.markBuildFailed(
            build.storefrontId,
            build.themeId,
            build.id,
            { errorMessage: `Queue enqueue failed: ${message}` },
          );
          throw queueError;
        }
      } else if (build.status === "queued") {
        // Local/dev deployments without a Queue binding keep the request
        // visible as pending instead of claiming that the package failed.
        await storefrontThemeDependencyDal.markRequested({
          storefrontId: data.storefrontId,
          themeId: data.themeId,
          packageName,
        });
      } else {
        await storefrontThemeDependencyDal.markBuildResult(
          build.id,
          build.status === "succeeded" ? "ready" : "failed",
          build.errorMessage ?? undefined,
        );
      }

      const latest = await storefrontThemeDependencyDal.get(
        data.storefrontId,
        data.themeId,
        packageName,
      );
      return ok("Theme dependency build requested", {
        dependency: latest ?? dependency,
        build,
      });
    } catch (error) {
      return failure(
        "Request theme dependency error",
        error,
        "DEPENDENCY_REQUEST_FAILED",
        "Failed to request theme dependency",
      );
    }
  });

export const getPreviewBuildToken = createServerFn({ method: "POST" })
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
      if (!build || build.status !== "succeeded") {
        return failure(
          "Get preview token error",
          new Error("Theme build not found or not in succeeded state"),
          "NOT_FOUND",
          "Theme build not found or not in succeeded state",
        );
      }
      const secret = resolveThemePreviewSecret(undefined, env);
      const token = await generatePreviewCapabilityToken(
        {
          buildId: build.id,
          storefrontId: build.storefrontId,
          themeId: build.themeId,
        },
        secret,
      );

      return ok("Preview token generated", { token, buildId: build.id });
    } catch (error) {
      return failure(
        "Generate preview token error",
        error,
        "TOKEN_GENERATE_FAILED",
        "Failed to generate preview capability token",
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

/**
 * Cancels a build that has not finished.
 *
 * Ownership is enforced by the same storefront/theme scoping every other build
 * function uses: a build id alone never authorises the action, so a build
 * belonging to another storefront reads as not found rather than being
 * cancellable by id.
 */
export const cancelThemeBuild = createServerFn({ method: "POST" })
  .validator((data: unknown) => getStorefrontThemeBuildInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const service = createServerThemeBuildService();
      const result = await service.cancelBuild({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        buildId: data.buildId,
      });
      // A build that finished first is not an error: the caller asked to stop
      // work that turned out to be already done.
      return ok(
        result.cancelled
          ? "Theme build cancelled"
          : `Theme build already ${result.build.status}`,
        result,
      );
    } catch (error) {
      return failure(
        "Cancel theme build error",
        error,
        "BUILD_CANCEL_FAILED",
        "Failed to cancel theme build",
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
