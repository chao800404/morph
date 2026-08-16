import { z } from "zod";

export const safeThemeFilePathSchema = z
  .string()
  .trim()
  .min(1, "File path cannot be empty")
  .max(255, "File path cannot exceed 255 characters")
  .refine(
    (p) => !p.startsWith("/") && !p.startsWith("\\"),
    "File path must be relative (cannot start with a slash)",
  )
  .refine(
    (p) => !p.split("/").some((segment) => segment === ".." || segment === "."),
    "File path cannot contain directory traversal (.. or .)",
  )
  .refine((p) => !p.includes("\0"), "File path cannot contain null bytes")
  .refine(
    (p) => /^[a-zA-Z0-9_\-./]+$/.test(p),
    "File path contains invalid characters (allowed: alphanumeric, _, -, ., /)",
  );

export const listThemeFilesInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
});

export const getThemeFileInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  path: safeThemeFilePathSchema,
});

export const saveThemeFileInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  path: safeThemeFilePathSchema,
  content: z.string(),
  mimeType: z.string().optional(),
  expectedVersion: z.number().int().min(1).optional(),
  createRevision: z.boolean().optional().default(false),
  revisionMessage: z.string().max(200).optional(),
});

export const saveThemeFilesBatchInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  files: z
    .array(
      z.object({
        path: safeThemeFilePathSchema,
        content: z.string(),
        mimeType: z.string().optional(),
        expectedVersion: z.number().int().min(1).optional(),
      }),
    )
    .min(1, "Batch must contain at least one file"),
  createRevision: z.boolean().optional().default(false),
  revisionMessage: z.string().max(200).optional(),
});

export const deleteThemeFileInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  path: safeThemeFilePathSchema,
});

export const initStarterThemeFilesInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
});

export const listThemeRevisionsInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
});

export const rollbackThemeRevisionInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  revisionNumber: z.number().int().min(1),
});
