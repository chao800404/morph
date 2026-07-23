import { assetDal } from "@/lib/asset/dal/asset.dal";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { assetAdminMiddleware } from "../middleware/auth.middleware";

const inputSchema = z.object({
  assetId: z.uuid("Invalid asset ID"),
});

export const removeBackground = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .middleware([assetAdminMiddleware])
  .handler(async ({ data: parsedInput }) => {
    const request = getRequest();
    const asset = await assetDal.findById(parsedInput.assetId);
    if (!asset || asset.type !== "image" || asset.mimeType === "image/svg+xml") {
      throw new Error("A raster image asset is required");
    }
    if (asset.size > 10 * 1024 * 1024) {
      throw new Error("Background removal is limited to images up to 10MB");
    }
    const imageUrl = new URL(asset.url, request.url).toString();

    try {
      // Resolve the source exclusively from an active D1 asset. Forward only
      // the session cookie needed by the private asset route, never user URLs.
      const cookie = request.headers.get("cookie");
      const transformed = await fetch(imageUrl, {
        headers: cookie ? { cookie } : undefined,
        cf: {
          image: {
            segment: "foreground",
            format: "png",
          },
        } as any,
      });

      if (!transformed.ok) {
        throw new Error(
          `Failed to process image: ${transformed.status} ${transformed.statusText}`,
        );
      }

      const transformedLength = Number(
        transformed.headers.get("content-length") ?? 0,
      );
      if (transformedLength > 15 * 1024 * 1024) {
        throw new Error("Processed image exceeds the 15MB response limit");
      }

      const imageBlob = await transformed.blob();
      const imageBuffer = await imageBlob.arrayBuffer();
      if (imageBuffer.byteLength > 15 * 1024 * 1024) {
        throw new Error("Processed image exceeds the 15MB response limit");
      }
      const base64Image = Buffer.from(imageBuffer).toString("base64");
      const dataUrl = `data:image/png;base64,${base64Image}`;

      return {
        success: true,
        message: "Background removed successfully",
        data: {
          processedImage: dataUrl,
          originalUrl: imageUrl,
        },
      };
    } catch (error) {
      console.error("Background removal error:", error);
      throw new Error(
        error instanceof Error ? error.message : "Failed to remove background",
      );
    }
  });
