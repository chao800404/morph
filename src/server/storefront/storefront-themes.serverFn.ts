import { fail, failure, ok } from "@/lib/db/server-result";
import { storefrontThemeDal } from "@/lib/storefront/dal/storefront-theme.dal";
import { storefrontThemeEditorInputSchema } from "@/lib/validations/storefront-theme";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const getStorefrontThemeEditor = createServerFn({ method: "POST" })
  .validator((data: unknown) => storefrontThemeEditorInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
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
