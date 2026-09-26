import { assetDal } from "@/lib/asset/dal/asset.dal";
import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import { copyLibraryAssetToPublic } from "@/lib/storefront/service/library-asset-to-public";
import { themeSourceStore } from "@/lib/storefront/storage/theme-storage.server";
import { copyAssetToThemePublicInputSchema } from "@/lib/validations/storefront-theme-file";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

/**
 * Copies a media-library asset into the Theme's `public/`, as a new file;
 * see `copyLibraryAssetToPublic`. The request names the asset and the path;
 * the bytes are read from the library's storage here.
 */
export const copyAssetToThemePublic = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(copyAssetToThemePublicInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    const data = input.data;
    try {
      const result = await copyLibraryAssetToPublic(
        {
          findAsset: (id) => assetDal.findById(id),
          readAssetBytes: async (key) => {
            const object = await env.R2_BUCKET.get(key);
            return object ? new Uint8Array(await object.arrayBuffer()) : null;
          },
          saveBinaryFile: (...args) => themeSourceStore.saveBinaryFile(...args),
        },
        { ...data, createdBy: context.user?.id },
      );
      if (!result.ok) return fail(result.message, { error: result.error });
      return ok("Asset copied to public/", {
        file: result.file,
        sourceGeneration: result.sourceGeneration,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("CONFLICT_SOURCE_GENERATION_MISMATCH")) {
        return fail(
          "The Theme changed since it was loaded. Reload and try again.",
          { error: "SOURCE_GENERATION_CONFLICT" },
        );
      }
      if (message.startsWith("CONFLICT_")) {
        return fail(message, {
          error: message.slice(0, message.indexOf(":")) || "CONFLICT",
        });
      }
      if (message.startsWith("THEME_PUBLIC_FILE_REFUSED")) {
        return fail(message.replace(/^THEME_PUBLIC_FILE_REFUSED:\s*/, ""), {
          error: "THEME_PUBLIC_FILE_REFUSED",
        });
      }
      return failure(
        "Copy asset to public/ error",
        error,
        "SAVE_FAILED",
        "Failed to copy the asset",
      );
    }
  });
