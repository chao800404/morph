import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { failure, ok, parseInput } from "@/lib/db/server-result";
import { storefrontBuildPreviewCapabilityDal } from "@/lib/storefront/dal/storefront-build-preview-capability.dal";
import { storefrontReleaseDal } from "@/lib/storefront/dal/storefront-release.dal";
import { storefrontDal } from "@/lib/storefront/dal/storefront.dal";
import {
  buildPreviewHostname,
  issueBuildPreviewCapability,
} from "@/lib/storefront/service/build-preview/build-preview-capability";
import { createBuildPreviewServer } from "@/lib/storefront/service/build-preview/build-preview-server.factory";
import { createServerThemeBuildService } from "@/lib/storefront/service/theme-build-service.factory";
import { resolveThemePreviewServerHost } from "@/lib/storefront/service/theme-preview-server-origin";
import {
  getStorefrontThemeBuildInputSchema,
  openReleasePreviewInputSchema,
} from "@/lib/validations/storefront-theme-build";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

/**
 * The preview hostname, or the refusal that says this environment cannot run
 * a Build Preview at all.
 */
function buildPreviewHost(errorTitle: string) {
  const bindings = env as unknown as Record<string, unknown>;
  const host = resolveThemePreviewServerHost({
    configuredPreviewHostname:
      typeof bindings.THEME_PREVIEW_HOSTNAME === "string"
        ? bindings.THEME_PREVIEW_HOSTNAME
        : undefined,
    env: bindings,
  });
  if (!host.enabled) {
    return {
      ok: false as const,
      result: failure(
        errorTitle,
        new Error(host.reason),
        "PREVIEW_HOST_UNAVAILABLE",
        "Build Preview needs a preview hostname on a site of its own.",
      ),
    };
  }
  const executor = createBuildPreviewServer(bindings);
  if (!executor.enabled) {
    return {
      ok: false as const,
      result: failure(
        errorTitle,
        new Error(executor.reason),
        "BUILD_PREVIEW_EXECUTOR_UNAVAILABLE",
        executor.message,
      ),
    };
  }
  return { ok: true as const, hostname: host.hostname };
}

/**
 * An address on the editor's scheme and port: the preview host and the
 * storefront are served by the same Worker, on the same listener.
 */
function addressFor(hostname: string): string {
  const url = new URL(getRequest().url);
  url.hostname = hostname;
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.href;
}

/**
 * Opens an isolated Build Preview of one build for the signed-in admin: a
 * capability held by them, presented as its own host under the Live Preview's
 * preview hostname and held to the same hostname rules. The address is the
 * whole result; the instance starts on its first request.
 *
 * Refused, with the executor's reason, where this environment cannot run a
 * Build Preview at all, so the editor can tell "not here" from "failed" and
 * keep its static preview instead of framing an address that answers 503.
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
      const host = buildPreviewHost("Open Build Preview error");
      if (!host.ok) return host.result;
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
      return ok("Build Preview opened", {
        buildId: build.id,
        url: addressFor(buildPreviewHostname(issued.token, host.hostname)),
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

/**
 * Opens a preview of one release: its build, answered with the release's own
 * content (see `verifyBuildPreviewCapability`). The editor shows it after a
 * publish, so what is shown is the release that went out rather than a build:
 * a publish that reused an independent build shipped other content than that
 * build was sealed with.
 *
 * Also says whether the release is the one live now and, when it is and the
 * store has a domain, the address it is live at.
 */
export const openReleasePreview = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(openReleasePreviewInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const data = input.data;
    try {
      const host = buildPreviewHost("Open release preview error");
      if (!host.ok) return host.result;
      // Scoped to the store by the query and to the Theme here, so a release
      // of another Theme cannot be opened by naming it.
      const release = await storefrontReleaseDal.getById(
        data.storefrontId,
        data.releaseId,
      );
      if (!release || release.themeId !== data.themeId) {
        return failure(
          "Open release preview error",
          new Error("Release not found"),
          "NOT_FOUND",
          "Release not found",
        );
      }
      const issued = await issueBuildPreviewCapability({
        dal: storefrontBuildPreviewCapabilityDal,
        storefrontId: release.storefrontId,
        themeId: release.themeId,
        buildId: release.themeBuildId,
        releaseId: release.id,
        userId: context.user.id,
      });
      if (!issued.ok) {
        return failure(
          "Open release preview error",
          new Error(issued.reason),
          issued.reason,
          "This release cannot be previewed.",
        );
      }
      const storefront = await storefrontDal.findActive(data.storefrontId);
      const live = storefront?.activeReleaseId === release.id;
      return ok("Release preview opened", {
        releaseId: release.id,
        buildId: release.themeBuildId,
        url: addressFor(buildPreviewHostname(issued.token, host.hostname)),
        expiresAt: issued.expiresAt,
        live,
        liveUrl:
          live && storefront?.domain ? addressFor(storefront.domain) : null,
      });
    } catch (error) {
      return failure(
        "Open release preview error",
        error,
        "RELEASE_PREVIEW_OPEN_FAILED",
        "Failed to open the release preview",
      );
    }
  });
