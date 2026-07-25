import { assetFolderDal } from "@/lib/asset/dal/asset-folder.dal";
import { CreateAssetFolderDTO } from "@/lib/asset/dto/asset-folder.dto";
import { AssetInsertDTO } from "@/lib/asset/dto/asset.dto";
import {
  assetFolderCreateSchema,
  assetMetadataSchema,
  uploadedFileSchema,
  validateImageMagicNumber,
  validateSvgContent,
} from "@/lib/validations/asset";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { randomUUID } from "crypto";
import { assetDal } from "../../lib/asset";
import { z } from "zod";
import { getConfig } from "../get-config";
import { assetAdminMiddleware } from "../middleware/auth.middleware";

export type FormState = {
  message: string;
  success: boolean;
  errors?: Record<string, string[]>;
  redirectPath?: string | null;
};

type CreateItemsValidationResult = {
  name?: string;
  description?: string;
  parentId?: string;
  durations: Array<number | null>;
  assets: File[];
  formError?: string;
  errors?: Record<string, string[]>;
};

const isFormDataLike = (value: unknown): value is FormData =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as FormData).get === "function" &&
  typeof (value as FormData).getAll === "function";

const optionalTextSchema = (maxLength: number) =>
  z.preprocess(
    (value) =>
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.string().trim().max(maxLength).optional(),
  );

const createItemsInputSchema = (maxFiles: number) =>
  z
    .object({
      name: optionalTextSchema(255),
      description: optionalTextSchema(5000),
      parentId: z.preprocess(
        (value) =>
          value === null ||
          value === undefined ||
          value === "null" ||
          value === "undefined" ||
          (typeof value === "string" && value.trim() === "")
            ? undefined
            : value,
        z
          .union([z.uuid("Invalid parent folder ID"), z.literal("root")])
          .optional(),
      ),
      durations: z
        .array(z.number().finite().positive().nullable())
        .max(maxFiles, `Maximum ${maxFiles} media durations allowed`),
      assets: z
        .array(uploadedFileSchema)
        .max(maxFiles, `Maximum ${maxFiles} files allowed`),
    })
    .superRefine((value, context) => {
      if (!value.name && value.assets.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["assets"],
          message: "At least one file is required",
        });
      }

      if (
        value.durations.length > 0 &&
        value.durations.length !== value.assets.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["durations"],
          message: "Media duration count does not match the uploaded files",
        });
      }
    });

const readDurationsInput = (formData: FormData): unknown => {
  const value = formData.get("durations");
  if (typeof value !== "string" || !value) return [];

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const getFirstZodError = (errors: Record<string, string[] | undefined>) =>
  Object.values(errors).find((messages): messages is string[] =>
    Boolean(messages?.length),
  )?.[0];

const parseCreateItemsInput = (data: unknown): CreateItemsValidationResult => {
  if (!isFormDataLike(data)) {
    return {
      assets: [],
      durations: [],
      formError: "Invalid upload form data",
    };
  }

  const rawInput = {
    name: data.get("name"),
    description: data.get("description"),
    parentId: data.get("parent-id"),
    durations: readDurationsInput(data),
    assets: data.getAll("assets"),
  };

  const result = createItemsInputSchema(
    getConfig().server.upload.maxFiles,
  ).safeParse(rawInput);

  if (result.success) return result.data;

  const fieldErrors = result.error.flatten().fieldErrors;
  const errors = Object.fromEntries(
    Object.entries(fieldErrors).filter((entry): entry is [string, string[]] =>
      Boolean(entry[1]?.length),
    ),
  );

  return {
    assets: [],
    durations: [],
    formError: getFirstZodError(fieldErrors) || "Invalid upload form data",
    errors,
  };
};

async function internalCreateAsset(
  user: { id: string },
  assets: File[],
  folderId?: string,
  durations: Array<number | null> = [],
): Promise<FormState> {
  const uploadedKeys: string[] = [];
  const createdAssetIds: string[] = [];
  let redirectPath: string | null = null;

  try {
    const config = getConfig();

    if (!env.R2_BUCKET) {
      throw new Error("R2 storage binding is not configured");
    }

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

    const uploadResults = await Promise.allSettled(
      assets.map(async (file, index) => {
        if (file.size <= 0) {
          throw new Error(`File ${file.name} is empty.`);
        }
        if (file.size > config.server.upload.maxFileSize) {
          throw new Error(
            `File ${file.name} exceeds the maximum size of ${config.server.upload.maxFileSize / (1024 * 1024)}MB.`,
          );
        }

        const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
        const expectedExtensions: Record<string, string[]> = {
          "image/jpeg": [".jpg", ".jpeg"],
          "image/png": [".png"],
          "image/gif": [".gif"],
          "image/webp": [".webp"],
          "image/svg+xml": [".svg"],
          "video/mp4": [".mp4"],
          "video/webm": [".webm"],
          "video/ogg": [".ogv", ".ogg"],
          "video/quicktime": [".mov"],
        };

        const extToMime: Record<string, string> = {
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".png": "image/png",
          ".gif": "image/gif",
          ".webp": "image/webp",
          ".svg": "image/svg+xml",
          ".mp4": "video/mp4",
          ".webm": "video/webm",
          ".ogv": "video/ogg",
          ".ogg": "video/ogg",
          ".mov": "video/quicktime",
        };

        const declaredMime = file.type.trim().toLowerCase();
        const expectedMime = extToMime[ext];
        const isGenericMime =
          declaredMime === "" || declaredMime === "application/octet-stream";
        let effectiveMime: string;

        if (expectedMime) {
          const extensionMatchesMime = expectedExtensions[expectedMime]?.includes(ext);
          const configuredMime = config.server.upload.allowedTypes.includes(expectedMime);
          const declaredMimeMatches = isGenericMime || declaredMime === expectedMime;

          if (!extensionMatchesMime || !configuredMime || !declaredMimeMatches) {
            throw new Error(
              `File ${file.name} has a MIME type that does not match its extension.`,
            );
          }
          effectiveMime = expectedMime;
        } else if (config.server.upload.allowedExtensions.includes(ext)) {
          if (!isGenericMime) {
            throw new Error(
              `File ${file.name} has an unexpected MIME type (${declaredMime}).`,
            );
          }
          effectiveMime = "application/octet-stream";
        } else {
          throw new Error(
            `File type ${file.type || "unknown"} or extension ${ext} is not allowed.`,
          );
        }

        const fileId = randomUUID();
        let assetType: "image" | "video" | "rive" | "model" = "image";

        if (
          effectiveMime.startsWith("video/") ||
          ext === ".mp4" ||
          ext === ".mov" ||
          ext === ".webm" ||
          ext === ".ogv" ||
          ext === ".ogg"
        ) {
          assetType = "video";
        } else if (ext === ".riv") {
          assetType = "rive";
        } else if (
          file.name.endsWith(".obj") ||
          file.name.endsWith(".glb") ||
          file.name.endsWith(".gltf")
        ) {
          assetType = "model";
        }

        const rasterImageExtensions = new Set([
          ".jpg",
          ".jpeg",
          ".png",
          ".gif",
          ".webp",
        ]);
        if (
          assetType === "image" &&
          rasterImageExtensions.has(ext) &&
          !(await validateImageMagicNumber(file))
        ) {
          throw new Error(`File ${file.name} is not a valid image.`);
        }

        let svgValidated = false;
        if (ext === ".svg") {
          const svgResult = await validateSvgContent(file);
          if (!svgResult.success) {
            throw new Error(`File ${file.name}: ${svgResult.message}.`);
          }
          svgValidated = true;
        }

        const fileExtension =
          file.name
            .split(".")
            .pop()
            ?.toLowerCase()
            .replace(/[^a-z0-9]/g, "") || "bin";
        const finalMimeType = effectiveMime;
        const finalSize = file.size;

        const fileName = `${fileId}.${fileExtension}`;
        const key = `assets/${fileName}`;

        if (typeof FixedLengthStream !== "undefined") {
          const { readable, writable } = new FixedLengthStream(file.size);
          const pipePromise = file.stream().pipeTo(writable);

          await Promise.all([
            env.R2_BUCKET.put(key, readable, {
              httpMetadata: { contentType: finalMimeType },
              customMetadata: {
                originalName: file.name,
                uploadedBy: user.id,
                uploadedAt: new Date().toISOString(),
                ...(svgValidated ? { svgValidated: "true" } : {}),
              },
            }),
            pipePromise,
          ]);
        } else {
          const fileBuffer = await file.arrayBuffer();

          await env.R2_BUCKET.put(key, fileBuffer, {
            httpMetadata: { contentType: finalMimeType },
            customMetadata: {
              originalName: file.name,
              uploadedBy: user.id,
              uploadedAt: new Date().toISOString(),
              ...(svgValidated ? { svgValidated: "true" } : {}),
            },
          });
        }

        uploadedKeys.push(key);

        const duration = durations[index] ?? undefined;
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
          url: r2Url,
          uploadedBy: user.id,
          updatedBy: user.id,
          duration,
          metadata: assetMetadataSchema.parse({ version: 1, r2Key: key }),
        };

        return { fileName, assetData };
      }),
    );

    const failedUpload = uploadResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failedUpload) {
      console.error("❌ [Server File Processing Rejected]", failedUpload.reason);
      throw failedUpload.reason;
    }

    const results = uploadResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );

    const assetDataList = results.map((r) => r.assetData);

    createdAssetIds.push(...assetDataList.map((asset) => asset.id));
    await assetDal.createMany(assetDataList);

    if (normalizedFolderId) {
      redirectPath = `/dashboard/assets?folderId=${normalizedFolderId}`;
    }
  } catch (error) {
    console.error("❌ [Server Asset Upload Exception]", {
      error,
      uploadedKeys,
      createdAssetIds,
    });

    await Promise.allSettled([
      ...uploadedKeys.map((key) => env.R2_BUCKET?.delete(key)),
      ...createdAssetIds.map((id) => assetDal.delete(id)),
    ]);
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
    message: `${uploadedKeys.length} file(s) uploaded successfully`,
    redirectPath,
  };
}

export const createItems = createServerFn({ method: "POST" })
  .inputValidator(parseCreateItemsInput)
  .middleware([assetAdminMiddleware])
  .handler(async ({ data: parsedInput, context }) => {
    const user = context.user;

    if (parsedInput.formError) {
      console.error("❌ [Server Input Validation Error]", {
        formError: parsedInput.formError,
        errors: parsedInput.errors,
      });
      return {
        success: false,
        message: parsedInput.formError,
        errors: parsedInput.errors,
      };
    }

    const name = parsedInput.name;
    const description = parsedInput.description;
    let parentId = parsedInput.parentId;
    const durations = parsedInput.durations;
    const assets = parsedInput.assets;

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
        const assetResult = await internalCreateAsset(
          user,
          assets,
          folderId,
          durations,
        );

        if (!assetResult.success) {
          return {
            success: false,
            message: `Folder created, but asset upload failed: ${assetResult.message}`,
            redirectPath: `/dashboard/assets?folderId=${folderId}`,
          };
        }
      }

      redirectPath = `/dashboard/assets?folderId=${folderId}`;

      return {
        success: true,
        message: "Folder created successfully",
        redirectPath,
      };
    } else {
      return await internalCreateAsset(user, assets, parentId, durations);
    }
  });
