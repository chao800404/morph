import { getDb } from "@/db";
import { assets } from "@/db/asset.schema";
import { assetDal } from "@/lib/asset/dal/asset.dal";
import { createServerFn } from "@tanstack/react-start";
import { isFormDataLike } from "./input-validation";
import { env } from "cloudflare:workers";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { assetAdminMiddleware } from "../middleware/auth.middleware";

export const processImage = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!isFormDataLike(data)) {
      throw new Error("Invalid form data");
    }
    return data;
  })
  .middleware([assetAdminMiddleware])
  .handler(async ({ data: formData, context }) => {

    const assetId = formData.get("assetId") as string;
    const croppedFile = formData.get("croppedImage") as File | null;
    const filename = (formData.get("filename") as string) || "edited_image";
    const saveMode = (formData.get("saveas") as string) || "update";

    if (!croppedFile || typeof croppedFile.arrayBuffer !== "function") {
      return { success: false, message: "No image file provided" };
    }

    const user = context.user;
    const arrayBuffer = await croppedFile.arrayBuffer();
    const fileId = randomUUID();
    const fileName = `${fileId}.png`;
    const key = `assets/${fileName}`;

    await env.R2_BUCKET.put(key, arrayBuffer, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        originalName: filename,
        uploadedBy: user.id,
        uploadedAt: new Date().toISOString(),
      },
    });

    const r2Url = `/${key}`;
    const db = await getDb();

    if (saveMode === "update" && assetId) {
      const existing = await assetDal.findById(assetId);
      if (existing) {
        await db
          .update(assets)
          .set({
            url: r2Url,
            size: croppedFile.size,
            mimeType: "image/png",
            metadata: { version: 1, r2Key: key },
            updatedBy: user.id,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(assets.id, assetId));

        return {
          success: true,
          message: "Image updated successfully",
          assetId: existing.id,
          assetName: existing.name,
          assetUrl: r2Url,
        };
      }
    }

    // Save as new asset
    const originalAsset = assetId ? await assetDal.findById(assetId) : null;
    const baseName = filename.replace(/\.[^/.]+$/, "");
    const newName = `${baseName}_edited`;

    await assetDal.createMany([
      {
        id: fileId,
        folderId: originalAsset?.folderId ?? null,
        type: "image",
        name: newName,
        originalName: `${newName}.png`,
        mimeType: "image/png",
        size: croppedFile.size,
        url: r2Url,
        metadata: { version: 1, r2Key: key },
        uploadedBy: user.id,
        updatedBy: user.id,
      },
    ]);

    return {
      success: true,
      message: "New image saved successfully",
      assetId: fileId,
      assetName: newName,
      assetUrl: r2Url,
    };
  });
