import { env } from "cloudflare:workers";
import { storefrontBuildPreviewCapabilityDal } from "@/lib/storefront/dal/storefront-build-preview-capability.dal";
import { storefrontContentPublicationDal } from "@/lib/storefront/dal/storefront-content-publication.dal";
import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import { handleBuildPreviewRequest } from "@/lib/storefront/service/build-preview/build-preview-request";
import { createBuildPreviewServer } from "@/lib/storefront/service/build-preview/build-preview-server.factory";

/**
 * The Build Preview host's composition root: the handler with this Worker's
 * bindings and data access. Null when the request is not for one.
 */
export function serveBuildPreviewRequest(
  request: Request,
): Promise<Response | null> {
  const bindings = env as unknown as Record<string, unknown>;
  return handleBuildPreviewRequest(request, {
    env: bindings,
    capabilityDal: storefrontBuildPreviewCapabilityDal,
    readBuild: (buildId) => storefrontThemeBuildDal.getBuildById(buildId),
    r2Bucket: bindings.R2_BUCKET as never,
    contentPorts: {
      getPublishedDocument: (args) =>
        storefrontContentPublicationDal.getPublishedTemplateDocument(
          args,
        ) as never,
      getPublishedPageDocument: (args) =>
        storefrontContentPublicationDal.getPublishedPageDocument(args) as never,
      getPublishedRouteDocument: (args) =>
        storefrontContentPublicationDal.getPublishedRouteDocument(
          args,
        ) as never,
    },
    server: () => createBuildPreviewServer(bindings),
  });
}
