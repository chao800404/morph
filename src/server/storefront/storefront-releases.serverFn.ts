import { fail, failure, ok } from "@/lib/db/server-result";
import { storefrontReleaseDal } from "@/lib/storefront/dal/storefront-release.dal";
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
      const release = await storefrontReleaseDal.activateRelease(data);
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
