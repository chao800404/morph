import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fail, ok, parseInput } from "@/lib/db/server-result";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";
import { signPreviewMedia } from "./preview-media-urls";

const signThemePreviewMediaInputSchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(100),
});

/**
 * Addresses a Live Preview page can load the given library assets from.
 *
 * Asked by the editor when an edit brings an asset into the preview that the
 * snapshot it started with did not already carry. Only the author who could
 * start the preview may ask, and only assets that exist are answered for.
 */
export const signThemePreviewMedia = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(signThemePreviewMediaInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input }) => {
    if (!input.success) return input;
    try {
      const { urls, expiresAt } = await signPreviewMedia(input.data.assetIds);
      return ok("Preview media signed", {
        urls: Object.fromEntries(urls),
        expiresAt,
      });
    } catch (error) {
      console.error("Sign preview media error:", error);
      return fail("Could not sign preview media.", {
        error: "SIGN_FAILED",
      });
    }
  });
