import { assetDal } from "@/lib/asset/dal/asset.dal";
import {
  restoreLibrarySvgs,
  scanLibrarySvgs,
  SVG_REVALIDATION_BATCH,
  type SvgRevalidationDeps,
} from "@/lib/asset/svg-revalidation";
import { parseInput } from "@/lib/db/server-result";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { assetAdminMiddleware } from "../middleware/auth.middleware";

/** The library, as the re-check reads and writes it. */
function libraryDeps(): SvgRevalidationDeps {
  return {
    listSvgPage: (afterId, limit) => assetDal.listSvgPage(afterId, limit),
    findAsset: (id) => assetDal.findById(id),
    getObject: async (key) => {
      const object = await env.R2_BUCKET.get(key);
      return object
        ? {
            etag: object.etag,
            size: object.size,
            httpMetadata: object.httpMetadata as Record<string, unknown>,
            customMetadata: object.customMetadata,
            arrayBuffer: () => object.arrayBuffer(),
          }
        : null;
    },
    // R2 answers null when `onlyIf` does not hold: nothing was written.
    putObject: (key, bytes, options) =>
      env.R2_BUCKET.put(key, bytes, {
        httpMetadata: options.httpMetadata as R2HTTPMetadata | undefined,
        customMetadata: options.customMetadata,
        onlyIf: options.onlyIf,
      }),
  };
}

const failed = (error: unknown, fallback: string) => {
  console.error(fallback, error);
  return {
    success: false as const,
    message: error instanceof Error ? error.message : fallback,
    data: null,
    error: "SVG_REVALIDATION_FAILED" as const,
  };
};

const scanInputSchema = z.object({
  after: z.string().trim().min(1).max(64).nullable(),
});

/** One page of the read-only report: what the current SVG rules say of each file. */
export const scanLibrarySvgsServerFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(scanInputSchema, data))
  .middleware([assetAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      return {
        success: true as const,
        message: "SVG files checked",
        data: await scanLibrarySvgs(libraryDeps(), { after: input.data.after }),
      };
    } catch (error) {
      return failed(error, "Failed to check SVG files");
    }
  });

const restoreInputSchema = z.object({
  items: z
    .array(
      z.object({
        assetId: z.string().trim().min(1).max(64),
        etag: z.string().trim().min(1).max(200),
      }),
    )
    .min(1)
    .max(SVG_REVALIDATION_BATCH),
});

/**
 * Restores inline display for the named files, each checked again from its
 * bytes as they are now and written only over the ETag the scan saw.
 */
export const restoreLibrarySvgsServerFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(restoreInputSchema, data))
  .middleware([assetAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      return {
        success: true as const,
        message: "SVG files re-checked",
        data: await restoreLibrarySvgs(libraryDeps(), input.data.items),
      };
    } catch (error) {
      return failed(error, "Failed to restore SVG files");
    }
  });
