import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { failure, ok, parseInput } from "@/lib/db/server-result";
import { storefrontBuildPreviewCapabilityDal } from "@/lib/storefront/dal/storefront-build-preview-capability.dal";
import {
  buildPreviewHostname,
  issueBuildPreviewCapability,
} from "@/lib/storefront/service/build-preview/build-preview-capability";
import { createServerThemeBuildService } from "@/lib/storefront/service/theme-build-service.factory";
import { resolveThemePreviewServerHost } from "@/lib/storefront/service/theme-preview-server-origin";
import { getStorefrontThemeBuildInputSchema } from "@/lib/validations/storefront-theme-build";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

/**
 * Opens an isolated Build Preview of one build for the signed-in admin: a
 * capability held by them, presented as its own host under the Live Preview's
 * preview hostname and held to the same hostname rules. The address is the
 * whole result; the instance starts on its first request.
 */
export const openBuildPreview = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(getStorefrontThemeBuildInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const data = input.data;
    try {
      const bindings = env as unknown as Record<string, unknown>;
      const host = resolveThemePreviewServerHost({
        configuredPreviewHostname:
          typeof bindings.THEME_PREVIEW_HOSTNAME === "string"
            ? bindings.THEME_PREVIEW_HOSTNAME
            : undefined,
        env: bindings,
      });
      if (!host.enabled) {
        return failure(
          "Open Build Preview error",
          new Error(host.reason),
          "PREVIEW_HOST_UNAVAILABLE",
          "Build Preview needs a preview hostname on a site of its own.",
        );
      }
      // Scoped to the store and Theme in the request, so a build of another
      // Theme cannot be opened by naming it.
      const build = await createServerThemeBuildService().getThemeBuild({
        storefrontId: data.storefrontId,
        themeId: data.themeId,
        buildId: data.buildId,
      });
      if (!build) {
        return failure(
          "Open Build Preview error",
          new Error("Theme build not found"),
          "NOT_FOUND",
          "Theme build not found",
        );
      }
      const issued = await issueBuildPreviewCapability({
        dal: storefrontBuildPreviewCapabilityDal,
        storefrontId: build.storefrontId,
        themeId: build.themeId,
        buildId: build.id,
        userId: context.user.id,
      });
      if (!issued.ok) {
        return failure(
          "Open Build Preview error",
          new Error(issued.reason),
          issued.reason,
          "This build cannot be previewed.",
        );
      }
      // The editor's scheme and port: the preview host is served by the
      // same Worker, on the same listener.
      const editor = new URL(getRequest().url);
      const url = new URL(editor.href);
      url.hostname = buildPreviewHostname(issued.token, host.hostname);
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return ok("Build Preview opened", {
        buildId: build.id,
        url: url.href,
        expiresAt: issued.expiresAt,
      });
    } catch (error) {
      return failure(
        "Open Build Preview error",
        error,
        "BUILD_PREVIEW_OPEN_FAILED",
        "Failed to open Build Preview",
      );
    }
  });
