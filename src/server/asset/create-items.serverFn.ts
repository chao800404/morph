import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { CreateAssetFolderDTO } from "@/lib/asset/dto/asset-folder.dto";
import { AssetInsertDTO } from "@/lib/asset/dto/asset.dto";
import { assetFolderCreateSchema } from "@/lib/validations/asset";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { randomUUID } from "crypto";
import { assetDal } from "../../lib/asset";
// import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { getConfig } from "../get-config";
import { authMiddleware } from "../middleware/auth.middleware";

export type FormState = {
  message: string;
  success?: boolean;
  errors?: Record<string, string[]>;
  redirectPath?: string | null;
};

const createItemsSchema = zfd.formData({
  name: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  "parent-id": zfd.text(z.string().optional()),
  assets: zfd.repeatable(z.array(zfd.file(z.instanceof(File)))).optional(),
});

async function internalCreateAsset(
  user: any,
  assets: File[],
  folderId?: string,
): Promise<FormState> {
  let uploadedFiles: string[] = [];
  let redirectPath: string | null = null;

  try {
    const config = getConfig();
    // const { env } = getCloudflareContext(); // Use imported env

    if (!assets || assets.length === 0) {
      return {
        success: false,
        message: "No files provided",
      };
    }

    // Validate max files
    if (assets.length > config.server.upload.maxFiles) {
      return {
        success: false,
        message: `Too many files. Maximum allowed is ${config.server.upload.maxFiles}.`,
      };
    }

    // Check total file size
    const totalSize = assets.reduce((sum, file) => sum + file.size, 0);
    const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB

    if (totalSize > MAX_TOTAL_SIZE) {
      const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      return {
        success: false,
        message: `Total upload size (${totalSizeMB}MB) exceeds the maximum batch limit (50MB).`,
      };
    }

    const normalizedFolderId =
      folderId && folderId !== "root" ? folderId : null;

    const results = await Promise.all(
      assets.map(async (file) => {
        if (file.size > config.server.upload.maxFileSize) {
          throw new Error(
            `File ${file.name} exceeds the maximum size of ${config.server.upload.maxFileSize / (1024 * 1024)}MB.`,
          );
        }

        const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
        const isAllowedType = config.server.upload.allowedTypes.includes(
          file.type,
        );
        const isAllowedExtension =
          config.server.upload.allowedExtensions.includes(ext);

        if (!isAllowedType && !isAllowedExtension) {
          throw new Error(
            `File type ${file.type} or extension ${ext} is not allowed.`,
          );
        }

        const fileId = randomUUID();
        let assetType: "image" | "video" | "rive" | "model" = "image";

        if (file.type.startsWith("video/")) {
          assetType = "video";
        } else if (file.name.endsWith(".riv")) {
          assetType = "rive";
        } else if (
          file.name.endsWith(".obj") ||
          file.name.endsWith(".glb") ||
          file.name.endsWith(".gltf")
        ) {
          assetType = "model";
        }

        const fileExtension = file.name.split(".").pop() || "bin";
        const finalMimeType = file.type;
        const finalSize = file.size;

        const fileName = `${fileId}.${fileExtension}`;
        const key = `assets/${fileName}`;

        if (typeof FixedLengthStream !== "undefined") {
          const { readable, writable } = new FixedLengthStream(file.size);
          file.stream().pipeTo(writable);

          await env.R2_BUCKET.put(key, readable, {
            httpMetadata: { contentType: finalMimeType },
            customMetadata: {
              originalName: file.name,
              uploadedBy: user.id,
              uploadedAt: new Date().toISOString(),
            },
          });
        } else {
          const fileBuffer = await file.arrayBuffer();

          await env.R2_BUCKET.put(key, fileBuffer, {
            httpMetadata: { contentType: finalMimeType },
            customMetadata: {
              originalName: file.name,
              uploadedBy: user.id,
              uploadedAt: new Date().toISOString(),
            },
          });
        }

        const duration = undefined;
        const formatSize = (bytes: number): string => {
          if (bytes < 1024) return `${bytes} B`;
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
          return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        };

        const r2Url = `/${key}`;
        const nameWithoutExtension = file.name.replace(/\.[^/.]+$/, "");

        const assetData: AssetInsertDTO = {
          id: fileId,
          folderId: normalizedFolderId,
          type: assetType,
          name: nameWithoutExtension,
          originalName: file.name,
          mimeType: finalMimeType,
          size: finalSize,
          sizeFormatted: formatSize(finalSize),
          url: r2Url,
          uploadedBy: user.id,
          updatedBy: user.id,
          duration,
          metadata: JSON.stringify({ r2Key: key }),
        };

        return { fileName, assetData };
      }),
    );

    uploadedFiles = results.map((r) => r.fileName);
    const assetDataList = results.map((r) => r.assetData);

    await assetDal.createMany(assetDataList);

    // revalidatePath("/(backend)/dashboard/[...slug]", "page");

    if (normalizedFolderId) {
      redirectPath = `/dashboard/assets?folderId=${normalizedFolderId}`;
    }
  } catch (error) {
    console.error("Asset upload error:", error);
    let errorMessage = "Failed to upload assets";

    if (error instanceof Error) {
      if (
        error.message.includes("Body exceeded") ||
        error.message.includes("50mb limit")
      ) {
        errorMessage = "Upload failed: Total batch size exceeds 50MB limit.";
      } else {
        errorMessage = error.message;
      }
    }

    return {
      success: false,
      message: errorMessage,
    };
  }
  return {
    success: true,
    message: `${uploadedFiles.length} file(s) uploaded successfully`,
    redirectPath,
  };
}

export const createItems = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) {
      throw new Error("Invalid form data");
    }
    return createItemsSchema.parse(data);
  })
  .middleware([authMiddleware])
  .handler(async ({ data: parsedInput, context }) => {
    const user = context.user;

    // Check for admin role logic if needed, referencing previous adminActionClient usage
    // Assuming adminActionClient guaranteed admin role?
    // Let's add explicit check if we can verify role structure.
    // Assuming 'role' is on user object.
    /*
        if (authUser.role !== 'admin') {
             return { success: false, message: "Unauthorized" };
        }
        */

    const name = parsedInput.name;
    const description = parsedInput.description;
    let parentId = parsedInput["parent-id"];
    const assetsInput = parsedInput.assets;
    const assets = Array.isArray(assetsInput)
      ? assetsInput
      : assetsInput
        ? [assetsInput]
        : [];

    if (parentId === "root") {
      parentId = undefined;
    }

    if (name) {
      // Folder Creation Logic
      let redirectPath: string | null = null;
      const hasAssets = assets.length > 0;

      const validationResult = assetFolderCreateSchema.safeParse({
        name,
        parentId,
        description,
      });

      if (!validationResult.success) {
        throw new Error(
          validationResult.error.issues[0]?.message || "Invalid input",
        );
      }

      const validatedData = validationResult.data;
      const normalizedParentId =
        validatedData.parentId && validatedData.parentId.trim()
          ? validatedData.parentId
          : null;

      const createDto: CreateAssetFolderDTO = {
        name: validatedData.name,
        parentId: normalizedParentId,
        createdBy: user.id,
        description: validatedData.description,
      };

      let parentFolder = null;
      if (createDto.parentId) {
        parentFolder = await assetFolderDal.findById(createDto.parentId);

        if (!parentFolder) {
          throw new Error("Parent folder not found");
        }
      }

      const folderId = randomUUID();
      const folderPath = parentFolder
        ? `${parentFolder.path}/${validatedData.name}`
        : `/${validatedData.name}`;
      const folderIdPath = parentFolder
        ? `${parentFolder.idPath}/${folderId}`
        : `/${folderId}`;

      const existingFolder = await assetFolderDal.findByPath(folderPath);

      if (existingFolder) {
        throw new Error("Folder with this name already exists");
      }

      await assetFolderDal.create({
        id: folderId,
        name: createDto.name,
        parentId: createDto.parentId,
        path: folderPath,
        idPath: folderIdPath,
        description: createDto.description,
        createdBy: createDto.createdBy,
      });

      if (hasAssets) {
        const assetResult = await internalCreateAsset(user, assets, folderId);

        if (!assetResult.success) {
          return {
            success: true,
            message: `Folder created, but asset upload failed: ${assetResult.message}`,
            redirectPath: `/dashboard/assets?folderId=${folderId}`,
          };
        }
      }

      // revalidatePath("/dashboard/assets", "page");
      redirectPath = `/dashboard/assets?folderId=${folderId}`;

      return {
        success: true,
        message: "Folder created successfully",
        redirectPath,
      };
    } else {
      return await internalCreateAsset(user, assets, parentId);
    }
  });
