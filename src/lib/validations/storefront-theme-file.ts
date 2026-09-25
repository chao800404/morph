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
    (p) => !p.includes("//"),
    "Theme file path cannot contain empty path segments",
  )
  .refine(
    (p) => !p.split("/").some((segment) => segment === ".." || segment === "."),
    "File path cannot contain directory traversal (.. or .)",
  )
  .refine((p) => !p.includes("\0"), "File path cannot contain null bytes")
  .refine(
    (p) =>
      !p
        .replace(/\\/g, "/")
        .split("/")
        .some((segment) => segment.toLowerCase() === "node_modules"),
    "Theme file path cannot contain node_modules",
  )
  .refine(
    (p) => /^[a-zA-Z0-9_.$()\[\]\/-]+$/.test(p),
    "File path contains invalid characters (allowed: alphanumeric, _, -, ., $, (), [], /)",
  );

/**
 * A path source is written to as text.
 *
 * `public/` holds files served as they are — images and fonts — which are
 * uploaded as bytes and checked against `theme-public-files`. Written as text
 * they would be stored re-encoded, and served broken with nothing refusing
 * them. The prefix is spelled here rather than imported: that module builds
 * on `safeThemeFilePathSchema` above.
 */
export const themeTextFilePathSchema = safeThemeFilePathSchema.refine(
  (p) => !p.startsWith("public/"),
  "Files in public/ are uploaded, not written as text",
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

/** Read-only source/document compatibility audit for manifest migration. */
export const auditThemeContentInputSchema = listThemeFilesInputSchema;

/** Server-owned preview/apply entry points for legacy manifest migration. */
export const previewThemeManifestMigrationInputSchema =
  listThemeFilesInputSchema;
export const applyThemeManifestMigrationInputSchema = listThemeFilesInputSchema;

export const getThemeFileInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  path: safeThemeFilePathSchema,
});

export const saveThemeFileInputSchema = z
  .object({
    storefrontId: z.string().min(1),
    themeId: z.string().min(1),
    path: themeTextFilePathSchema,
    content: z.string(),
    mimeType: z.string().optional(),
    expectedFileId: z.string().uuid().optional(),
    expectedVersion: z.number().int().min(1).optional(),
    expectMissing: z.boolean().optional().default(false),
    expectedSourceGeneration: z.number().int().min(1),
    createRevision: z.boolean().optional().default(false),
    revisionMessage: z.string().max(200).optional(),
  })
  .superRefine(requireWritePrecondition);

const batchFileSchema = z
  .object({
    path: themeTextFilePathSchema,
    content: z.string(),
    mimeType: z.string().optional(),
    expectedFileId: z.string().uuid().optional(),
    expectedVersion: z.number().int().min(1).optional(),
    expectMissing: z.boolean().optional().default(false),
  })
  .superRefine(requireWritePrecondition);

export const saveThemeFilesBatchInputSchema = z
  .object({
    storefrontId: z.string().min(1),
    themeId: z.string().min(1),
    files: z.array(batchFileSchema),
    /**
     * Paths to remove once the writes land.
     *
     * A move is a write at the new path and a removal at the old one, and both
     * have to be one transaction: a batch that wrote without removing would
     * duplicate every moved file, and one that removed without writing would
     * lose it.
     */
    deletions: z
      .array(
        z.object({
          path: safeThemeFilePathSchema,
          expectedFileId: z.string().uuid(),
          expectedVersion: z.number().int().min(1),
        }),
      )
      .optional(),
    /** Route-file moves whose route-owned content binding must move with them. */
    routePathMoves: z
      .array(
        z.object({
          fromSourcePath: safeThemeFilePathSchema,
          toSourcePath: safeThemeFilePathSchema,
        }),
      )
      .max(50)
      .optional(),
    expectedSourceGeneration: z.number().int().min(1),
    createRevision: z.boolean().optional().default(false),
    revisionMessage: z.string().max(200).optional(),
  })
  .refine(
    (input) => input.files.length > 0 || (input.deletions?.length ?? 0) > 0,
    { message: "Batch must contain at least one file or deletion" },
  );

export const createThemePageInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  /** The address the author typed, not a file path. */
  routePath: z.string().min(1).max(512),
  /**
   * The source the editor believes it is adding to.
   *
   * Required, because reading the current generation here instead would make
   * every add succeed against whatever the theme had become — including a
   * change the author never saw — and the editor would then be told it is up
   * to date with source it is not holding.
   */
  expectedSourceGeneration: z.number().int().min(1),
});

export const deleteThemePageInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  sourcePath: safeThemeFilePathSchema,
  expectedFileId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  /** The source the editor believes it is removing from. */
  expectedSourceGeneration: z.number().int().min(1),
});

export const deleteThemeFileInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  path: safeThemeFilePathSchema,
  expectedFileId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  expectedSourceGeneration: z.number().int().min(1),
});

export const initStarterThemeFilesInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
});

export const previewStarterThemeWorkspaceInputSchema =
  initStarterThemeFilesInputSchema;

export const applyStarterThemeWorkspaceInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  expectedSourceGeneration: z.number().int().min(1),
});

export const listThemeRevisionsInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

export const createThemeRevisionInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  expectedSourceGeneration: z.number().int().min(1),
  message: z.string().trim().max(200).optional(),
  source: z
    .enum(["manual", "publish", "ai", "rollback"])
    .optional()
    .default("manual"),
});

export const previewThemeRollbackInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  revisionNumber: z.number().int().min(1),
});

export const rollbackThemeRevisionInputSchema = z.object({
  storefrontId: z.string().min(1),
  themeId: z.string().min(1),
  revisionNumber: z.number().int().min(1),
  expectedSourceGeneration: z.number().int().min(1),
});
