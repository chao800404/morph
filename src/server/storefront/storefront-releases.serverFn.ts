import { env } from "cloudflare:workers";
import { fail, failure, ok } from "@/lib/db/server-result";
import { storefrontReleaseDal } from "@/lib/storefront/dal/storefront-release.dal";
import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import { activateReleaseWithDeployment } from "@/lib/storefront/service/storefront-release-reconciler";
import { createServerThemeWorkerDeployer } from "@/lib/storefront/service/theme-worker-deployer.factory";
import {
  activateStorefrontReleaseInputSchema,
  storefrontReleaseHistoryInputSchema,
} from "@/lib/validations/storefront-release";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const listStorefrontReleaseHistory = createServerFn({ method: "POST" })
  .validator((data: unknown) => storefrontReleaseHistoryInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      return ok(
        "Storefront release history fetched",
        await storefrontReleaseDal.listHistory(data.storefrontId, data),
      );
    } catch (error) {
      return failure(
        "List storefront release history error",
        error,
        "GET_FAILED",
        "Failed to fetch storefront release history",
      );
    }
  });

export const activateStorefrontRelease = createServerFn({ method: "POST" })
  .validator((data: unknown) => activateStorefrontReleaseInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      // Activation claims the release through the same CAS as before, then
      // deploys its immutable artifact. Both steps live in the reconciler so a
      // release can never be reported active without the matching Theme Worker.
      const result = await activateReleaseWithDeployment({
        releaseId: data.releaseId,
        expectedActiveReleaseId: data.expectedActiveReleaseId,
        deployer: createServerThemeWorkerDeployer(),
        r2Bucket: (env as unknown as { R2_BUCKET?: unknown }).R2_BUCKET as never,
        ports: {
          getRelease: async (releaseId) => {
            const release = await storefrontReleaseDal.getById(
              data.storefrontId,
              releaseId,
            );
            return release
              ? {
                  id: release.id,
                  storefrontId: data.storefrontId,
                  themeId: release.themeId,
                  themeBuildId: release.themeBuildId,
                }
              : null;
          },
          getBuild: (buildId) => storefrontThemeBuildDal.getBuildById(buildId),
          activateRelease: (args) => storefrontReleaseDal.activateRelease(args),
        },
      });

      if (!result.success) {
        if (result.reason === "ACTIVATION_CONFLICT") {
          return fail(
            "Another release was activated. Refresh release history before retrying.",
            { error: "RELEASE_ACTIVATION_CONFLICT" },
          );
        }
        if (
          result.reason === "RELEASE_NOT_FOUND" ||
          result.reason === "BUILD_NOT_DEPLOYABLE" ||
          result.reason === "PLAN_REJECTED" ||
          result.reason === "WORKER_CONFIG_UNREADABLE"
        ) {
          return fail(result.message, { error: "RELEASE_NOT_ACTIVATABLE" });
        }
        return fail(
          result.deploymentDrift
            ? `${result.message} The active release no longer matches the deployed Theme Worker and must be reconciled.`
            : result.message,
          { error: "RELEASE_DEPLOYMENT_FAILED" },
        );
      }

      const release = await storefrontReleaseDal.getById(
        data.storefrontId,
        result.releaseId,
      );
      return ok("Storefront release activated", release);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("RELEASE_ACTIVATION_CONFLICT")) {
        return fail(
          "Another release was activated. Refresh release history before retrying.",
          { error: "RELEASE_ACTIVATION_CONFLICT" },
        );
      }
      if (message.includes("RELEASE_NOT_ACTIVATABLE")) {
        return fail(
          "The selected release is not activatable.",
          { error: "RELEASE_NOT_ACTIVATABLE" },
        );
      }
      return failure(
        "Activate storefront release error",
        error,
        "ACTIVATE_FAILED",
        "Failed to activate storefront release",
      );
    }
  });
