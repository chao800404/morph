import { z } from "zod";

/**
 * The wire between `morph-sync` and Core's sync API
 * (`/api/storefront/theme-sync/*`). Version 1.
 *
 * Every write carries the same preconditions the editor's saves do: the
 * workspace's `sourceGeneration`, and per file either its id and version or
 * `expectMissing`. A write the server refuses on them changes nothing; the
 * client reads the workspace again and plans from what is there.
 */

export const THEME_SYNC_PROTOCOL_VERSION = 1;

/** Where the API lives on Core's origin; routes are relative to it. */
export const THEME_SYNC_API_PATH = "/api/storefront/theme-sync/";

/** Limits a single request is held to, on both ends. */
export const THEME_SYNC_LIMITS = Object.freeze({
  maxFilesPerRead: 200,
  maxFilesPerSave: 200,
  maxDeletionsPerSave: 200,
  /** One source file, as UTF-8 bytes. */
  maxFileBytes: 1024 * 1024,
  /** A whole save request body. */
  maxSaveBodyBytes: 8 * 1024 * 1024,
});

export const themeSyncWhoamiSchema = z.object({
  protocol: z.literal(THEME_SYNC_PROTOCOL_VERSION),
  storefrontId: z.string(),
  themeId: z.string(),
  expiresAt: z.string(),
});
export type ThemeSyncWhoami = z.infer<typeof themeSyncWhoamiSchema>;

export const themeSyncGenerationSchema = z.object({
  sourceGeneration: z.number().int().min(1),
});

export const themeSyncListedFileSchema = z.object({
  path: z.string(),
  id: z.string(),
  version: z.number().int().min(1),
  kind: z.enum(["text", "binary"]),
});
export type ThemeSyncListedFile = z.infer<typeof themeSyncListedFileSchema>;

export const themeSyncListSchema = z.object({
  /**
   * Read before the files, so it is never newer than they are: a change that
   * lands in between shows up as a newer generation on the next poll rather
   * than being taken as already seen.
   */
  sourceGeneration: z.number().int().min(1),
  files: z.array(themeSyncListedFileSchema),
});
export type ThemeSyncList = z.infer<typeof themeSyncListSchema>;

export const themeSyncReadRequestSchema = z.object({
  paths: z.array(z.string().min(1).max(255)).min(1).max(200),
});

export const themeSyncReadResponseSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      id: z.string(),
      version: z.number().int().min(1),
      content: z.string(),
    }),
  ),
  /** Asked for, but not a text file the workspace holds now. */
  missing: z.array(z.string()),
});
export type ThemeSyncReadResponse = z.infer<typeof themeSyncReadResponseSchema>;

const saveFileSchema = z
  .object({
    path: z.string().min(1).max(255),
    content: z.string(),
    expectedFileId: z.string().uuid().optional(),
    expectedVersion: z.number().int().min(1).optional(),
    expectMissing: z.boolean().optional(),
  })
  .refine(
    (file) =>
      Boolean(file.expectMissing) !==
      Boolean(file.expectedFileId && file.expectedVersion !== undefined),
    { message: "Name either expectMissing, or expectedFileId and expectedVersion." },
  );

export const themeSyncSaveRequestSchema = z.object({
  expectedSourceGeneration: z.number().int().min(1),
  files: z.array(saveFileSchema).max(200),
  deletions: z
    .array(
      z.object({
        path: z.string().min(1).max(255),
        expectedFileId: z.string().uuid(),
        expectedVersion: z.number().int().min(1),
      }),
    )
    .max(200),
});
export type ThemeSyncSaveRequest = z.infer<typeof themeSyncSaveRequestSchema>;

export const themeSyncSaveResponseSchema = z.object({
  sourceGeneration: z.number().int().min(1),
  files: z.array(
    z.object({
      path: z.string(),
      id: z.string(),
      version: z.number().int().min(1),
    }),
  ),
});
export type ThemeSyncSaveResponse = z.infer<typeof themeSyncSaveResponseSchema>;

/** Every refusal the API answers with, as `{ error, message }`. */
export type ThemeSyncApiError =
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "PATH_REFUSED"
  | "PAYLOAD_TOO_LARGE"
  | "SOURCE_GENERATION_CONFLICT"
  | "FILE_VERSION_CONFLICT"
  | "SAVE_FAILED";
