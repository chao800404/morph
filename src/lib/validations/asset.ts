import { z } from "zod";

// Simple schemas without config dependency
// These will be validated at runtime with actual config values

// Asset upload validation schema (basic validation only)
export const assetUploadSchema = z.object({
    file: z.instanceof(File).refine(file => file.size > 0, "Asset file is required"),
});

// Multiple asset upload validation schema (basic validation only)
export const multipleAssetUploadSchema = z.object({
    files: z.array(z.instanceof(File)).min(1, "At least 1 asset is required"),
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
    itemIds: z.array(z.string().min(1, "Invalid asset ID format")).min(1, "At least one asset ID is required"),
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
    itemIds: z.array(z.string().uuid("Invalid item ID format")).min(1, "At least one item must be selected"),
    targetFolderId: z
        .union([z.string().uuid("Invalid target folder ID format"), z.literal(""), z.literal("root")])
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
                        id: z.string(),
                        type: z.enum(["folder", "asset"]),
                        name: z.string().optional(),
                        description: z.string().optional(),
                        alt: z.string().optional(),
                        caption: z.string().optional(),
                        tags: z.string().optional(),
                    })
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
 * Magic numbers (file signatures) for image validation
 */
const IMAGE_SIGNATURES = {
    jpeg: [0xff, 0xd8, 0xff],
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    gif: [0x47, 0x49, 0x46, 0x38],
    webp: { riff: [0x52, 0x49, 0x46, 0x46], webp: [0x57, 0x45, 0x42, 0x50] },
} as const;

/**
 * Validate image file by checking magic numbers
 */
async function validateImageMagicNumber(file: File): Promise<boolean> {
    try {
        const arrayBuffer = await file.slice(0, 12).arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        // Check JPEG
        if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;

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
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;

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
    croppedImage: z
        .instanceof(File)
        .refine(file => file.size > 0, "Cropped image file is required")
        .refine(file => file.type.startsWith("image/"), "File must be an image")
        .refine(async file => await validateImageMagicNumber(file), {
            message: "File content is not a valid image (magic number validation failed)",
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
export type MultipleAssetUploadInput = z.infer<typeof multipleAssetUploadSchema>;
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
