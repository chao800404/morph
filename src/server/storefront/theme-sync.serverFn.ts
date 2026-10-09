import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { failure, ok, parseInput } from "@/lib/db/server-result";
import { storefrontThemeSyncCapabilityDal } from "@/lib/storefront/dal/storefront-theme-sync-capability.dal";
import { issueThemeSyncCapability } from "@/lib/storefront/service/theme-sync/theme-sync-capability";
import { listThemeFilesInputSchema } from "@/lib/validations/storefront-theme-file";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

/**
 * Links a folder on the signed-in admin's machine to this Theme: issues the
 * capability `morph-sync` presents, and replaces any this admin already held
 * for the Theme. The token is in this result only; it is stored as a hash.
 *
 * The capability itself checks the Theme belongs to the store named here and
 * that the admin may write it, so naming another store's Theme is refused
 * rather than issued.
 */
export const issueThemeSyncToken = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(listThemeFilesInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const data = input.data;
    try {
      const issued = await issueThemeSyncCapability({
        dal: storefrontThemeSyncCapabilityDal,
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        userId: context.user.id,
      });
      if (!issued.ok) {
        return failure(
          "Link local folder error",
          new Error(issued.reason),
          issued.reason,
          "This Theme cannot be linked to a local folder.",
        );
      }
      return ok("Local sync token issued", {
        token: issued.token,
        expiresAt: issued.expiresAt,
        origin: new URL(getRequest().url).origin,
      });
    } catch (error) {
      return failure(
        "Link local folder error",
        error,
        "THEME_SYNC_ISSUE_FAILED",
        "Failed to issue a local sync token",
      );
    }
  });
