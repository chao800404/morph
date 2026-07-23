import { assetDal } from "@/lib/asset/dal/asset.dal";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const inputSchema = z.object({
  assetId: z.string().optional(),
  imageUrl: z.string().optional(),
});

export const removeBackground = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data: parsedInput }) => {
    const request = getRequest();
    let targetUrl: string | null = null;

    if (parsedInput.assetId) {
      const asset = await assetDal.findById(parsedInput.assetId);
      if (asset && asset.url) {
        targetUrl = new URL(asset.url, request.url).toString();
      }
    }

    if (!targetUrl && parsedInput.imageUrl) {
      if (
        parsedInput.imageUrl.startsWith("http://") ||
        parsedInput.imageUrl.startsWith("https://")
      ) {
        targetUrl = parsedInput.imageUrl;
      } else {
        targetUrl = new URL(parsedInput.imageUrl, request.url).toString();
      }
    }

    if (!targetUrl) {
      return {
        success: false,
        message: "A valid asset ID or image URL is required",
      };
    }

    try {
      const cookie = request.headers.get("cookie");
      const transformed = await fetch(targetUrl, {
        headers: cookie ? { cookie } : undefined,
        cf: {
          image: {
            segment: "foreground",
            format: "png",
            quality: 100,
          },
        } as any,
      });

      if (!transformed.ok) {
        return {
          success: false,
          message: `Cloudflare Image Resizing requires Cloudflare deployment / zone enabled (${transformed.status} ${transformed.statusText})`,
        };
      }

      const imageBlob = await transformed.blob();
      const imageBuffer = await imageBlob.arrayBuffer();
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
