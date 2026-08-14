import { fail, failure, ok } from "@/lib/db/server-result";
import { storefrontThemeDal } from "@/lib/storefront/dal/storefront-theme.dal";
import { storefrontDal } from "@/lib/storefront/dal/storefront.dal";
import { storefrontThemeEditorInputSchema } from "@/lib/validations/storefront-theme";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const getStorefrontThemeEditor = createServerFn({ method: "POST" })
  .validator((data: unknown) => storefrontThemeEditorInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const storefront = await storefrontDal.findActive(data.storefrontId);
      if (!storefront) {
        return fail("Storefront not found", { error: "NOT_FOUND" });
      }
      await storefrontDal.ensureDefault(storefront.salesChannelId);
      const context = await storefrontThemeDal.findEditorContext(
        data.storefrontId,
        data.themeId,
      );
      return context
        ? ok("Storefront theme editor fetched", context)
        : fail("Storefront theme not found", { error: "NOT_FOUND" });
    } catch (error) {
      return failure(
        "Get storefront theme editor error",
        error,
        "GET_FAILED",
        "Failed to fetch storefront theme editor",
      );
    }
  });
