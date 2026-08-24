import { fail, failure, ok } from "@/lib/db/server-result";
import { storefrontThemeDal } from "@/lib/storefront/dal/storefront-theme.dal";
import {
  publishStorefrontThemeTemplateInputSchema,
  reorderStorefrontThemeSectionsInputSchema,
  storefrontThemeEditorInputSchema,
  updateStorefrontThemeSectionPropsInputSchema,
} from "@/lib/validations/storefront-theme";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

function parseEditorPanelWidths(cookieHeader: string | null | undefined) {
  const defaults = { left: 260, right: 380 };
  if (!cookieHeader) return defaults;
  let left = defaults.left;
  let right = defaults.right;
  for (const segment of cookieHeader.split(";")) {
    const [rawKey, rawVal] = segment.trim().split("=");
    if (!rawKey || !rawVal) continue;
    const key = decodeURIComponent(rawKey);
    const val = Number(decodeURIComponent(rawVal));
    if (
      key === "morph:editor-left-panel-width" &&
      Number.isFinite(val) &&
      val >= 220 &&
      val <= 460
    ) {
      left = val;
    }
    if (
      key === "morph:editor-right-panel-width" &&
      Number.isFinite(val) &&
      val >= 280 &&
      val <= 640
    ) {
      right = val;
    }
  }
  return { left, right };
}

export const getStorefrontThemeEditor = createServerFn({ method: "POST" })
  .validator((data: unknown) => storefrontThemeEditorInputSchema.parse(data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data }) => {
    try {
      const request = getRequest();
      const cookieHeader = request?.headers?.get("cookie");
      const panelWidths = parseEditorPanelWidths(cookieHeader);
      const editorOrigin = request
        ? new URL(request.url).origin
        : process.env.PUBLIC_URL || "http://localhost:3000";
      const context = await storefrontThemeDal.findEditorContext(
        data.storefrontId,
        data.themeId,
      );
      return context
        ? ok("Storefront theme editor fetched", {
            ...context,
            panelWidths,
            previewChannel: {
              editorOrigin,
              sessionId: crypto.randomUUID(),
            },
          })
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

export const reorderStorefrontThemeSections = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    reorderStorefrontThemeSectionsInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const result = await storefrontThemeDal.reorderSections({
        ...data,
        createdBy: context.user.id,
      });
      return result
        ? ok("Theme sections reordered", result)
        : fail("Theme template or section order not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Reorder storefront theme sections error",
        error,
        "UPDATE_FAILED",
        "Failed to reorder theme sections",
      );
    }
  });

export const updateStorefrontThemeSectionProps = createServerFn({
  method: "POST",
})
  .validator((data: unknown) =>
    updateStorefrontThemeSectionPropsInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const result = await storefrontThemeDal.updateSectionProps({
        ...data,
        createdBy: context.user.id,
      });
      return result
        ? ok("Theme section props updated", result)
        : fail("Theme template or section not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Update storefront theme section props error",
        error,
        "UPDATE_FAILED",
        "Failed to update section props",
      );
    }
  });

export const publishStorefrontThemeTemplate = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    publishStorefrontThemeTemplateInputSchema.parse(data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data, context }) => {
    try {
      const result = await storefrontThemeDal.publishTemplate({
        ...data,
        createdBy: context.user.id,
      });
      return result
        ? ok(
            result.unchanged ? "Theme is already published" : "Theme published",
            result,
          )
        : fail("Theme template or draft revision not found", {
            error: "NOT_FOUND",
          });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to publish theme";
      if (message.includes("RELEASE_GENERATION_CONFLICT")) {
        return fail(
          "Another release was published. Refresh the latest release before publishing again.",
          { error: "RELEASE_GENERATION_CONFLICT" },
        );
      }
      if (message.includes("TEMPLATE_DRAFT_CONFLICT")) {
        return fail("Template draft was modified concurrently.", {
          error: "TEMPLATE_DRAFT_CONFLICT",
        });
      }
      if (
        message.includes("PUBLISH_BUILD_NOT_FOUND") ||
        message.includes("PUBLISH_BUILD_NOT_READY") ||
        message.includes("PUBLISH_BUILD_MISMATCH")
      ) {
        return fail(
          "Publish requires a succeeded Build Preview bound to the selected source revision.",
          { error: "PUBLISH_BUILD_NOT_READY" },
        );
      }
      return failure(
        "Publish storefront theme template error",
        error,
        "UPDATE_FAILED",
        "Failed to publish theme",
      );
    }
  });
