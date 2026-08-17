import { env } from "cloudflare:workers";
import { ThemeBuildPreviewService } from "@/lib/storefront/service/theme-build-preview.service";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/preview-build/$buildId/$token/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const previewService = new ThemeBuildPreviewService({
          r2Bucket: (env as any)?.R2_BUCKET,
        });
        return await previewService.handlePreviewRequest(request, {
          buildId: params.buildId,
          token: params.token,
          artifactPath: params._splat,
        });
      },
      HEAD: async ({ request, params }) => {
        const previewService = new ThemeBuildPreviewService({
          r2Bucket: (env as any)?.R2_BUCKET,
        });
        return await previewService.handlePreviewRequest(request, {
          buildId: params.buildId,
          token: params.token,
          artifactPath: params._splat,
        });
      },
      OPTIONS: async ({ request, params }) => {
        const previewService = new ThemeBuildPreviewService({
          r2Bucket: (env as any)?.R2_BUCKET,
        });
        return await previewService.handlePreviewRequest(request, {
          buildId: params.buildId,
          token: params.token,
          artifactPath: params._splat,
        });
      },
    },
  },
});
