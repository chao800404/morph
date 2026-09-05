import { parseInput } from "@/lib/db/server-result";
import { resolveRemoveBackgroundTarget } from "./remove-background-target";
import { fetchRemoveBackgroundImage } from "./remove-background-image";
import { cmsConfig } from "@/cms.config";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { isRemoveBackgroundEnabled } from "@/lib/config/create-config";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { assetAdminMiddleware } from "../middleware/auth.middleware";

const inputSchema = z.object({
  assetId: z.string().optional(),
  imageUrl: z.string().optional(),
});

export const removeBackground = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(inputSchema, data))
  .middleware([assetAdminMiddleware])
  .handler(async ({ data: input }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) {
      return { success: false, message: input.message };
    }
    const parsedInput = input.data;
    if (!isRemoveBackgroundEnabled(cmsConfig)) {
      return {
        success: false,
        message: "Background removal is not enabled for this deployment",
      };
    }

    const request = getRequest();

    // The stored asset is the trusted reference; the caller-supplied URL is
    // only a fallback for the same image. Both are resolved against this
    // request's own origin and refused if they leave it — see
    // `resolveRemoveBackgroundTarget` for why that matters when the fetch
    // below carries the caller's session cookie.
    let candidate: string | null = null;
    if (parsedInput.assetId) {
      const asset = await assetDal.findById(parsedInput.assetId);
      candidate = asset?.url ?? null;
    }
    if (!candidate) candidate = parsedInput.imageUrl ?? null;

    const target = resolveRemoveBackgroundTarget({
      candidate,
      requestUrl: request.url,
    });
    if (!target.ok) {
      return {
        success: false,
        message:
          target.reason === "cross-origin"
            ? "Background removal only accepts images hosted by this CMS."
            : "A valid asset ID or image URL is required",
      };
    }
    const targetUrl = target.url;

    try {
      // Same-origin only, enforced above. The cookie is required because the
      // asset route this reads from is session-gated; it must never ride along
      // to a host the caller chose.
      const cookie = request.headers.get("cookie");
      const imageBuffer = await fetchRemoveBackgroundImage(targetUrl, cookie);
      const base64Image = Buffer.from(imageBuffer).toString("base64");
      const dataUrl = `data:image/png;base64,${base64Image}`;

      return {
        success: true,
        message: "Background removed successfully",
        data: {
          processedImage: dataUrl,
          originalUrl: targetUrl,
        },
      };
    } catch (error) {
      console.error("Background removal error:", error);
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Cloudflare Image Resizing / Background removal failed",
      };
    }
  });
