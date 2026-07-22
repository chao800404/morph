import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth.middleware";

const inputSchema = z.object({
  imageUrl: z.string().url("Invalid image URL"),
});

export const removeBackground = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .middleware([authMiddleware])
  .handler(async ({ data: parsedInput, context }) => {
    // Ensure user is authorized
    const user = context.user;
    // If specific admin check needed:
    // if ((user as any).role !== 'admin') throw new Error("Unauthorized");

    const { imageUrl } = parsedInput;

    try {
      // For Cloudflare Image Resizing with external URLs
      const cloudflareUrl = `https://cmsapp.org/cdn-cgi/image/segment=foreground,format=png/${imageUrl}`;

      const transformed =
        process.env.NODE_ENV === "development"
          ? await fetch(cloudflareUrl)
          : await fetch(imageUrl, {
              cf: {
                image: {
                  segment: "foreground", // AI background removal
                  format: "png", // Output supports transparency
                },
              } as any, // Cast as any because 'cf' option is not in standard fetch types
            });

      if (!transformed.ok) {
        throw new Error(
          `Failed to process image: ${transformed.status} ${transformed.statusText}`,
        );
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
