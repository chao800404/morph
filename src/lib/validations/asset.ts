import { z } from "zod";

// Simple schemas without config dependency
// These will be validated at runtime with actual config values

export const assetMetadataSchema = z.object({
  version: z.literal(1),
  r2Key: z.string().regex(/^assets\/[a-f0-9-]+\.[a-z0-9]+$/),
});

export const assetTagsSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(50)
  .transform((tags) => Array.from(new Set(tags)));

export const parseAssetTagsInput = (value: string) =>
  assetTagsSchema.parse(
    value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  );

export const isUploadedFile = (value: unknown): value is File => {
  if (typeof value !== "object" || value === null) return false;

  const file = value as File;
  return (
    typeof file.name === "string" &&
    typeof file.type === "string" &&
    typeof file.size === "number" &&
    typeof file.arrayBuffer === "function" &&
    typeof file.stream === "function" &&
    typeof file.slice === "function" &&
    typeof file.text === "function"
  );
};

export const uploadedFileSchema = z
  .custom<File>(isUploadedFile, { message: "Invalid uploaded file" })
  .refine(
    (file) =>
      file.name.length > 0 &&
      file.name.length <= 255 &&
      !/[\u0000-\u001f/\\]/.test(file.name),
    { message: "Uploaded filename is invalid" },
  )
  .refine((file) => Number.isSafeInteger(file.size) && file.size > 0, {
    message: "Uploaded file cannot be empty",
  });

const SVG_MAX_SIZE = 2 * 1024 * 1024;
const SVG_FORBIDDEN_MARKUP =
  /<\s*(?:script|foreignObject|iframe|object|embed|audio|video|link|meta)\b/i;
const SVG_EVENT_HANDLER = /\son[a-z][a-z0-9_-]*\s*=/i;
const SVG_UNSAFE_REFERENCE =
  /(?:href|xlink:href|src)\s*=\s*["']\s*(?:javascript:|data:text\/html|https?:|\/\/|file:)/i;

export type SvgValidationResult =
  | { success: true }
  | { success: false; message: string };

/**
 * SVG is active XML, not a passive raster image. This lightweight allow-policy
 * rejects DTD/entities and active or externally referenced content. Serving it
 * is additionally sandboxed by the asset response route.
 */
export async function validateSvgContent(
  file: File,
): Promise<SvgValidationResult> {
  if (file.size > SVG_MAX_SIZE) {
    return { success: false, message: "SVG files must be 2MB or smaller" };
  }

  let source: string;
  try {
    source = await file.text();
  } catch {
    return { success: false, message: "Unable to read SVG content" };
  }

  if (
    source.includes("\0") ||
    !/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(source)
  ) {
    return { success: false, message: "File is not a valid SVG document" };
  }
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) {
    return {
      success: false,
      message: "SVG DTD and external entities are not allowed",
    };
  }
  if (SVG_FORBIDDEN_MARKUP.test(source) || SVG_EVENT_HANDLER.test(source)) {
    return { success: false, message: "SVG contains active content" };
  }
  if (SVG_UNSAFE_REFERENCE.test(source)) {
    return {
      success: false,
      message: "SVG contains an unsafe external reference",
    };
  }

  return { success: true };
}

// Asset upload validation schema (basic validation only)
export const assetUploadSchema = z.object({
  file: uploadedFileSchema,
});

// Multiple asset upload validation schema (basic validation only)
export const multipleAssetUploadSchema = z.object({
  files: z.array(uploadedFileSchema).min(1, "At least 1 asset is required"),
});

// Asset upload result schema
export const assetUploadResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      id: z.string(),
      name: z.string(),
      originalName: z.string(),
      size: z.number().positive(),
      sizeFormatted: z.string(),
      type: z.enum(["image", "video", "rive", "model"]),
      mimeType: z.string(),
      url: z.string().url(),
      thumbnailUrl: z.string().url().optional(),
      folderId: z.string().nullable(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      duration: z.number().nullable(),
      createdAt: z.date(),
      updatedAt: z.date(),
    })
    .nullable()
    .optional(),
  error: z.string().optional(),
});

// Asset deletion schema
export const assetDeleteSchema = z.object({
  id: z.string().min(1, "Asset ID is required"),
});

// Batch asset deletion schema
export const batchAssetDeleteSchema = z.object({
  itemIds: z
    .array(z.string().min(1, "Invalid asset ID format"))
    .min(1, "At least one asset ID is required"),
});

// Asset folder creation schema
export const assetFolderCreateSchema = z.object({
  name: z
    .string()
    .min(1, "Folder name is required")
    .max(255, "Folder name too long")
    .regex(/^[^/\\:*?"<>|]+$/, "Invalid folder name characters"),
  parentId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

// Asset folder deletion schema
export const assetFolderDeleteSchema = z.object({
  id: z.uuid("Invalid folder ID"),
});

// Asset folder update schema
export const assetFolderUpdateSchema = z.object({
  id: z.uuid("Invalid folder ID"),
  name: z
    .string()
    .min(1, "Folder name is required")
    .max(255, "Folder name too long")
    .regex(/^[^/\\:*?"<>|]+$/, "Invalid folder name characters"),
  parentId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

// Asset folder result schema
export const assetFolderResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      parentId: z.string().nullable(),
      path: z.string(),
      description: z.string().nullable(),
      userId: z.string(),
      createdAt: z.date(),
      updatedAt: z.date(),
    })
    .nullable()
    .optional(),
  error: z.string().optional(),
});

// Move assets schema
export const moveAssetsSchema = z.object({
  itemIds: z
    .array(z.string().uuid("Invalid item ID format"))
    .min(1, "At least one item must be selected"),
  targetFolderId: z
    .union([
      z.string().uuid("Invalid target folder ID format"),
      z.literal(""),
      z.literal("root"),
    ])
    .nullable(),
});

// Move assets result schema
export const moveAssetsResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z
    .object({
      movedAssets: z.number(),
      movedFolders: z.number(),
      totalItems: z.number(),
    })
    .nullable()
    .optional(),
  error: z.string().optional(),
});

// Update items schema (for batch updates)
export const updateItemsSchema = z.object({
  itemsData: z.string().transform((str, ctx) => {
    try {
      const parsed = JSON.parse(str);
      return z
        .array(
          z.object({
            id: z.uuid("Invalid item ID"),
            type: z.enum(["folder", "asset"]),
            name: z
              .string()
              .trim()
              .min(1, "Name cannot be empty")
              .max(255, "Name is too long")
              .regex(/^[^/\\:*?"<>|]+$/, "Name contains invalid characters")
              .optional(),
            description: z.string().max(5000).optional(),
            alt: z.string().max(1000).optional(),
            caption: z.string().max(5000).optional(),
            tags: z.string().max(2000).optional(),
            locationId: z.uuid("Invalid folder ID").nullable().optional(),
          }),
        )
        .min(1, "Select at least one item")
        .max(100, "A maximum of 100 items may be changed at once")
        .refine(
          (items) =>
            new Set(items.map((item) => item.id)).size === items.length,
          "Duplicate item IDs are not allowed",
        )
        .parse(parsed);
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid items data format",
      });
      return z.NEVER;
    }
  }),
});

/**
 * Validate image file by checking magic numbers
 */
export async function validateImageMagicNumber(file: File): Promise<boolean> {
  try {
    const arrayBuffer = await file.slice(0, 12).arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Check JPEG
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      return true;

    // Check PNG
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    )
      return true;

    // Check GIF
    if (
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38
    )
      return true;

    // Check WebP (RIFF at start and WEBP at offset 8)
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    )
      return true;

    return false;
  } catch {
    return false;
  }
}

// Process image schema (for image editing/processing)
export const processImageSchema = z.object({
  assetId: z.string().min(1, "Asset ID is required"),
  croppedImage: uploadedFileSchema
    .refine((file) => file.type.startsWith("image/"), "File must be an image")
    .refine(async (file) => await validateImageMagicNumber(file), {
      message:
        "File content is not a valid image (magic number validation failed)",
    }),
  filename: z.string().min(1, "Filename is required"),
  saveas: z.enum(["new", "update"], {
    message: "Save mode must be either 'new' or 'update'",
  }),
  width: z
    .string()
    .min(1, "Width is required")
    .transform((val, ctx) => {
      const num = parseInt(val, 10);
      if (isNaN(num) || num <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Width must be a positive number",
        });
        return z.NEVER;
      }
      return num;
    }),
  height: z
    .string()
    .min(1, "Height is required")
    .transform((val, ctx) => {
      const num = parseInt(val, 10);
      if (isNaN(num) || num <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Height must be a positive number",
        });
        return z.NEVER;
      }
      return num;
    }),
});

// Export types
export type AssetUploadInput = z.infer<typeof assetUploadSchema>;
export type MultipleAssetUploadInput = z.infer<
  typeof multipleAssetUploadSchema
>;
export type AssetUploadResult = z.infer<typeof assetUploadResultSchema>;
export type AssetDeleteInput = z.infer<typeof assetDeleteSchema>;
export type AssetFolderCreateInput = z.infer<typeof assetFolderCreateSchema>;
export type AssetFolderDeleteInput = z.infer<typeof assetFolderDeleteSchema>;
export type AssetFolderUpdateInput = z.infer<typeof assetFolderUpdateSchema>;
export type AssetFolderResult = z.infer<typeof assetFolderResultSchema>;
export type MoveAssetsInput = z.infer<typeof moveAssetsSchema>;
export type MoveAssetsResult = z.infer<typeof moveAssetsResultSchema>;
export type UpdateItemsInput = z.infer<typeof updateItemsSchema>;
export type ProcessImageInput = z.infer<typeof processImageSchema>;
