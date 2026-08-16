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

function requireWritePrecondition(
  value: {
    expectedFileId?: string;
    expectedVersion?: number;
    expectMissing?: boolean;
  },
  ctx: z.RefinementCtx,
) {
  const hasExisting =
    value.expectedFileId !== undefined || value.expectedVersion !== undefined;

  if (value.expectMissing && hasExisting) {
    ctx.addIssue({
      code: "custom",
      message:
        "expectMissing cannot be combined with expectedFileId/expectedVersion",
    });
    return;
  }

  if (!value.expectMissing) {
    if (!value.expectedFileId || value.expectedVersion === undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "Existing file writes require expectedFileId and expectedVersion; new files require expectMissing=true",
      });
    }
  }
}

export const listThemeFilesInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
});

export const getThemeFileInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  path: safeThemeFilePathSchema,
});

export const saveThemeFileInputSchema = z
  .object({
    storefrontId: z.string().min(1),
    themeId: z.string().min(1),
    path: safeThemeFilePathSchema,
    content: z.string(),
    mimeType: z.string().optional(),
    expectedFileId: z.string().uuid().optional(),
    expectedVersion: z.number().int().min(1).optional(),
    expectMissing: z.boolean().optional().default(false),
    createRevision: z.boolean().optional().default(false),
    revisionMessage: z.string().max(200).optional(),
  })
  .superRefine(requireWritePrecondition);

const batchFileSchema = z
  .object({
    path: safeThemeFilePathSchema,
    content: z.string(),
    mimeType: z.string().optional(),
    expectedFileId: z.string().uuid().optional(),
    expectedVersion: z.number().int().min(1).optional(),
    expectMissing: z.boolean().optional().default(false),
  })
  .superRefine(requireWritePrecondition);

export const saveThemeFilesBatchInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  files: z.array(batchFileSchema).min(1, "Batch must contain at least one file"),
  createRevision: z.boolean().optional().default(false),
  revisionMessage: z.string().max(200).optional(),
});

export const deleteThemeFileInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  path: safeThemeFilePathSchema,
  expectedFileId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export const initStarterThemeFilesInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
});

export const listThemeRevisionsInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
});

export const createThemeRevisionInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  message: z.string().trim().max(200).optional(),
});

export const rollbackThemeRevisionInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  revisionNumber: z.number().int().min(1),
});
